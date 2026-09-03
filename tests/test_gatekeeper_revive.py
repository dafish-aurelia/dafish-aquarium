# -*- coding: utf-8 -*-
"""gatekeeper_host_lite 复活看门狗（v0.8.1）回归测试：
路径约定、stale 判定、revive 帧协议、stdin EOF 退场。"""
import importlib.util
import io
import json
import os
import struct
import time
from pathlib import Path

import pytest

_EXT = Path(__file__).resolve().parents[1]
_LITE = _EXT / 'native-host' / 'gatekeeper_host_lite.py'
_MAILBOX = _EXT / 'server' / 'pet_mailbox.py'


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='module')
def gkl():
    return _load('gkl_under_test', _LITE)


def test_heartbeat_path_matches_mailbox_basedir(gkl):
    """watchdog 心跳路径必须与信局 BASE_DIR 同目录（v0.8.1 曾差一级 apps/data）。"""
    pm = _load('pm_under_test', _MAILBOX)
    assert Path(gkl.HEARTBEAT_FILE).parent == Path(pm.BASE_DIR)
    assert Path(gkl.HEARTBEAT_FILE).name == 'projection_heartbeat.txt'


def test_stale_missing_file_is_zero(tmp_path, gkl, monkeypatch):
    """信局从未起过（文件不存在）不误报——stale 记 0，不触发 revive。"""
    monkeypatch.setattr(gkl, 'HEARTBEAT_FILE', str(tmp_path / 'nope.txt'))
    assert gkl._heartbeat_stale_s() == 0.0


def test_stale_old_file_triggers(tmp_path, gkl, monkeypatch):
    hb = tmp_path / 'projection_heartbeat.txt'
    hb.write_text('2026-01-01T00:00:00+08:00', encoding='utf-8')
    old = time.time() - 3600
    os.utime(hb, (old, old))
    monkeypatch.setattr(gkl, 'HEARTBEAT_FILE', str(hb))
    stale = gkl._heartbeat_stale_s()
    assert stale > 3600 - 5
    assert stale > gkl.PROJECTION_STALE_S


def test_stale_fresh_file_no_trigger(tmp_path, gkl, monkeypatch):
    hb = tmp_path / 'projection_heartbeat.txt'
    hb.write_text('fresh', encoding='utf-8')
    monkeypatch.setattr(gkl, 'HEARTBEAT_FILE', str(hb))
    assert gkl._heartbeat_stale_s() < gkl.PROJECTION_STALE_S


def test_revive_frame_protocol(gkl):
    """revive 帧必须严格符合 Native Messaging：4 字节 LE 长度前缀 + UTF-8 JSON。"""
    class FakeBuf:
        def __init__(self):
            self.buffer = io.BytesIO()
    fake = FakeBuf()
    real = gkl._PROTO
    gkl._PROTO = fake
    try:
        gkl._send_message({'type': 'revive', 'reason': 'projection-heartbeat-stale'})
        data = fake.buffer.getvalue()
    finally:
        gkl._PROTO = real
    (length,) = struct.unpack('<I', data[:4])
    assert length == len(data) - 4
    payload = json.loads(data[4:].decode('utf-8'))
    assert payload['type'] == 'revive'


def test_watchdog_writes_revive_when_stale(gkl):
    """端到端：_revive_watchdog 在 stale 超限时应产出 revive 帧（单轮，不 sleep 60s）。"""
    class FakeBuf:
        def __init__(self):
            self.buffer = io.BytesIO()
    fake = FakeBuf()
    real_proto = gkl._PROTO
    gkl._PROTO = fake
    stop = __import__('threading').Event()
    stop.set()  # 已停止：while not stop.wait(60) 立即返回 False → 不进循环
    # 单独测循环体：模拟 wait 返回 False（到点）一次
    ran = {'n': 0}
    def fake_wait(timeout=None):
        ran['n'] += 1
        return ran['n'] > 1  # 第一次 False（继续），第二次 True（退出）
    stop.wait = fake_wait
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        hb = Path(td) / 'projection_heartbeat.txt'
        hb.write_text('old', encoding='utf-8')
        old = time.time() - 400
        os.utime(hb, (old, old))
        gkl.HEARTBEAT_FILE = str(hb)
        try:
            gkl._revive_watchdog(stop)
        finally:
            gkl._PROTO = real_proto
    data = fake.buffer.getvalue()
    assert data, 'stale 超限时必须写出 revive 帧'
    (length,) = struct.unpack('<I', data[:4])
    payload = json.loads(data[4:4 + length].decode('utf-8'))
    assert payload['type'] == 'revive'


def test_watchdog_silent_when_fresh(gkl):
    """心跳新鲜时看门狗必须保持安静（不打扰活着的 SW）。"""
    class FakeBuf:
        def __init__(self):
            self.buffer = io.BytesIO()
    fake = FakeBuf()
    real_proto = gkl._PROTO
    gkl._PROTO = fake
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        hb = Path(td) / 'projection_heartbeat.txt'
        hb.write_text('fresh', encoding='utf-8')
        gkl.HEARTBEAT_FILE = str(hb)
        try:
            stop = __import__('threading').Event()
            n = {'i': 0}
            def fake_wait(timeout=None):
                n['i'] += 1
                return n['i'] > 1
            stop.wait = fake_wait
            gkl._revive_watchdog(stop)
        finally:
            gkl._PROTO = real_proto
    assert fake.buffer.getvalue() == b'', '心跳新鲜时不得写任何帧'
