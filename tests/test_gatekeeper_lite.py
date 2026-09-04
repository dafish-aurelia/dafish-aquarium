# -*- coding: utf-8 -*-
"""看护宿主 lite 测试：解释器选择（venv 优先）与路径推导。"""
import importlib.util
import os
import sys
from pathlib import Path

import pytest

_HOST = os.path.join(os.path.dirname(__file__), '..', 'native-host', 'gatekeeper_host_lite.py')
_spec = importlib.util.spec_from_file_location('gatekeeper_host_lite', _HOST)
host = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(host)


def test_spawn_python_prefers_venv(monkeypatch, tmp_path):
    """2026-09-04 事故回归锚：门铃需要 yaml，必须优先用工作区 .venv 的 python。

    事故链：安装器 bat 用 py -3 探到 PC_Lua 3.14（无 yaml）→ 门铃 DSH 全 401
    → 当日班次不建、铃不响。修复 = _spawn_python 优先 VENV_PY。
    """
    fake_venv = tmp_path / '.venv' / 'Scripts' / 'python.exe'
    fake_venv.parent.mkdir(parents=True)
    fake_venv.write_bytes(b'')
    monkeypatch.setattr(host, 'VENV_PY', str(fake_venv))
    assert host._spawn_python() == str(fake_venv)


def test_spawn_python_falls_back_to_self(monkeypatch):
    monkeypatch.setattr(host, 'VENV_PY', r'Z:\nope\python.exe')  # 不存在
    assert host._spawn_python() == sys.executable


def test_venv_path_convention():
    """VENV_PY 应指向 工作区根/.venv/Scripts/python.exe（EXT_ROOT 上溯两级）。"""
    ws = Path(host.EXT_ROOT).parents[1]
    assert host.VENV_PY == str(ws / '.venv' / 'Scripts' / 'python.exe')
