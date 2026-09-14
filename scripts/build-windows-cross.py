"""macOS에서 Windows x64 NSIS 설치 파일을 빌드합니다."""
import os
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[1]
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/llvm/bin:/opt/homebrew/opt/lld/bin:' + env['PATH']
subprocess.run(['npm', 'run', 'app:build', '--', '--runner', 'cargo-xwin', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis', '--config', 'src-tauri/tauri.windows.conf.json'], cwd=root, env=env, check=True)
