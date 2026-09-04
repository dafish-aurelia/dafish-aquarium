# -*- coding: utf-8 -*-
"""大肥鱼扩展安装器：按用户实际路径生成 native-host 配置并注册。
绿色安装：一切产物落在仓库 native-host/generated/ 与 HKCU 注册表，
不写系统目录、不需要管理员。卸载 = uninstall.py 一键还原。
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# v0.8.2：manifest 不再带 key（带 key 的 unpacked 扩展在 Chrome 152
# 上"重启即被静默移除"，2026-09-03 实测）。ID 改由绝对路径派生——
# 与 Chrome 内置算法逐字一致（extension.cc → crx_file::id_util：
# MaybeNormalizePath 盘符大写 + UTF-16LE SHA256 前32hex → a-p 字母表）。
def derive_ext_id(ext_root):
    """从扩展目录绝对路径派生 Chrome 扩展 ID（Chrome 同款算法）。"""
    import hashlib
    p = str(ext_root)
    if len(p) >= 2 and 'a' <= p[0] <= 'z' and p[1] == ':':
        p = p[0].upper() + p[1:]  # MaybeNormalizePath：盘符统一大写
    digest = hashlib.sha256(p.encode('utf-16-le')).hexdigest()[:32]
    return ''.join('abcdefghijklmnop'[int(c, 16)] for c in digest)


PINNED_EXT_ID = derive_ext_id(Path(__file__).resolve().parents[1])
NM_HOST_NAME = 'dafeiyu_gatekeeper'
# 双反斜杠拼接而非 rf-string：rf 下 \Google 等片段看似安全，但改写成 f-string
# 时 \d 之类会变转义——显式转义杜绝这一整类事故。
REG_KEY = 'Software\\Google\\Chrome\\NativeMessagingHosts\\' + NM_HOST_NAME
EXT_ROOT = Path(__file__).resolve().parents[1]


def get_short_path(path):
    """8.3 短路径：cmd 的 %~sI 换算。取不到（含路径不存在）回退原路径。
    注意必须把整行交给 cmd（字符串形式）：列表形式会被 list2cmdline
    加反斜杠转义内部引号，cmd 解析不了。
    新建目录的短名登记有亚秒级延迟（2026-09-04 实测：pytest 刚建的
    tmp 目录首查回显长路径，同路径手动复跑即得 PYTEST~1）——失败重试
    一次，再不行才回退。"""
    for attempt in (1, 2):
        try:
            r = subprocess.run(
                f'cmd /c for %I in ("{path}") do @echo %~sI',
                capture_output=True, text=True, timeout=10)
            lines = [l for l in r.stdout.strip().splitlines() if l.strip()]
            sp = lines[-1].strip() if lines else str(path)
            # 换算失败时 cmd 原样回显（含引号或与原路径相同）
            if sp.strip('"') != str(path) and '"' not in sp:
                return sp
        except Exception:
            pass
        if attempt == 1 and os.path.exists(path):
            time.sleep(0.3)  # 给短名登记一个窗口再试一次
    return str(path)


def find_python():
    """探测可用 python：py -3 → python → python3。全无则返回 None。"""
    for cmd in (['py', '-3'], ['python'], ['python3']):
        try:
            r = subprocess.run(cmd + ['-c', 'import sys; print(sys.executable)'],
                               capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                exe = r.stdout.strip().splitlines()[-1]
                if exe:
                    return exe
        except Exception:
            continue
    return None


def render_bat(python_exe, host_script):
    """生成纯 ASCII + CRLF 的 bat。路径先转 8.3 短路径防中文代码页问题；
    短路径不可用且原路径含非 ASCII → 明确报错（拒绝生成会坏掉的 bat）。"""
    py_s = get_short_path(python_exe)
    host_s = get_short_path(host_script)
    for label, p in (('python', py_s), ('host script', host_s)):
        if not p.isascii():
            raise RuntimeError(
                f'{label} 的 8.3 短路径不可用且原路径含非 ASCII 字符: {p!r} —— '
                '请把仓库放在纯英文路径，或在含中文的卷上启用 8.3 命名')
    return '@echo off\r\n"{}" "{}"\r\n'.format(py_s, host_s)


def render_manifest(bat_path):
    return json.dumps({
        'name': NM_HOST_NAME,
        'description': '鲸鱼娘后勤看门人：寄生 Chrome，确保信局随浏览器起落',
        'path': bat_path,
        'type': 'stdio',
        'allowed_origins': [f'chrome-extension://{PINNED_EXT_ID}/'],
    }, ensure_ascii=False, indent=2)


def main():
    ap = argparse.ArgumentParser(description='大肥鱼扩展安装器')
    ap.add_argument('--python', help='指定 python.exe（默认自动探测）')
    ap.add_argument('--registry', action='store_true',
                    help='真的写注册表（默认只生成文件，打印将要写的键值）')
    args = ap.parse_args()

    python_exe = args.python or find_python()
    if not python_exe:
        print('[install] 未找到 Python 3.10+，请安装后重试：https://www.python.org/')
        return 1
    print(f'[install] python: {python_exe}')

    host_script = EXT_ROOT / 'native-host' / 'gatekeeper_host_lite.py'
    if not host_script.exists():
        print(f'[install] fatal: 看护宿主缺失: {host_script}')
        return 1

    gen_dir = EXT_ROOT / 'native-host' / 'generated'
    gen_dir.mkdir(parents=True, exist_ok=True)
    try:
        bat_text = render_bat(python_exe, str(host_script))
    except RuntimeError as e:
        print(f'[install] fatal: {e}')
        return 1
    bat_path = gen_dir / 'dafeiyu_gatekeeper.bat'
    bat_path.write_text(bat_text, encoding='ascii', newline='')
    mf_path = gen_dir / 'dafeiyu_gatekeeper.json'
    mf_path.write_text(render_manifest(str(bat_path)), encoding='utf-8')
    print(f'[install] native-host 产物: {gen_dir}')

    if args.registry:
        abs_mf = str(mf_path.resolve())
        r = subprocess.run(['reg', 'add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + NM_HOST_NAME,
                            '/ve', '/t', 'REG_SZ', '/d', abs_mf, '/f'],
                           capture_output=True, text=True)
        if r.returncode == 0:
            print(f'[install] ✓ 注册表已写入 HKCU\\{REG_KEY}')
        else:
            print(f'[install] ⚠ 注册表写入失败: {r.stderr.strip()}')
            return 1
    else:
        print('[install] 预演模式（未写注册表）。真装请加 --registry。')
        print(f'  生成产物: {gen_dir}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
