# -*- coding: utf-8 -*-
"""卸载：删注册表键 + generated/ 产物。仓库本体不动。"""
import shutil
import subprocess
import sys
from pathlib import Path

NM_HOST_NAME = 'dafeiyu_gatekeeper'
REG_KEY = rf'HKCU\Software\Google\Chrome\NativeMessagingHosts\{NM_HOST_NAME}'


def main():
    r = subprocess.run(['reg', 'delete', REG_KEY, '/f'],
                       capture_output=True, text=True)
    print(f'[uninstall] 注册表: {"已清除" if r.returncode == 0 else r.stderr.strip()}')
    gen = Path(__file__).resolve().parents[1] / 'native-host' / 'generated'
    if gen.exists():
        shutil.rmtree(gen)
        print(f'[uninstall] 已删除 {gen}')
    print('[uninstall] 完成。扩展请在 chrome://extensions 手动移除。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
