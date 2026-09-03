# -*- coding: utf-8 -*-
"""扩展目录密钥卫生回归测试（v0.8.1 起）+ manifest 无 key 断言（v0.8.2）。

两代教训：
- v0.8.1：私钥 .pem 绝不允许出现在扩展目录任何角落（Chrome 加载警告
  「包含密钥文件」；打包分发即泄漏）。
- v0.8.2：manifest 不再携带 "key" 字段——带 key 的 unpacked 扩展在
  Chrome 152 上「重启即被静默移除」（2026-09-03 主人 Chrome 实测循环：
  装上 → 当次会话正常 → 退出 → 重启 → 记录被丢弃）。去掉 key 后
  ID 由「绝对路径」派生：目录不动，ID 恒定。
"""
import json
from pathlib import Path

import pytest

_EXT = Path(__file__).resolve().parents[1]


def test_no_pem_in_extension_tree():
    """扩展目录树里不得存在任何 .pem（Chrome 会警告且分发即私钥泄漏）。"""
    pems = list(_EXT.rglob('*.pem'))
    assert not pems, f'扩展目录发现私钥文件: {[str(p) for p in pems]}'


def test_manifest_has_no_key_field():
    """v0.8.2 起 manifest 必须不带 "key" —— 带 key 的 unpacked 扩展
    在 Chrome 152 重启时被静默移除（实测事故，2026-09-03）。"""
    m = json.loads((_EXT / 'manifest.json').read_text(encoding='utf-8'))
    assert 'key' not in m, (
        'manifest 含 "key" 字段：Chrome 152 上 unpacked 扩展会重启即丢。'
        'ID 稳定性由「目录路径派生」保证，目录不动 ID 不变。'
    )


def test_private_key_lives_outside_extension():
    """私钥应有专属家（workspace/data/keys）——本机留存即可，
    不再需要参与 manifest（无 key 字段后仅作备份资产）。"""
    ws_root = Path(__file__).resolve().parents[3]
    pem = ws_root / 'data' / 'keys' / 'dafeiyu_key.pem'
    assert pem.exists(), f'私钥应住在 {pem}（v0.8.1 从 native-host/.gen/ 迁出）'


def test_no_gen_private_dir_visible_to_chrome_load():
    """.gen 里除公钥存档与 ID 文本外不得有别的敏感物。文件白名单化。"""
    gen = _EXT / 'native-host' / '.gen'
    allowed = {'manifest_key.b64', 'pinned_ext_id.txt'}
    actual = {p.name for p in gen.iterdir() if p.is_file()} if gen.exists() else set()
    extra = actual - allowed
    assert not extra, f'.gen 出现白名单外文件: {extra}'
