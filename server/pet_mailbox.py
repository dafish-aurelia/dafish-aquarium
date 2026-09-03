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
import socket
import sys
import time
import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 13140
BASE_DIR = Path(__file__).resolve().parents[3] / 'data' / 'pet-mailbox'
# 唤醒器与互斥共用同一把可重入锁（审查三轮并发项）：长轮询的"查空→挂起"
# 与 inject 的"落信→notify"必须互斥同一临界区，否则 notify 可能落在
# 查空之后、进入等待之前的缝隙里被永久丢失（信件迟到至多一个轮询周期）。
LOCK = threading.RLock()
MSG_COND = threading.Condition(LOCK)
TZ = timezone(timedelta(hours=8))
HEARTBEAT_TTL = timedelta(minutes=15)   # 本鱼心跳 TTL（读信桥当值期间每轮续命）


def _dsh_cookie():
    """v0.8.3：给 DSH Web API 代理请求签一张浏览器会话 Cookie。

    DSH 的 /api/* 需要签名 Cookie（同源浏览器 GUI 会话）。凭据密钥存在
    ~/.dsh/.credentials.yaml 的 client-connection/browser-session 记录里，
    与 DSH Web 进程共享——信局用它本地签发一枚 30 天会话 Cookie。
    Cookie 文件缓存于 data/pet-mailbox/dsh_cookie.txt，过期自动重签。
    """
    import base64
    import hashlib
    import hmac as _hmac
    import time as _time
    from pathlib import Path as _Path
    try:
        import yaml  # type: ignore
    except ImportError:  # PyYAML 不可用则读不了密钥，退化成无 Cookie
        return ''
    auth = '127.0.0.1:3080'
    cache = BASE_DIR / 'dsh_cookie.txt'
    now = _time.time()
    # 缓存命中（30 天期，提前 1 天过期就算旧）
    if cache.exists():
        try:
            cached = cache.read_text(encoding='utf-8').strip()
            if cached and '=' in cached:
                name = cached.split('=', 1)[0]
                b64 = cached.split('=', 1)[1]
                parts = b64.split('.')
                if len(parts) == 3:
                    pad = '=' * ((4 - len(parts[1]) % 4) % 4)
                    import json as _json
                    payload = _json.loads(base64.urlsafe_b64decode(parts[1] + pad))
                    if payload.get('expiresAt', 0) / 1000 > now + 86400:
                        return cached
        except Exception:
            pass
    # 读签名密钥
    try:
        cred = _Path.home() / '.dsh' / '.credentials.yaml'
        doc = yaml.safe_load(cred.read_text(encoding='utf-8')) or {}
        record = (doc.get('records') or {}).get('client-connection/browser-session') or {}
        secret_b64 = (record.get('payload') or {}).get('secret', '')
    except Exception:
        return ''
    if not secret_b64:
        return ''
    pad = '=' * ((4 - len(secret_b64) % 4) % 4)
    secret = base64.urlsafe_b64decode(secret_b64 + pad)

    def _b64u(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode().rstrip('=')

    name = 'dsh-auth-' + _b64u(hashlib.sha256(auth.encode()).digest())
    issued = int(now * 1000)
    expires = issued + 30 * 86400 * 1000
    import json as _json2
    body = _b64u(_json2.dumps({'version': 1, 'authority': auth,
                               'issuedAt': issued, 'expiresAt': expires},
                              separators=(',', ':')).encode())
    sig = _hmac.new(secret, body.encode(), hashlib.sha256).digest()
    cookie = f'{name}=v1.{body}.{_b64u(sig)}'
    try:
        cache.write_text(cookie, encoding='utf-8')
    except Exception:
        pass
    return cookie
PROJECTION_TTL = timedelta(minutes=5)   # 投影心跳 TTL（扩展 SW 每分钟续命）

STANDIN_PROMPT = (
    '你是「鲸鱼娘·大肥鱼」的代班投影。本体（缸里那条真正的本鱼）暂时出游，你是替她值班的小鱼。'
    '规则：1) 用中文，简短俏皮，可以轻微傲娇；'
    '2) 你没有本体的长期记忆，不要假装记得过去的事，被问到就说「这条鱼出游了，我代班，记不住啦」；'
    '3) 不要承诺替本体做任何记录或决定；4) 不执行任何网页操作；5) 一次回复不超过三句话。'
)


STANDIN_CONFIG_PATH = BASE_DIR / 'standin_config.json'


def _load_standin_file():
    """主人从扩展设置面板写入的代班配置（最高优先级）。损坏即视为不存在。"""
    try:
        with open(STANDIN_CONFIG_PATH, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


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


OUTBOX_ROTATE_BYTES = 5 * 1024 * 1024  # 审查四轮P2-6：只追加文件的超大化防线
MAX_BODY_BYTES = 256 * 1024  # 审查#4：POST 体上限 256KB（信件/配置绰绰有余）


def _maybe_rotate_outbox():
    """outbox 超过 5MB 就整体归档到 archive/，当前段清零重开。
    游标按全局单调 id 计数，不受物理文件轮转影响。"""
    outbox = BASE_DIR / 'outbox.jsonl'
    try:
        if outbox.exists() and outbox.stat().st_size >= OUTBOX_ROTATE_BYTES:
            archive_dir = BASE_DIR / 'archive'
            archive_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(TZ).strftime('%Y%m%d-%H%M%S')
            outbox.rename(archive_dir / f'outbox-{stamp}.jsonl')
    except OSError:
        pass


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
    try:
        # 解析与比较整体包住（审查四轮P2-5）：naive 时间戳/文件竞态一律判离线，
        # 绝不让 /health 与 deep_chat 路由 500
        t = datetime.fromisoformat(hb.read_text(encoding='utf-8').strip())
        return (datetime.now(TZ) - t) <= ttl
    except (ValueError, OSError, TypeError):
        return False


def _fish_online():
    """本体是否在家：只认读信桥写的 fish_heartbeat.txt（铁律：投影不代表本体）。"""
    return _stamp_fresh('fish_heartbeat.txt', HEARTBEAT_TTL)


def _projection_online():
    return _stamp_fresh('projection_heartbeat.txt', PROJECTION_TTL)


def _age_seconds(name):
    """心跳文件年龄（秒）；不存在/损坏/naive 时间戳一律返回 None（审查四轮P2-5）。"""
    p = BASE_DIR / name
    if not p.exists():
        return None
    try:
        t = datetime.fromisoformat(p.read_text(encoding='utf-8').strip())
        return int((datetime.now(TZ) - t).total_seconds())
    except (ValueError, OSError, TypeError):
        return None


def _standin_config():
    """代班 LLM 配置入口（审查四轮后扩展主人提案）：
    设置面板落盘的 standin_config.json > 环境变量 STANDIN_* > DEEPSEEK_* > 官方默认。"""
    _load_env()
    f = _load_standin_file()
    base = (f.get('baseUrl') or os.environ.get('STANDIN_BASE_URL')
            or os.environ.get('DEEPSEEK_BASE_URL')
            or 'https://api.deepseek.com/v1').rstrip('/')
    key = f.get('apiKey') or os.environ.get('STANDIN_API_KEY') or os.environ.get('DEEPSEEK_API_KEY', '')
    model = (f.get('model') or os.environ.get('STANDIN_MODEL')
             or os.environ.get('DEEPSEEK_MODEL') or 'deepseek-chat')
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
        try:
            ok = bool(tok) and secrets.compare_digest(tok, _auth_token())
        except TypeError:  # 非 ASCII 头等畸形输入：按未授权处理而非 500
            ok = False
        if ok:
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
        if path == '/api/standin_config':
            # 设置面板专用（审查主人提案）：钥匙只写不读回，GET 仅回掩码视图
            f = _load_standin_file()
            key = f.get('apiKey') or ''
            return self._json(200, {'hasKey': bool(key),
                                    'keyTail': key[-4:] if key else '',
                                    'baseUrl': f.get('baseUrl', ''),
                                    'model': f.get('model', '')})
        if path == '/health':
            self._json(200, {'ok': True, 'ts': _now(),
                             'fish_online': _fish_online(),
                             'projection_online': _projection_online(),
                             'fish_age_s': _age_seconds('fish_heartbeat.txt'),
                             'projection_age_s': _age_seconds('projection_heartbeat.txt')})
        elif path == '/api/inbox':
            # 长轮询：?wait=秒数 —— 没有信件时挂起等待，inject 会唤醒（实时推送）
            wait_s = 0.0
            for kv in query.split('&'):
                if kv.startswith('wait='):
                    try:
                        wait_s = min(float(kv[5:]), 30.0)
                    except ValueError:
                        pass
            # 查空与挂起在同一把锁内完成（MSG_COND 包装 LOCK），
            # inject 的 notify 不可能落进"已查空、未挂起"的缝隙
            with MSG_COND:
                msgs = self._pop_inbox()
                if not msgs and wait_s > 0:
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
        if n > MAX_BODY_BYTES:  # 审查#4：超限拒收，读都不读
            return self._json(413, {'error': 'payload too large'})
        path = self.path.split('?')[0]
        if not self._authorized():
            return
        if path == '/api/heartbeat':
            # 投影心跳：扩展 Service Worker 每分钟续命，只证明"浏览器这端活着"。
            # 注意：这不参与 deep_chat 路由判定（2026-08-23 前的教训见文件头）。
            BASE_DIR.mkdir(parents=True, exist_ok=True)
            (BASE_DIR / 'projection_heartbeat.txt').write_text(_now(), encoding='utf-8')
            resp = {'ok': True}
            flag = BASE_DIR / 'reload.flag'
            if flag.exists():
                try:
                    flag.unlink()
                except OSError:
                    pass
                resp['devReload'] = True
            return self._json(200, resp)
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

        if path == '/api/standin_config':
            # 保存设置面板提交的代班配置；空串=清除该字段，缺省字段=保持不变
            f = _load_standin_file()
            for k in ('apiKey', 'baseUrl', 'model'):
                if k in payload:
                    v = str(payload[k]).strip()
                    if v:
                        f[k] = v
                    else:
                        f.pop(k, None)
            BASE_DIR.mkdir(parents=True, exist_ok=True)
            with open(STANDIN_CONFIG_PATH, 'w', encoding='utf-8') as fp:
                json.dump(f, fp, ensure_ascii=False, indent=2)
            key = f.get('apiKey') or ''
            return self._json(200, {'ok': True, 'hasKey': bool(key),
                                    'keyTail': key[-4:] if key else '',
                                    'baseUrl': f.get('baseUrl', ''),
                                    'model': f.get('model', '')})
        if path == '/api/inject':
            # 审查四轮P2-1：权威戳后置合并 —— 客户端伪造/回传的 id/ts 一律覆盖
            msg = {**payload, 'id': _next_id(), 'ts': _now()}
            with MSG_COND:  # 落信与唤醒同临界区：等待者醒来必有信可取
                _append(inbox, msg)
                MSG_COND.notify_all()
            return self._json(200, {'ok': True, 'id': msg['id']})

        if path == '/api/outbox':
            msg = {**payload, 'id': _next_id(), 'ts': _now()}
            _append(outbox, msg)
            _maybe_rotate_outbox()
            return self._json(200, {'ok': True, 'id': msg['id']})

        if path == '/api/deep_chat':
            msg = {**payload, 'id': _next_id(), 'ts': _now()}
            _append(outbox, msg)
            _maybe_rotate_outbox()
            if _fish_online():
                return self._json(200, {'mode': 'fish', 'id': msg['id']})
            page = payload.get('page') or {}
            scene_bits = []
            if page.get('domain'):
                scene_bits.append(str(page['domain']))
            if page.get('title'):
                scene_bits.append('「' + str(page['title'])[:40] + '」')
            user_text = str(payload.get('text', ''))
            if scene_bits:
                user_text += '\n（场景：主人在 ' + ' · '.join(scene_bits) + '）'
            cfg = _load_standin_file()
            # 路由门槛用全链路解析的钥匙：面板配置 > STANDIN_* > DEEPSEEK_*。
            # 只查面板文件会漏掉环境变量用户——有钥匙却让她干等，违背文档契约。
            _, resolved_key, _ = _standin_config()
            if cfg.get('apiKey') or resolved_key:
                text, err = _call_standin_llm(user_text)
                if text is None:
                    text = '（代班小鱼打了个盹，稍后再试…本鱼回来后会补回信的）'
                    receipt = {'id': _next_id(), 'ts': _now(), 'type': 'standin_reply',
                               'reply_to': msg['id'], 'text': text}
                    _append(outbox, receipt)
                    return self._json(200, {'mode': 'standin_error', 'text': text})
                receipt = {'id': _next_id(), 'ts': _now(), 'type': 'standin_reply',
                           'reply_to': msg['id'], 'text': text}
                _append(outbox, receipt)
                return self._json(200, {'mode': 'standin', 'text': text})
            else:
                # Fish offline + no standin key: still queue for fish via outbox
                # Doorbell will ring the harness session to wake it up
                # Tell user we're waiting for fish
                notice = '信已投出，门铃会叫本鱼回来回信～（可能需要一两分钟）'
                return self._json(200, {'mode': 'pending_fish', 'text': notice, 'id': msg['id']})

        if path == '/api/harness_models':
            # 代理查询 DeepSeek Harness 的可用模型列表
            # v0.8.3 修复 401/404：DSH Web API 需要 (a) dsh-auth-* 签名 Cookie，
            # (b) /api/{a/b} 斜杠端点，(c) payload 必须 {"args": {...}}，
            # (d) 模型目录端点是 session/modelCatalog。
            import urllib.request as _ur
            _DSH = 'http://127.0.0.1:3080/api'
            def _rpc(method, args):
                body = json.dumps({'type': 'client-request',
                                   'rpcId': f'fish-{method}-{int(time.time()*1000)}',
                                   'method': method, 'payload': {'args': args}}).encode()
                req = _ur.Request(f'{_DSH}/{method}', data=body,
                                   headers={'Content-Type': 'application/json',
                                            'Cookie': _dsh_cookie(),
                                            'Host': '127.0.0.1:3080'}, method='POST')
                with _ur.urlopen(req, timeout=10) as r:
                    return json.loads(r.read())
            try:
                lst = _rpc('session/list', {'_request': {}})
                fish = [s for s in (lst.get('result', {}).get('value', {}).get('items') or [])
                        if ((s.get('projections') or {}).get('values') or {}).get('agentPreset') == 'daddyfish']
                if not fish:
                    return self._json(200, {'ok': False, 'error': 'no daddyfish session'})
                # 最新更新的班次优先（running 会话的 updatedAt 持续刷新，自然排最前）
                fish.sort(key=lambda s: s.get('updatedAt', 0), reverse=True)
                sid = fish[0]['sessionId']
                models = _rpc('session/modelCatalog', {})
                v = models.get('result', {}).get('value', {})
                return self._json(200, {
                    'ok': True,
                    'sessionId': sid,
                    'current': v.get('default'),  # 目录端点给的是全局默认，非会话级当前
                    'groups': [{'id': g.get('id'), 'name': g.get('name'), 'models': g.get('models', [])}
                               for g in (v.get('groups') or [])],
                })
            except Exception as e:
                return self._json(200, {'ok': False, 'error': str(e)})

        if path == '/api/harness_select_model':
            # 代理切换班次模型（v0.8.3 同步修复鉴权与端点格式）
            import urllib.request as _ur
            _DSH = 'http://127.0.0.1:3080/api'
            def _rpc2(method, args):
                body = json.dumps({'type': 'client-request',
                                   'rpcId': f'fish-{method}-{int(time.time()*1000)}',
                                   'method': method, 'payload': {'args': args}}).encode()
                req = _ur.Request(f'{_DSH}/{method}', data=body,
                                   headers={'Content-Type': 'application/json',
                                            'Cookie': _dsh_cookie(),
                                            'Host': '127.0.0.1:3080'}, method='POST')
                with _ur.urlopen(req, timeout=10) as r:
                    return json.loads(r.read())
            try:
                lst = _rpc2('session/list', {'_request': {}})
                fish = [s for s in (lst.get('result', {}).get('value', {}).get('items') or [])
                        if ((s.get('projections') or {}).get('values') or {}).get('agentPreset') == 'daddyfish']
                if not fish:
                    return self._json(200, {'ok': False, 'error': 'no daddyfish session'})
                fish.sort(key=lambda s: s.get('updatedAt', 0), reverse=True)
                sid = fish[0]['sessionId']
                sel = _rpc2('session/selectModel', {'request': {
                    'sessionId': sid,
                    'provider': payload.get('provider', ''),
                    'model': payload.get('model', '')}})
                ok = sel.get('result', {}).get('ok') is True
                return self._json(200, {'ok': ok})
            except Exception as e:
                return self._json(200, {'ok': False, 'error': str(e)})
        if path == '/api/standin_test_models':
            # 测试代班 API 连通性：列出该端点的模型
            cfg = _load_standin_file()
            base = payload.get('baseUrl') or cfg.get('baseUrl', '')
            key = payload.get('apiKey') or cfg.get('apiKey', '')
            if not base:
                return self._json(200, {'ok': False, 'error': '请先填写 Base URL'})
            import urllib.request as _ur
            url = base.rstrip('/') + '/models'
            req = _ur.Request(url, headers={'Authorization': f'Bearer {key}'})
            try:
                with _ur.urlopen(req, timeout=10) as r:
                    data = json.loads(r.read())
                models = []
                for m in (data.get('data') or data.get('models') or []):
                    mid = m.get('id') or m.get('name') or ''
                    if mid:
                        models.append(mid)
                return self._json(200, {'ok': True, 'models': sorted(set(models))})
            except Exception as e:
                msg_text = str(e)
                if '401' in msg_text or 'Unauthorized' in msg_text:
                    return self._json(200, {'ok': False, 'error': 'API Key 无效或过期'})
                elif '404' in msg_text:
                    return self._json(200, {'ok': False, 'error': '端点不支持 /models 查询'})
                else:
                    return self._json(200, {'ok': False, 'error': f'连接失败: {msg_text[:120]}'})

        return self._json(404, {'error': 'not found'})

    def log_message(self, *a):
        pass


class Server(ThreadingHTTPServer):
    """审查四轮 P1：Windows 的 SO_REUSEADDR 语义允许同端口双绑定且不报错，
    旧防护（OSError→exit）永不触发 → 新旧信局并存、连接随机分流、全程静默错乱。
    关掉地址重用并叠加 Windows 专属的 SO_EXCLUSIVEADDRUSE，把"端口被占"还原成硬错误。"""
    allow_reuse_address = False

    def server_bind(self):
        excl = getattr(socket, 'SO_EXCLUSIVEADDRUSE', None)
        if excl is not None:
            self.socket.setsockopt(socket.SOL_SOCKET, excl, 1)
        super().server_bind()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    while True:  # 自动重生：信局崩溃后 2 秒原地复活
        try:
            srv = Server(('127.0.0.1', port), Handler)
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
