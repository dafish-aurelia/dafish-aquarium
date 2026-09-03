# -*- coding: utf-8 -*-
"""轻量看护宿主（分发版）：Native Messaging 协议应答 + 信局保活 + SW 复活看门狗。
不依赖 workspace 的 start_dafeiyu.py —— 信局不在线时拉起一个。
协议纪律: stdout 只准写"4字节LE长度前缀+UTF-8 JSON"帧，日志全走 stderr。

v0.8.1 复活看门狗（audit: SW 死后 alarm 不再唤醒的实测事故）：
MV3 SW 被杀后，Chrome 对 unpacked 扩展的 alarm 投递存在永久失效的现实——
20 小时无心跳、inbox 积信无人取、13140 上无任何长轮询连接（2026-09-03 实测）。
而 native port 的 stdin 在 SW 死后仍保持打开（Chrome lazy cleanup），
这反而是唯一幸存的"入站事件源"：host → Chrome 的帧会强制拉起 SW。
于是让看护反向监视投影心跳：超时（PROJECTION_STALE_S）即往 stdout 写
revive 帧——SW 若活着就是一次无害空转，若死了这就是一次闹钟。
"""
import json
import os
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

EXT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAILBOX = os.path.join(EXT_ROOT, 'server', 'pet_mailbox.py')
TOKEN_URL = 'http://127.0.0.1:13140/api/token'
# 与 pet_mailbox.py 的 BASE_DIR 完全同一约定：BASE_DIR = parents[3]/data/pet-mailbox。
# 本文件（native-host/）与 pet_mailbox.py（server/）在仓库约定里同深，
# parents[3] 指向同一家 data 目录。v0.8.1 事故：曾按 EXT_ROOT+一个 pardir
# 算出 apps/data（差一级），watchdog 从此睁眼瞎——约定必须与信局逐字对齐。
HEARTBEAT_FILE = str(Path(__file__).resolve().parents[3] / 'data' / 'pet-mailbox'
                     / 'projection_heartbeat.txt')
PROJECTION_STALE_S = 300  # 5 分钟（信局 PROJECTION_TTL 同款宽限）

_PROTO = sys.stdout
sys.stdout = sys.stderr


def _read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        return None
    (length,) = struct.unpack('<I', raw)
    if length <= 0 or length > 1_000_000:
        return None
    body = sys.stdin.buffer.read(length)
    if not body or len(body) < length:
        return None
    return body


def _send_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    _PROTO.buffer.write(struct.pack('<I', len(data)))
    _PROTO.buffer.write(data)
    _PROTO.buffer.flush()


def _mailbox_alive():
    import urllib.request
    try:
        urllib.request.urlopen(TOKEN_URL, timeout=2)
        return True
    except Exception:
        return False


def _ensure_mailbox():
    if _mailbox_alive():
        return
    subprocess.Popen([sys.executable, MAILBOX],
                     creationflags=0x08000000,  # NO_WINDOW
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _heartbeat_stale_s():
    """投影心跳距今多少秒；文件缺失（信局从未起过）视为刚活跃，不误报。"""
    try:
        return time.time() - os.path.getmtime(os.path.abspath(HEARTBEAT_FILE))
    except OSError:
        return 0.0


def _revive_watchdog(stop_event):
    """复活看门狗：投影心跳超时 → 往 Chrome 写一帧 revive。
    写帧动作本身就是事件源，Chrome 必须拉起（或已活着的）SW 来接收。
    SW 端 background.js 的 port.onMessage 收到后走一次完整自检。"""
    while not stop_event.wait(60):
        try:
            if _heartbeat_stale_s() > PROJECTION_STALE_S:
                _send_message({'type': 'revive', 'reason': 'projection-heartbeat-stale',
                               'staleS': int(_heartbeat_stale_s())})
        except Exception as e:  # noqa: BLE001
            print(f'[host-lite] revive watchdog 出错: {e}', file=sys.stderr)


def main():
    first = True
    stop_event = threading.Event()
    watchdog = threading.Thread(target=_revive_watchdog, args=(stop_event,), daemon=True)
    watchdog.start()
    while True:
        msg = _read_message()
        if msg is None:
            stop_event.set()  # stdin EOF: Chrome 断开，看门狗与主循环一起退场
            return
        try:
            _ensure_mailbox()
        except Exception as e:
            print(f'[host-lite] 拉起信局失败: {e}', file=sys.stderr)
        _send_message({'type': 'pong', 'ok': True, 'pid': os.getpid(),
                       'ts': int(time.time() * 1000), 'first': first})
        first = False


if __name__ == '__main__':
    main()
