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


def get(base, path):
    with urllib.request.urlopen(base + path) as r:
        return json.loads(r.read())


def post(base, path, obj):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def test_health(base):
    assert get(base, '/health')['ok'] is True


def test_inject_then_inbox_pop_once(base):
    post(base, '/api/inject', {'type': 'proactive', 'text': 'a'})
    post(base, '/api/inject', {'type': 'reply', 'text': 'b'})
    m1 = get(base, '/api/inbox')['messages']
    assert [m['text'] for m in m1] == ['a', 'b']
    assert all('id' in m and 'ts' in m for m in m1)
    assert get(base, '/api/inbox')['messages'] == []


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
    monkeypatch.setattr(pm, '_call_standin_llm', lambda t: ('代班小鱼在岗', None))

    r = post(base, '/api/deep_chat', {'type': 'deep_chat', 'text': '在吗'})
    assert r['mode'] == 'standin'


def test_deep_chat_standin_when_offline(base, tmp_path, monkeypatch):
    monkeypatch.setattr(pm, '_call_standin_llm', lambda t: ('代班小鱼在岗', None))

    r = post(base, '/api/deep_chat', {'type': 'deep_chat', 'text': '在吗'})
    assert r['mode'] == 'standin'
    assert '代班' in r['text']

    msgs = get(base, '/api/outbox/since/0')['messages']
    standins = [m for m in msgs if m['type'] == 'standin_reply']
    assert len(standins) == 1 and standins[0]['text'] == '代班小鱼在岗'
    assert any(m['type'] == 'deep_chat' for m in msgs)


def test_heartbeat_expiry(base, tmp_path):
    old = (datetime.datetime.now(pm.TZ) - datetime.timedelta(minutes=20)).isoformat(timespec='seconds')
    (tmp_path / 'fish_heartbeat.txt').write_text(old, encoding='utf-8')
    assert pm._fish_online() is False


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
