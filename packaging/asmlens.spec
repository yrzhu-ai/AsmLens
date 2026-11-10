# -*- mode: python ; coding: utf-8 -*-
# Build:  packaging/build_windows.bat
# Output: dist/AsmLens/AsmLens.exe

from pathlib import Path

from PyInstaller.utils.hooks import collect_all

block_cipher = None
REPO = Path(SPECPATH).resolve().parent

datas = [
    (str(REPO / "web"), "web"),
    (str(REPO / "packaging" / "icons" / "asmlens.ico"), "packaging/icons"),
    (str(REPO / "packaging" / "icons" / "asmlens_256.png"), "packaging/icons"),
]
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "fastapi",
    "starlette",
    "pydantic",
    "multipart",
    "python_multipart",
    "PySide6",
    "PySide6.QtCore",
    "PySide6.QtGui",
    "PySide6.QtWidgets",
    "PySide6.QtWebEngineCore",
    "PySide6.QtWebEngineWidgets",
    "shiboken6",
    "asmlens",
    "asmlens.api",
    "asmlens.cli",
    "asmlens.project",
]

for pkg in ("PySide6", "PySide6_WebEngine", "shiboken6"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # noqa: BLE001
        print("collect_all warning:", pkg, exc)

a = Analysis(
    [str(REPO / "desktop" / "asmlens_app.py")],
    pathex=[str(REPO / "server"), str(REPO / "desktop")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["webview", "pythonnet", "clr_loader"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AsmLens",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # Qt/WebEngine 不建议 UPX
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(REPO / "packaging" / "icons" / "asmlens.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="AsmLens",
)
