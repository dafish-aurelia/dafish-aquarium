# -*- coding: utf-8 -*-
"""扩展目录密钥卫生回归测试（v0.8.1）：
私钥 .pem 绝不允许出现在扩展目录任何角落（分发即泄漏 = 他人可冒发同 ID 扩展）。
2026-09-03 实测事故：Chrome 加载扩展时警告「包含密钥文件」——
私钥虽已 gitignore 但物理躺在 native-host/.gen/ 里，打包分发就会出门。"""
from pathlib import Path

import pytest

_EXT = Path(__file__).resolve().parents[1]


def test_no_pem_in_extension_tree():
    """扩展目录树里不得存在任何 .pem（Chrome 会警告且分发即私钥泄漏）。"""
    pems = list(_EXT.rglob('*.pem'))
    # 排除依赖目录的边缘情况不适用：本仓库无 node_modules
    assert not pems, f'扩展目录发现私钥文件: {[str(p) for p in pems]}'


def test_key_material_lives_outside_extension():
    """密钥材料应有专属家（workspace/data/keys），且公钥存档与 manifest 一致。
    路径推导：tests/ → dafeiyu-extension → apps → 工作区根。"""
    import json

    ws_root = Path(__file__).resolve().parents[3]
    pem = ws_root / 'data' / 'keys' / 'dafeiyu_key.pem'
    assert pem.exists(), f'私钥应住在 {pem}（v0.8.1 从 native-host/.gen/ 迁出）'

    manifest = _EXT / 'manifest.json'
    m = json.loads(manifest.read_text(encoding='utf-8'))
    # 公钥存档留在 .gen（可分发物），且与 manifest 内 key 逐字一致
    key_archive = _EXT / 'native-host' / '.gen' / 'manifest_key.b64'
    assert key_archive.exists(), '公钥存档 manifest_key.b64 应留在 native-host/.gen/'
    archived = key_archive.read_text(encoding='utf-8').strip()
    assert archived == m['key'], 'manifest 的 key 与公钥存档不一致（截断或漂移）'


def test_no_gen_private_dir_visible_to_chrome_load():
    """加载扩展时 Chrome 只警告"密钥文件"一次就够——.gen 里除了公钥存档
    不得再有别的敏感物。文件白名单化。"""
    gen = _EXT / 'native-host' / '.gen'
    allowed = {'manifest_key.b64', 'pinned_ext_id.txt'}
    actual = {p.name for p in gen.iterdir() if p.is_file()} if gen.exists() else set()
    extra = actual - allowed
    assert not extra, f'.gen 出现白名单外文件: {extra}'
