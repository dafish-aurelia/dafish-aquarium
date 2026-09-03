# -*- coding: utf-8 -*-
"""安装器测试：路径解析、bat/manifest 生成、防回归。"""
import importlib.util
import json
import os
from pathlib import Path

import pytest

_INSTALLER = os.path.join(os.path.dirname(__file__), '..', 'installer', 'install.py')
_spec = importlib.util.spec_from_file_location('installer', _INSTALLER)
ins = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ins)


def test_short_path_ascii(tmp_path):
    """含中文的路径必须能换算成 8.3 短路径或安全回退。"""
    target = tmp_path / '工作区' / 'venv' / 'python.exe'
    target.parent.mkdir(parents=True)
    target.write_bytes(b'')
    sp = ins.get_short_path(str(target))
    assert sp.isascii(), f'短路径必须纯 ASCII: {sp!r}'
    assert Path(sp).exists()


def test_manifest_generation(tmp_path):
    """native-host manifest 必须按用户路径生成，allowed_origins 钉死 ID。"""
    bat = ins.render_bat(str(tmp_path / 'venv' / 'python.exe'),
                         str(tmp_path / 'gatekeeper_host.py'))
    mf = ins.render_manifest(str(bat))
    data = json.loads(mf)
    assert data['allowed_origins'] == [f'chrome-extension://{ins.PINNED_EXT_ID}/']
    assert data['path'].isascii()
    assert data['name'] == 'dafeiyu_gatekeeper'
    assert data['type'] == 'stdio'


def test_bat_is_ascii_crlf(tmp_path):
    """bat 必须纯 ASCII + CRLF（cmd 兼容），且引用的路径存在性由安装期保证。"""
    bat = ins.render_bat(str(tmp_path / 'venv' / 'python.exe'),
                         str(tmp_path / 'gatekeeper_host.py'))
    # 不得残留作者机器路径（注意：用户自己的仓库可以在任意盘，
    # 含 G 盘；防回归目标是作者的 G:\life\Aurelia... 根，短路径化后
    # 前缀 G:\life 仍保留，故此检测在短路径下依然有效）
    assert 'G:\\life' not in bat and 'G:/life' not in bat
    assert bat.isascii()
    assert '\r\n' in bat


def test_no_hardcoded_g_drive():
    """安装器源码中不得出现作者机器的 G 盘绝对路径（防回归）。"""
    src = Path(_INSTALLER).read_text(encoding='utf-8')
    assert 'G:\\life' not in src and 'G:/life' not in src
