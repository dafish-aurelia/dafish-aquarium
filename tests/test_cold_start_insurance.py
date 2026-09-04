# -*- coding: utf-8 -*-
"""v0.8.3 回归测试：onStartup 冷启动保险 + 顶层 connectGatekeeper。"""
import re
from pathlib import Path

BG = Path(__file__).resolve().parents[1] / 'background.js'
SRC = BG.read_text(encoding='utf-8')


def test_on_startup_listener_registered():
    """onStartup 是浏览器启动时唯一保证投递的事件，必须注册。"""
    assert 'chrome.runtime.onStartup.addListener' in SRC


def test_on_startup_runs_full_selfcheck():
    """onStartup 收到即跑完整自检：收信循环 + 心跳 + 看护连接。"""
    m = re.search(
        r'chrome\.runtime\.onStartup\.addListener\(\(\) => \{(.*?)\}\);',
        SRC, re.S)
    assert m, 'onStartup 监听器不存在'
    body = m.group(1)
    assert 'startInboxLoop' in body
    assert 'postHeartbeat' in body
    assert 'connectGatekeeper' in body


def test_connect_gatekeeper_called_at_top_level():
    """顶层 connectGatekeeper() 必须在函数定义之后被调用（不是只挂 alarm）。"""
    define = SRC.index('function connectGatekeeper()')
    calls = [m.start() for m in re.finditer(r'(?<!function )connectGatekeeper\(\)', SRC)]
    after_def = [c for c in calls if c > define]
    assert after_def, 'connectGatekeeper 定义后从未被顶层调用'
    # 顶层调用 = 不在任何 addListener 回调体缩进内（行首无缩进或只有全局语句）
    lines = SRC.splitlines()
    for idx, line in enumerate(lines):
        if re.match(r'^connectGatekeeper\(\);', line):
            return
    raise AssertionError('没有找到顶层（零缩进）的 connectGatekeeper() 调用')


def test_manifest_version_bumped():
    """v0.9.0 版本号。"""
    import json
    man = json.loads((Path(__file__).resolve().parents[1] / 'manifest.json')
                     .read_text(encoding='utf-8'))
    assert man['version'] == '0.9.0'
