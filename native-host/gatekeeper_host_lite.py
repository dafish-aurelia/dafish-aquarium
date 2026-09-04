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
# venv 优先：门铃要 yaml 签 DSH cookie，系统 python 常没有（2026-09-04 事故：
# py -3 探到 PC_Lua 3.14 无 yaml → 门铃全程 401 → 当日班次不建、铃不响）。
_WS = os.path.dirname(os.path.dirname(EXT_ROOT))
VENV_PY = os.path.join(_WS, '.venv', 'Scripts', 'python.exe')
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


def _spawn_python():
    """拉服务用的解释器：优先工作区 .venv（有 yaml），否则退回自身。"""
    if os.path.exists(VENV_PY):
        return VENV_PY
    return sys.executable


def _mailbox_alive():
    import urllib.request
    try:
        urllib.request.urlopen(TOKEN_URL, timeout=2)
        return True
    except Exception:
        return False


def _ensure_mailbox():
    if _mailbox_alive():
        _ensure_doorbell()  # 信局在岗才管门铃（门铃依赖信局收信）
        return
    subprocess.Popen([_spawn_python(), MAILBOX],
                     creationflags=0x08000000,  # NO_WINDOW
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _ensure_doorbell()


def _doorbell_running():
    """按命令行子串探门铃进程（wmic 的 CIM 替代，轻量不拉 PowerShell）。"""
    try:
        import subprocess as _sp
        r = _sp.run(
            ['powershell', '-NoProfile', '-Command',
             "(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
             "Where-Object { $_.CommandLine -like '*mailbox_doorbell.py*' }).Count"],
            capture_output=True, text=True, timeout=15)
        return int(r.stdout.strip() or '0') > 0
    except Exception:
        return True  # 探测失败保守视为在（避免重复拉起）


def _ensure_doorbell():
    """v0.8.3：门铃随 Chrome 起落。门铃断了当值链路就断了——
    gatekeeper 作为唯一随 Chrome 常驻的宿主，负责把门铃补位。
    日志写 data/pet-mailbox/doorbell-live.log（黑匣子可验尸）。"""
    try:
        if _doorbell_running():
            return
        # EXT_ROOT = <ws>/apps/dafeiyu-extension → 工作区根要再上两级
        doorbell = os.path.join(os.path.dirname(os.path.dirname(EXT_ROOT)),
                                'scripts', 'mailbox_doorbell.py')
        if not os.path.exists(doorbell):
            return
        log_path = os.path.join(os.path.dirname(HEARTBEAT_FILE), 'doorbell-live.log')
        log = open(log_path, 'ab', buffering=1)
        log.write(f'\n==== gatekeeper launch {time.strftime("%m-%d %H:%M:%S")} ====\n'.encode())
        subprocess.Popen([_spawn_python(), doorbell],
                         creationflags=0x01000000 | 0x08000000,  # BREAKAWAY | NO_WINDOW
                         stdout=log, stderr=subprocess.STDOUT)
    except Exception as e:  # noqa: BLE001
        print(f'[host-lite] 拉起门铃失败: {e}', file=sys.stderr)


def _heartbeat_stale_s():
    """投影心跳距今多少秒；文件缺失（信局从未起过）视为刚活跃，不误报。"""
    try:
        return time.time() - os.path.getmtime(os.path.abspath(HEARTBEAT_FILE))
    except OSError:
        return 0.0


def _revive_watchdog_once():
    """看门狗单轮逻辑（独立函数以便测试）：补拉死信局 + 投影心跳超时发 revive 帧。"""
    if not _mailbox_alive():
        print('[watchdog] 信局不在岗，看门狗直接补拉', file=sys.stderr)
        subprocess.Popen([_spawn_python(), MAILBOX],
                         creationflags=0x08000000,  # NO_WINDOW
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _ensure_doorbell()  # 门铃依赖信局，一并补位
    if _heartbeat_stale_s() > PROJECTION_STALE_S:
        _send_message({'type': 'revive', 'reason': 'projection-heartbeat-stale',
                       'staleS': int(_heartbeat_stale_s())})


def _revive_watchdog(stop_event):
    """复活看门狗（v0.8.4 双职责）：
    1. 投影心跳超时 → 往 Chrome 写一帧 revive，把（可能睡着的）SW 叫醒。
       写帧动作本身就是事件源，Chrome 必须拉起（或已活着的）SW 来接收。
    2. 信局探活：SW 睡着时没人发 pulse，main 循环的 _ensure_mailbox 永远
       不跑（2026-09-04 实测空窗：杀掉信局后看护干等 6 分钟没人补）。
       看门狗是看护身上唯一独立于 Chrome 的循环——它来兜底直接拉。
       拉起 venv 信局（_spawn_python）→ 信局活了投影心跳才有意义。"""
    while not stop_event.wait(60):
        try:
            _revive_watchdog_once()
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
