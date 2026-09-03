# -*- coding: utf-8 -*-
"""信局 v2 测试：原子消费、游标、心跳路由、代班代理。"""
import datetime
import importlib.util
import json
import os
import threading
import urllib.error
import urllib.request

import pytest

_SERVER = os.path.join(os.path.dirname(__file__), '..', 'server', 'pet_mailbox.py')
_spec = importlib.util.spec_from_file_location('pet_mailbox', _SERVER)
pm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pm)


@pytest.fixture()
def base(tmp_path, monkeypatch):
    monkeypatch.setattr(pm, 'BASE_DIR', tmp_path)
    srv = pm.ThreadingHTTPServer(('127.0.0.1', 0), pm.Handler)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()


_TOKS = {}


def _token(base):
    """审查#6：信局全端点鉴权，测试先经 Host 钉扎的 /api/token 引导取钥匙。"""
    if base not in _TOKS:
        with urllib.request.urlopen(base + '/api/token') as r:
            _TOKS[base] = json.loads(r.read())['token']
    return _TOKS[base]


def get(base, path):
    req = urllib.request.Request(base + path, headers={'X-Dafeiyu-Token': _token(base)})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def post(base, path, obj):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode(),
                                 headers={'Content-Type': 'application/json',
                                          'X-Dafeiyu-Token': _token(base)},
                                 method='POST')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def test_health(base):
    assert get(base, '/health')['ok'] is True


def test_api_rejects_missing_token(base):
    with pytest.raises(urllib.error.HTTPError) as ei:
        urllib.request.urlopen(base + '/health')
    assert ei.value.code == 401


def test_api_rejects_wrong_token(base):
    req = urllib.request.Request(base + '/health', headers={'X-Dafeiyu-Token': 'wrong'})
    with pytest.raises(urllib.error.HTTPError) as ei:
        urllib.request.urlopen(req)
    assert ei.value.code == 401


def test_token_endpoint_pins_loopback_host(base):
    req = urllib.request.Request(base + '/api/token')
    req.add_header('Host', 'evil.com')  # DNS rebinding 模拟：非回环 Host 一律 403
    with pytest.raises(urllib.error.HTTPError) as ei:
        urllib.request.urlopen(req)
    assert ei.value.code == 403


def test_inject_then_inbox_pop_once(base):
    post(base, '/api/inject', {'type': 'proactive', 'text': 'a'})
    post(base, '/api/inject', {'type': 'reply', 'text': 'b'})
    m1 = get(base, '/api/inbox')['messages']
    assert [m['text'] for m in m1] == ['a', 'b']
    assert all('id' in m and 'ts' in m for m in m1)
    assert get(base, '/api/inbox')['messages'] == []


def test_longpoll_woken_by_late_inject(base):
    """审查三轮并发回归：取信者先挂起，1 秒后才 inject —— 唤醒必须即时到达，
    不能因"查空与挂起不同临界区"而睡满整个 wait 时长。"""
    import time as _time

    def late_inject():
        _time.sleep(1.0)
        post(base, '/api/inject', {'type': 'reply', 'text': '迟到的信'})

    th = threading.Thread(target=late_inject, daemon=True)
    th.start()
    t0 = _time.time()
    msgs = get(base, '/api/inbox?wait=25')['messages']
    elapsed = _time.time() - t0
    th.join(5)
    assert [m['text'] for m in msgs] == ['迟到的信']
    assert elapsed < 10, f'唤醒耗时 {elapsed:.1f}s —— 疑似丢唤醒睡满了 wait'


def test_server_stamp_overrides_client_id_ts(base):
    """审查四轮P2-1 回归：客户端伪造的 id/ts 不得覆盖服务端权威戳。"""
    r = post(base, '/api/inject', {'type': 'reply', 'text': '伪造尝试',
                                   'id': 424242, 'ts': '2000-01-01T00:00:00+08:00'})
    assert r['id'] != 424242
    msgs = get(base, '/api/inbox')['messages']
    mine = [m for m in msgs if m.get('text') == '伪造尝试']
    assert len(mine) == 1
    assert mine[0]['id'] != 424242
    assert mine[0]['ts'] != '2000-01-01T00:00:00+08:00'


def test_naive_timestamp_fails_safe(base, tmp_path):
    """审查四轮P2-5 回归：naive 心跳时间戳只判离线，绝不让 /health 与路由 500。"""
    (tmp_path / 'fish_heartbeat.txt').write_text(
        datetime.datetime.now().isoformat(timespec='seconds'), encoding='utf-8')  # 无时区
    assert pm._fish_online() is False
    assert get(base, '/health')['ok'] is True


