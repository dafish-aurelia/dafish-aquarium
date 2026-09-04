# -*- coding: utf-8 -*-
"""看门狗兜底拉信局的测试：SW 睡着（无 pulse）时信局死了也能自愈。"""
import importlib.util
import os
import threading
import time
from unittest import mock

import pytest

_HOST = os.path.join(os.path.dirname(__file__), '..', 'native-host', 'gatekeeper_host_lite.py')
_spec = importlib.util.spec_from_file_location('gatekeeper_host_lite', _HOST)
host = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(host)


def test_watchdog_revives_dead_mailbox_without_pulse(monkeypatch):
    """2026-09-04 空窗回归锚：信局死 + 无 pulse → 看门狗自己补拉。

    事故：杀掉信局后，看护 6 分钟没人补（_ensure_mailbox 只挂在
    main 循环的 pulse 处理上；SW 睡着就没有 pulse）。
    修复后：watchdog 循环里 _mailbox_alive() 为 False 时直接 Popen。
    """
    popen_calls = []
    monkeypatch.setattr(host, '_mailbox_alive', lambda: False)
    monkeypatch.setattr(host, '_spawn_python', lambda: 'VENV_PY')
    monkeypatch.setattr(host, '_ensure_doorbell', lambda: None)
    popen = mock.MagicMock()
    popen_calls.append(popen)
    monkeypatch.setattr(host.subprocess, 'Popen', popen)

    stop = threading.Event()
    t = threading.Thread(target=host._revive_watchdog, args=(stop,), daemon=True)
    t.start()
    stop.set()  # 立刻停：watchdog 的 wait(60) 在启动前就被 set → 不会跑循环体
    t.join(timeout=2)
    # wait(60) 先于循环体检查 stop_event —— 用假时钟直接驱动一轮
    popen.reset_mock()
    # 手动执行一轮循环体逻辑（等价于 stop_event.wait 返回 False 一次）
    with mock.patch.object(host, '_send_message'):
        # 直接复刻循环体：mailbox 死 → Popen
        assert host._mailbox_alive() is False
        import subprocess as _sp
        with mock.patch.object(_sp, 'Popen') as p2:
            monkeypatch.setattr(host.subprocess, 'Popen', p2)
            host._revive_watchdog_once()
            p2.assert_called_once()
            args, kwargs = p2.call_args
            assert args[0][0] == 'VENV_PY'          # venv 解释器
            assert args[0][1] == host.MAILBOX        # 信局脚本
            assert kwargs.get('creationflags') == 0x08000000  # NO_WINDOW


def test_watchdog_alive_mailbox_does_not_spawn(monkeypatch):
    """信局活着时看门狗不重复拉（避免 60s 一发的进程炸弹）。"""
    monkeypatch.setattr(host, '_mailbox_alive', lambda: True)
    import subprocess as _sp
    with mock.patch.object(_sp, 'Popen') as p:
        monkeypatch.setattr(host.subprocess, 'Popen', p)
        host._revive_watchdog_once()
        p.assert_not_called()
