"""
Helper script to build standalone converter engine using PyInstaller.
Can be run via: python scripts/build_engine.py
"""

import os
import sys
import subprocess
import shutil

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    cli_script = os.path.join(script_dir, "converter_cli.py")
    out_dir = os.path.join(project_root, "src-tauri", "resources")
    os.makedirs(out_dir, exist_ok=True)

    print("Checking dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller", "pdf2docx", "PyMuPDF", "python-docx"])

    print("Building standalone engine...")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--console",
        "--name", "pdf2docx-engine",
        "--distpath", out_dir,
        "--workpath", os.path.join(project_root, "build", "pyinstaller_work"),
        "--specpath", os.path.join(project_root, "build"),
        "--hidden-import", "fitz",
        "--hidden-import", "docx",
        "--hidden-import", "pdf2docx",
        "--collect-all", "pdf2docx",
        "--collect-all", "fitz",
        "--collect-all", "docx",
        cli_script
    ]
    subprocess.check_call(cmd)
    
    bin_name = "pdf2docx-engine.exe" if os.name == "nt" else "pdf2docx-engine"
    final_path = os.path.join(out_dir, bin_name)
    if os.path.exists(final_path):
        print(f"\n[SUCCESS] Standalone engine generated at: {final_path}")
    else:
        print(f"\n[WARNING] Output file not found at {final_path}")

if __name__ == "__main__":
    main()