def test_concurrent_pop_no_duplicate(base):
    for i in range(5):
        post(base, '/api/inject', {'type': 'proactive', 'text': str(i)})
    got = []

    def pop():
        got.extend(get(base, '/api/inbox')['messages'])

    ts = [threading.Thread(target=pop) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(m['text'] for m in got) == ['0', '1', '2', '3', '4']


def test_outbox_since_cursor(base):
    ids = [post(base, '/api/outbox', {'type': 'deep_chat', 'text': str(i)})['id'] for i in range(3)]
    assert ids == sorted(ids) and len(set(ids)) == 3
    assert len(get(base, '/api/outbox/since/0')['messages']) == 3
    tail = get(base, f'/api/outbox/since/{ids[1]}')['messages']
    assert [m['id'] for m in tail] == [ids[2]]


def test_bad_path_404(base):
    with pytest.raises(urllib.error.HTTPError):
        get(base, '/api/nope')


def test_deep_chat_routed_to_fish_when_online(base, tmp_path, monkeypatch):
    now = datetime.datetime.now(pm.TZ).isoformat(timespec='seconds')
    (tmp_path / 'fish_heartbeat.txt').write_text(now, encoding='utf-8')
    monkeypatch.setattr(pm, '_call_standin_llm', lambda t: ('不该被调用', None))

    r = post(base, '/api/deep_chat', {'type': 'deep_chat', 'text': '在吗'})
    assert r['mode'] == 'fish'

    msgs = get(base, '/api/outbox/since/0')['messages']
    assert any(m['type'] == 'deep_chat' for m in msgs)
    assert not any(m['type'] == 'standin_reply' for m in msgs)


def test_projection_heartbeat_never_routes_to_fish(base, tmp_path, monkeypatch):
    """回归（2026-08-23 断流事故）：扩展投影心跳再新鲜，也不能让信转给不在家的本体。"""
    now = datetime.datetime.now(pm.TZ).isoformat(timespec='seconds')
    post(base, '/api/heartbeat', {})  # 扩展 SW 的投影心跳
    (tmp_path / 'projection_heartbeat.txt').write_text(now, encoding='utf-8')
    assert pm._projection_online() is True
    assert pm._fish_online() is False
    # 有代班钥匙时：投影心跳不该路由给本体，但信要由代班接住秒回
    monkeypatch.setattr(pm, '_standin_config', lambda: ('https://x/v1', 'k', 'm'))
    monkeypatch.setattr(pm, '_call_standin_llm', lambda t: ('代班小鱼在岗', None))

    r = post(base, '/api/deep_chat', {'type': 'deep_chat', 'text': '在吗'})
    assert r['mode'] == 'standin'


def test_deep_chat_standin_when_offline(base, tmp_path, monkeypatch):
    monkeypatch.setattr(pm, '_standin_config', lambda: ('https://x/v1', 'k', 'm'))
    monkeypatch.setattr(pm, '_call_standin_llm', lambda t: ('代班小鱼在岗', None))

    r = post(base, '/api/deep_chat', {'type': 'deep_chat', 'text': '在吗'})
    assert r['mode'] == 'standin'
    assert '代班' in r['text']

    msgs = get(base, '/api/outbox/since/0')['messages']
    standins = [m for m in msgs if m['type'] == 'standin_reply']
    assert len(standins) == 1 and standins[0]['text'] == '代班小鱼在岗'
    assert any(m['type'] == 'deep_chat' for m in msgs)


def test_deep_chat_pending_when_no_key(base, tmp_path, monkeypatch):
    """无处代班（面板与环境变量都没有钥匙）：信不即焚，排队等本体+门铃叫醒。"""
    monkeypatch.setattr(pm, '_standin_config', lambda: ('', '', ''))
    monkeypatch.setattr(pm, '_call_standin_llm', lambda t: ('不该被调用', None))

    r = post(base, '/api/deep_chat', {'type': 'deep_chat', 'text': '在吗'})
    assert r['mode'] == 'pending_fish'
    assert r['id']  # 信已落 outbox，本体回来必能看到

    msgs = get(base, '/api/outbox/since/0')['messages']
    assert any(m['type'] == 'deep_chat' for m in msgs)
    assert not any(m['type'] == 'standin_reply' for m in msgs)


def test_heartbeat_expiry(base, tmp_path):
    old = (datetime.datetime.now(pm.TZ) - datetime.timedelta(minutes=20)).isoformat(timespec='seconds')
    (tmp_path / 'fish_heartbeat.txt').write_text(old, encoding='utf-8')
    assert pm._fish_online() is False


def test_pop_inbox_recovers_stale_consumed(base, tmp_path):
    """审查#4 回归：崩溃残留的 consumed 文件先并回再消费，不丢信也不卡死。"""
    (tmp_path / 'inbox.consumed.jsonl').write_text(
        json.dumps({'type': 'proactive', 'text': '残留'}) + '\n', encoding='utf-8')
    post(base, '/api/inject', {'type': 'reply', 'text': '新信'})
    msgs = get(base, '/api/inbox')['messages']
    assert [m['text'] for m in msgs] == ['残留', '新信']
    assert not (tmp_path / 'inbox.consumed.jsonl').exists()


def test_pop_inbox_quarantines_bad_line(base, tmp_path):
    """审查#4 回归：单行坏 JSON 只隔离留证，不再滞留整批信件。"""
    good = json.dumps({'type': 'reply', 'text': '好信'})
    (tmp_path / 'inbox.jsonl').write_text(good + '\n这不是JSON\n', encoding='utf-8')
    msgs = get(base, '/api/inbox')['messages']
    assert [m['text'] for m in msgs] == ['好信']
    assert '这不是JSON' in (tmp_path / 'inbox.bad.jsonl').read_text(encoding='utf-8')


def test_standin_config_precedence(base, monkeypatch):
    """STANDIN_* 优先于 DEEPSEEK_*；全空时回落官方默认且无钥匙。"""
    cfg = pm._standin_config
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'k-deepseek')
    monkeypatch.setenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1/')
    monkeypatch.setenv('STANDIN_API_KEY', 'k-standin')
    monkeypatch.setenv('STANDIN_BASE_URL', 'https://api.siliconflow.cn/v1/')
    monkeypatch.setenv('STANDIN_MODEL', 'deepseek-ai/DeepSeek-V3')
    b, k, m = cfg()
    assert (b, k, m) == ('https://api.siliconflow.cn/v1', 'k-standin', 'deepseek-ai/DeepSeek-V3')

    for name in ('STANDIN_API_KEY', 'STANDIN_BASE_URL', 'STANDIN_MODEL'):
        monkeypatch.delenv(name)
    b, k, m = cfg()
    assert b == 'https://api.deepseek.com/v1'
    assert (k, m) == ('k-deepseek', 'deepseek-chat')

    monkeypatch.delenv('DEEPSEEK_API_KEY')
    monkeypatch.delenv('DEEPSEEK_BASE_URL')
    monkeypatch.delenv('DEEPSEEK_MODEL', raising=False)
    b, k, m = cfg()
    assert b == 'https://api.deepseek.com/v1' and k == '' and m == 'deepseek-chat'


