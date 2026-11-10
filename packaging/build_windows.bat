@echo off
REM Build AsmLens.exe (one-folder). Requires Python 3.9+ on PATH.
setlocal
cd /d "%~dp0\.."

echo [1/3] Install build deps...
python -m pip install -U pip
python -m pip install -e ".[desktop,build]" pyinstaller

echo [2/3] PyInstaller...
python -m PyInstaller --noconfirm --clean packaging\asmlens.spec

echo [3/3] Done.
echo.
echo Output folder:
echo   %cd%\dist\AsmLens\
echo Double-click:
echo   %cd%\dist\AsmLens\AsmLens.exe
echo.
pause
