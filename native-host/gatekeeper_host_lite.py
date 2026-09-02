# -*- coding: utf-8 -*-
"""轻量看护宿主（分发版）：Native Messaging 协议应答 + 信局保活。
不依赖 workspace 的 start_dafeiyu.py —— 信局不在线时拉起一个。
协议纪律: stdout 只准写"4字节LE长度前缀+UTF-8 JSON"帧，日志全走 stderr。
"""
import json
import os
import struct
import subprocess
import sys
import time

EXT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAILBOX = os.path.join(EXT_ROOT, 'server', 'pet_mailbox.py')
TOKEN_URL = 'http://127.0.0.1:13140/api/token'

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


def main():
    first = True
    while True:
        msg = _read_message()
        if msg is None:
            return  # stdin EOF: Chrome 断开，本进程退场（信局自生自灭或下轮再拉起）
        try:
            _ensure_mailbox()
        except Exception as e:
            print(f'[host-lite] 拉起信局失败: {e}', file=sys.stderr)
        _send_message({'type': 'pong', 'ok': True, 'pid': os.getpid(),
                       'ts': int(time.time() * 1000), 'first': first})
        first = False


if __name__ == '__main__':
    main()
