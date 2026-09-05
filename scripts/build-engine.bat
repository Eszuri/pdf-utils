@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   Building Standalone PDF-to-Word Engine (PyInstaller)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/4] Checking Python environment...
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found in PATH! Please install Python first to build the engine.
    pause
    exit /b 1
)

echo [2/4] Ensuring required build tools and dependencies are installed...
python -m pip install --upgrade pip
python -m pip install pyinstaller pdf2docx PyMuPDF python-docx
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install required Python libraries.
    pause
    exit /b 1
)

echo [3/4] Compiling converter_cli.py to standalone executable...
set OUTDIR=..\src-tauri\resources
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

python -m PyInstaller ^
    --noconfirm ^
    --onefile ^
    --console ^
    --name "pdf2docx-engine" ^
    --distpath "%OUTDIR%" ^
    --workpath "..\build\pyinstaller_work" ^
    --specpath "..\build" ^
    --hidden-import "fitz" ^
    --hidden-import "docx" ^
    --hidden-import "pdf2docx" ^
    --collect-all "pdf2docx" ^
    --collect-all "fitz" ^
    --collect-all "docx" ^
    converter_cli.py

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] PyInstaller compilation failed!
    pause
    exit /b 1
)

echo.
echo [4/4] Verifying generated binary...
if exist "%OUTDIR%\pdf2docx-engine.exe" (
    echo [SUCCESS] Standalone engine successfully built at:
    echo           %OUTDIR%\pdf2docx-engine.exe
) else (
    echo [ERROR] Binary not found at expected destination!
    pause
    exit /b 1
)

echo.
echo Standalone engine is ready! Tauri will bundle this file automatically into installer.
echo ========================================================
pause
