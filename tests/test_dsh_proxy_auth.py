# -*- coding: utf-8 -*-
"""v0.8.3 回归：DSH 代理鉴权修复（cookie + 斜杠端点 + args/request 包装 + preset 路径）。"""
import json
import re
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1] / 'server' / 'pet_mailbox.py'
SRC = SERVER.read_text(encoding='utf-8-sig')


def test_dsh_cookie_helper_exists():
    """_dsh_cookie 辅助函数：读 ~/.dsh/.credentials.yaml 本地签发会话 Cookie。"""
    assert 'def _dsh_cookie()' in SRC
    assert 'client-connection/browser-session' in SRC


def test_dsh_rpc_uses_slash_endpoints():
    """DSH Web API 端点是 /api/{a/b} 斜杠格式，不是点号。"""
    assert "'session/list'" in SRC
    assert "'session/modelCatalog'" in SRC
    assert "'session/selectModel'" in SRC
    # 不应再有旧的点号调用
    assert 'session.list' not in SRC
    assert 'session.models' not in SRC
    assert 'session.selectModel\'' not in SRC.replace("'session/selectModel'", '')


def test_dsh_rpc_payload_wrapping():
    """DSH RPC payload 必须包 {'args': {...}}；selectModel 的参数再包一层 request。"""
    assert "'payload': {'args': args}" in SRC
    assert "'request': {" in SRC
    # selectModel 端点必须用 request 包装（typert descriptor 要求）
    m = re.search(r"'session/selectModel',\s*\{'request'", SRC)
    assert m, 'selectModel 必须用 request 包装参数'


def test_dsh_rpc_sends_cookie_header():
    """所有 DSH RPC 请求必须带 Cookie 头（401 修复核心）。"""
    assert SRC.count("'Cookie': _dsh_cookie()") >= 2  # 两个代理块都要带


def test_agent_preset_read_from_projections():
    """session/list 条目的 agentPreset 藏在 projections.values，不在顶层。"""
    assert "(s.get('projections') or {}).get('values')" in SRC
    assert "s.get('agentPreset') == 'daddyfish'" not in SRC  # 顶层读法必须已清除


def test_model_catalog_needs_no_args():
    """session/modelCatalog 目录是全局的，不接受 sessionId 参数。"""
    assert "'session/modelCatalog', {}" in SRC
