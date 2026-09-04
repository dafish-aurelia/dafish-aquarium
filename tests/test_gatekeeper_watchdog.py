# -*- coding: utf-8 -*-
"""看门狗兜底拉信局的测试：SW 睡着（无 pulse）时信局死了也能自愈。

纪律：绝不同时用 mock.patch.object 和 monkeypatch.setattr 打同一个
模块属性——with 退出时会把 monkeypatch 写入的 mock 当"原值"还原回去，
Popen 从此永久变 MagicMock（2026-09-04 实测污染 installer 全套）。
这里一律只用 monkeypatch（自动、可靠还原）。
"""
import importlib.util
import os
from unittest import mock

import pytest

_HOST = os.path.join(os.path.dirname(__file__), '..', 'native-host', 'gatekeeper_host_lite.py')
_spec = importlib.util.spec_from_file_location('gatekeeper_host_lite', _HOST)
host = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(host)


@pytest.fixture()
def popen_spy(monkeypatch):
    """把 host.subprocess.Popen 换成 spy，记录调用并返回假进程。"""
    calls = []
    def fake_popen(args, **kwargs):
        calls.append({'args': args, 'kwargs': kwargs})
        return mock.MagicMock()
    monkeypatch.setattr(host.subprocess, 'Popen', fake_popen)
    return calls


def test_watchdog_revives_dead_mailbox_without_pulse(monkeypatch, popen_spy):
    """2026-09-04 空窗回归锚：信局死 + 无 pulse → 看门狗自己补拉。

    事故：杀掉信局后，看护 6 分钟没人补（_ensure_mailbox 只挂在
    main 循环的 pulse 处理上；SW 睡着就没有 pulse）。
    修复后：_revive_watchdog_once() 在 _mailbox_alive() 为 False 时
    直接 Popen（venv 解释器、NO_WINDOW），一并补门铃。
    """
    monkeypatch.setattr(host, '_mailbox_alive', lambda: False)
    monkeypatch.setattr(host, '_spawn_python', lambda: 'VENV_PY')
    monkeypatch.setattr(host, '_ensure_doorbell', lambda: None)
    monkeypatch.setattr(host, '_send_message', lambda m: None)

    host._revive_watchdog_once()

    assert len(popen_spy) == 1
    cmd, kwargs = popen_spy[0]['args'], popen_spy[0]['kwargs']
    assert cmd[0] == 'VENV_PY'                          # venv 解释器优先
    assert cmd[1] == host.MAILBOX                       # 信局脚本
    assert kwargs.get('creationflags') == 0x08000000    # NO_WINDOW


def test_watchdog_alive_mailbox_does_not_spawn(monkeypatch, popen_spy):
    """信局活着时看门狗不重复拉（避免 60s 一发的进程炸弹）。"""
    monkeypatch.setattr(host, '_mailbox_alive', lambda: True)
    monkeypatch.setattr(host, '_send_message', lambda m: None)

    host._revive_watchdog_once()

    assert popen_spy == []