def test_post_rejects_oversized_body(base):
    """审查#4：请求体超上限按 413 拒绝，而不是全量读进内存。"""
    big = json.dumps({'text': 'x' * (pm.MAX_BODY_BYTES + 1)}).encode()
    req = urllib.request.Request(base + '/api/outbox', data=big,
                                 headers={'Content-Type': 'application/json',
                                          'X-Dafeiyu-Token': _token(base)},
                                 method='POST')
    with pytest.raises(urllib.error.HTTPError) as ei:
        urllib.request.urlopen(req)
    assert ei.value.code == 413


def test_post_accepts_body_at_exact_limit(base):
    """边界：恰好 MAX_BODY_BYTES 的请求体必须放行（防 > 被改成 >= 的回归）。"""
    # 构造一个 JSON，使其序列化后的字节长度恰好等于 MAX_BODY_BYTES
    overhead = len(json.dumps({'text': ''}))  # {"text": ""} 的骨架长度
    exact = json.dumps({'text': 'x' * (pm.MAX_BODY_BYTES - overhead)}).encode()
    assert len(exact) == pm.MAX_BODY_BYTES
    req = urllib.request.Request(base + '/api/outbox', data=exact,
                                 headers={'Content-Type': 'application/json',
                                          'X-Dafeiyu-Token': _token(base)},
                                 method='POST')
    with urllib.request.urlopen(req) as r:
        assert json.loads(r.read())['ok'] is True
