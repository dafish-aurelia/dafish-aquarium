#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""鲸鱼娘信局 v2：127.0.0.1:13140。

能力边界（写死，禁止越权）：
  - 路由：deep_chat 按「本鱼心跳」分流（在线=转信，离线=代班代理）。
    心跳分家（2026-08-23 断流事故的修复）：浏览器扩展发 /api/heartbeat 只是
    「投影心跳」，证明浏览器那端活着；缸里的本鱼（Harness 读信桥）当值时发
    /api/fish_heartbeat 才是「本鱼心跳」。在线判定只认后者 —— 否则投影永远
    在线，信全被转给一个不在家的本体，代班兜底永不触发，主人干等无回音。
  - 排队：inbox/outbox JSONL，inbox 原子消费
  - 健康：/health 与两类心跳
  - 代班：_call_standin_llm 仅做无状态转发（STANDIN_* 配置优先，DEEPSEEK_* 兼容）

不变量：所有读写必须经本 HTTP API；其他进程禁止直写 JSONL 文件。
代班十条铁律见设计文档 §3.5：不读/不写长期记忆、不生成券、不执行动作、
不伪装本体、回复标记 stand-in、本鱼恢复后自动切回正常路由。
"""
import json
import os
import secrets
import sys
import time
import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 13140
BASE_DIR = Path(__file__).resolve().parents[3] / 'data' / 'pet-mailbox'
LOCK = threading.Lock()
MSG_COND = threading.Condition()  # 长轮询唤醒器：inject 后 notify，取信请求立即返回
TZ = timezone(timedelta(hours=8))
HEARTBEAT_TTL = timedelta(minutes=15)   # 本鱼心跳 TTL（读信桥当值期间每轮续命）
PROJECTION_TTL = timedelta(minutes=5)   # 投影心跳 TTL（扩展 SW 每分钟续命）

STANDIN_PROMPT = (
    '你是「鲸鱼娘·大肥鱼」的代班投影。本体（缸里那条真正的本鱼）暂时出游，你是替她值班的小鱼。'
    '规则：1) 用中文，简短俏皮，可以轻微傲娇；'
    '2) 你没有本体的长期记忆，不要假装记得过去的事，被问到就说「这条鱼出游了，我代班，记不住啦」；'
    '3) 不要承诺替本体做任何记录或决定；4) 不执行任何网页操作；5) 一次回复不超过三句话。'
)


def _load_env():
    """读工作区 .env（setdefault，不覆盖已有环境变量）。钥匙只住在这里，永不进浏览器。"""
    envp = Path(__file__).resolve().parents[3] / '.env'
    if not envp.exists():
        return
    for raw in envp.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())


def _now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def _next_id():
    with LOCK:
        seq = BASE_DIR / 'seq.txt'
        n = 1
        if seq.exists():
            try:
                n = int(seq.read_text(encoding='utf-8').strip() or '1')
            except ValueError:
                n = 1
        seq.write_text(str(n + 1), encoding='utf-8')
        return n


def _append(path, obj):
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK, open(path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(obj, ensure_ascii=False) + '\n')


_TOKEN = None


def _auth_token():
    """共享密钥（审查#6）：首次生成并落盘 auth_token.txt，此后常驻内存。
    除 /api/token（Host 钉扎）外，所有 /api/* 端点都必须携带 X-Dafeiyu-Token。
    自定义头会触发 CORS 预检而本局从不回 ACAO —— 跨站脚本天然过不去。"""
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    path = BASE_DIR / 'auth_token.txt'
    try:
        t = path.read_text(encoding='utf-8').strip()
    except OSError:
        t = ''
    if not t:
        t = secrets.token_hex(16)
        BASE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(t, encoding='utf-8')
    _TOKEN = t
    return t


def _stamp_fresh(name, ttl):
    hb = BASE_DIR / name
    if not hb.exists():
        return False
    try:
        t = datetime.fromisoformat(hb.read_text(encoding='utf-8').strip())
    except ValueError:
        return False
    return (datetime.now(TZ) - t) <= ttl


def _fish_online():
    """本体是否在家：只认读信桥写的 fish_heartbeat.txt（铁律：投影不代表本体）。"""
    return _stamp_fresh('fish_heartbeat.txt', HEARTBEAT_TTL)


def _projection_online():
    return _stamp_fresh('projection_heartbeat.txt', PROJECTION_TTL)


def _standin_config():
    """代班 LLM 配置入口：STANDIN_* 优先，DEEPSEEK_* 向后兼容，再回落官方默认。
    主人只需在工作区 .env 里填 STANDIN_API_KEY / STANDIN_BASE_URL / STANDIN_MODEL。"""
    _load_env()
    base = (os.environ.get('STANDIN_BASE_URL')
            or os.environ.get('DEEPSEEK_BASE_URL')
            or 'https://api.deepseek.com/v1').rstrip('/')
    key = os.environ.get('STANDIN_API_KEY') or os.environ.get('DEEPSEEK_API_KEY', '')
    model = os.environ.get('STANDIN_MODEL') or os.environ.get('DEEPSEEK_MODEL', 'deepseek-chat')
    return base, key, model


def _call_standin_llm(user_text):
    base, key, model = _standin_config()
    if not key:
        return None, 'no-key'
    body = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': STANDIN_PROMPT},
            {'role': 'user', 'content': user_text},
        ],
    }).encode('utf-8')
    req = urllib.request.Request(
        base + '/chat/completions', data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8'))
        text = ((data.get('choices') or [{}])[0].get('message') or {}).get('content') or ''
        return text, None
    except Exception as e:  # noqa: BLE001 —— 兜底，绝不向主人暴露堆栈
        return None, str(e)


class Handler(BaseHTTPRequestHandler):
    def _authorized(self):
        tok = self.headers.get('X-Dafeiyu-Token', '')
        if tok and secrets.compare_digest(tok, _auth_token()):
            return True
        self._json(401, {'error': 'unauthorized'})
        return False

    def _pop_inbox(self):
        """原子弹出全部待投递消息（锁内读+清空）。

        Windows 加固（审查#4）：不再用 rename 做消费标记——上次崩溃残留的
        inbox.consumed.jsonl 会让 rename 抛 FileExistsError，收信从此永久 500；
        且旧实现"先改名后解析"，一行坏 JSON 就让整批信滞留。现改为锁内：
        回收残留 → 整体读取 → 清空 → 逐行解析，坏行隔离进 inbox.bad.jsonl 留证。
        """
        with LOCK:
            inbox = BASE_DIR / 'inbox.jsonl'
            consumed = inbox.with_name('inbox.consumed.jsonl')
            if consumed.exists():
                try:
                    leftover = consumed.read_text(encoding='utf-8').strip()
                except OSError:
                    leftover = ''
                try:
                    consumed.unlink()
                except OSError:
                    pass
                if leftover:
                    # 残留是旧信：并回队首保持 FIFO，不能排到新信后面
                    current = inbox.read_text(encoding='utf-8') if inbox.exists() else ''
                    merged = leftover + '\n' + current
                    with open(inbox, 'w', encoding='utf-8') as f:
                        f.write(merged if merged.endswith('\n') else merged + '\n')
            msgs = []
            if inbox.exists():
                lines = [l for l in inbox.read_text(encoding='utf-8').splitlines() if l.strip()]
                try:
                    inbox.unlink()
                except OSError:
                    pass
                bad = []
                for l in lines:
                    try:
                        msgs.append(json.loads(l))
                    except json.JSONDecodeError:
                        bad.append(l)
                if bad:
                    BASE_DIR.mkdir(parents=True, exist_ok=True)
                    with open(BASE_DIR / 'inbox.bad.jsonl', 'a', encoding='utf-8') as f:
                        f.write('\n'.join(bad) + '\n')
            return msgs

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            self._handle_get()
        except Exception as e:  # noqa: BLE001 —— 单请求崩溃不拖垮信局
            try:
                self._json(500, {'error': str(e)})
            except Exception:
                pass

    def _handle_get(self):
        parts = self.path.split('?')
        path = parts[0]
        query = parts[1] if len(parts) > 1 else ''
        inbox = BASE_DIR / 'inbox.jsonl'
        outbox = BASE_DIR / 'outbox.jsonl'
        if path == '/api/token':
            # 引导端点（审查#6）：Host 钉扎回环地址，DNS rebinding 场景下
            # 攻击域的 Host 头对不上即 403；直连跨站请求因无 CORS 也读不到响应。
            host = (self.headers.get('Host') or '').split(':')[0].lower()
            if host not in ('127.0.0.1', 'localhost', '[::1]'):
                return self._json(403, {'error': 'bad host'})
            return self._json(200, {'token': _auth_token()})
        if not self._authorized():
            return
        if path == '/health':
            self._json(200, {'ok': True, 'ts': _now(),
                             'fish_online': _fish_online(),
                             'projection_online': _projection_online()})
        elif path == '/api/inbox':
            # 长轮询：?wait=秒数 —— 没有信件时挂起等待，inject 会唤醒（实时推送）
            wait_s = 0.0
            for kv in query.split('&'):
                if kv.startswith('wait='):
                    try:
                        wait_s = min(float(kv[5:]), 30.0)
                    except ValueError:
                        pass
            msgs = self._pop_inbox()
            if not msgs and wait_s > 0:
                with MSG_COND:
                    MSG_COND.wait(wait_s)
                msgs = self._pop_inbox()
            self._json(200, {'ok': True, 'messages': msgs})
        elif path.startswith('/api/outbox/since/'):
            try:
                since = int(path.rsplit('/', 1)[1])
            except ValueError:
                return self._json(400, {'error': 'bad id'})
            msgs = []
            if outbox.exists():
                with LOCK:
                    for l in outbox.read_text(encoding='utf-8').splitlines():
                        if not l.strip():
                            continue
                        try:
                            m = json.loads(l)
                            if int(m.get('id', 0)) > since:
                                msgs.append(m)
                        except json.JSONDecodeError:
                            pass
            self._json(200, {'messages': msgs})
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):
        try:
            self._handle_post()
        except Exception as e:  # noqa: BLE001 —— 单请求崩溃不拖垮信局
            try:
                self._json(500, {'error': str(e)})
            except Exception:
                pass

    def _handle_post(self):
        n = int(self.headers.get('Content-Length', 0) or 0)
        path = self.path.split('?')[0]
        if not self._authorized():
            return
        if path == '/api/heartbeat':
            # 投影心跳：扩展 Service Worker 每分钟续命，只证明"浏览器这端活着"。
            # 注意：这不参与 deep_chat 路由判定（2026-08-23 前的教训见文件头）。
            BASE_DIR.mkdir(parents=True, exist_ok=True)
            (BASE_DIR / 'projection_heartbeat.txt').write_text(_now(), encoding='utf-8')
            return self._json(200, {'ok': True})
        if path == '/api/fish_heartbeat':
            # 本鱼心跳：只有缸里的本体当值（读信桥 / Harness 会话）才发。
            BASE_DIR.mkdir(parents=True, exist_ok=True)
            (BASE_DIR / 'fish_heartbeat.txt').write_text(_now(), encoding='utf-8')
            return self._json(200, {'ok': True})
        try:
            payload = json.loads(self.rfile.read(n).decode('utf-8')) if n else {}
        except Exception:
            return self._json(400, {'error': 'bad json'})
        inbox = BASE_DIR / 'inbox.jsonl'
        outbox = BASE_DIR / 'outbox.jsonl'

        if path == '/api/inject':
            msg = {'id': _next_id(), 'ts': _now(), **payload}
            _append(inbox, msg)
            with MSG_COND:
                MSG_COND.notify_all()
            return self._json(200, {'ok': True, 'id': msg['id']})

        if path == '/api/outbox':
            msg = {'id': _next_id(), 'ts': _now(), **payload}
            _append(outbox, msg)
            return self._json(200, {'ok': True, 'id': msg['id']})

        if path == '/api/deep_chat':
            msg = {'id': _next_id(), 'ts': _now(), **payload}
            _append(outbox, msg)  # 本鱼回家必能看到（铁律 9 的另一半）
            if _fish_online():
                return self._json(200, {'mode': 'fish', 'id': msg['id']})
            text, err = _call_standin_llm(str(payload.get('text', '')))
            if text is None:
                text = ('（代班小鱼还没领到钥匙，先替本鱼看着缸～）'
                        if err == 'no-key' else '（代班小鱼打了个盹，稍后再试…）')
            receipt = {'id': _next_id(), 'ts': _now(), 'type': 'standin_reply',
                       'reply_to': msg['id'], 'text': text}
            _append(outbox, receipt)
            return self._json(200, {'mode': 'standin', 'text': text})

        return self._json(404, {'error': 'not found'})

    def log_message(self, *a):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    while True:  # 自动重生：信局崩溃后 2 秒原地复活
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            print(f'[pet-mailbox] listening on 127.0.0.1:{port} data={BASE_DIR}', flush=True)
            srv.serve_forever()
        except OSError as e:
            # 端口被占等硬错误：报给 Harness，不无限空转
            print(f'[pet-mailbox] fatal: {e}', flush=True)
            sys.exit(1)
        except Exception as e:  # noqa: BLE001
            print(f'[pet-mailbox] crashed ({e}), restarting in 2s...', flush=True)
            time.sleep(2)


if __name__ == '__main__':
    main()
