"""Build a pinned, isolated sidecar. Source lives only in engine/."""
import os
from pathlib import Path
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
environment = root / 'build' / 'word-engine-venv'
python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
if not python.exists():
    venv.create(environment, with_pip=True)
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root/'engine/requirements.txt'), 'pyinstaller==6.19.0'], check=True)
host = subprocess.check_output(['rustc','-vV'], text=True)
target = next(line.split(': ',1)[1] for line in host.splitlines() if line.startswith('host: '))
subprocess.run([str(python), '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console',
                '--name', f'pdf-word-engine-{target}', '--paths', str(root/'engine'),
                '--distpath', str(root/'src-tauri/binaries'), '--workpath', str(root/'build/word-engine'),
                '--specpath', str(root/'build'), str(root/'engine/main.py')], check=True)
