"""
AsmLens Windows desktop entry (also used by PyInstaller).

Double-click AsmLens.exe → open UI → choose delivery zip inside the window.
Drag-and-drop a .zip onto the exe also works.

Internal: ASMLENS_INTERNAL_SERVE=1 runs the HTTP server as a child process
(needed because uvicorn-in-a-thread fails under frozen Windows builds).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _ensure_import_path() -> None:
    if getattr(sys, "frozen", False):
        return
    repo = Path(__file__).resolve().parents[1]
    server = repo / "server"
    if str(server) not in sys.path:
        sys.path.insert(0, str(server))


def _log(msg: str) -> None:
    try:
        base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path.cwd()
        with (base / "asmlens_desktop.log").open("a", encoding="utf-8") as fh:
            from datetime import datetime

            fh.write(f"{datetime.now():%F %T} {msg}\n")
    except OSError:
        pass
    print(msg, flush=True)


def _internal_serve() -> int:
    """Child-process HTTP server (frozen-safe)."""
    _ensure_import_path()
    import uvicorn

    from asmlens.api import create_app

    project = Path(os.environ["ASMLENS_PROJECT"])
    host = os.environ.get("ASMLENS_HOST", "127.0.0.1")
    port = int(os.environ["ASMLENS_PORT"])
    _log(f"[serve] start {host}:{port} project={project}")
    try:
        # log_config=None：避免 PyInstaller 下 "Unable to configure formatter 'default'"
        uvicorn.run(
            create_app(project),
            host=host,
            port=port,
            log_level="warning",
            log_config=None,
        )
    except Exception as exc:  # noqa: BLE001
        _log(f"[serve] crashed: {exc}")
        raise
    return 0


def main(argv: list[str] | None = None) -> int:
    if os.environ.get("ASMLENS_INTERNAL_SERVE") == "1":
        return _internal_serve()

    _ensure_import_path()
    from asmlens.cli import main as asmlens_main

    argv = list(sys.argv[1:] if argv is None else argv)
    project = None
    rest: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-p", "--project") and i + 1 < len(argv):
            project = argv[i + 1]
            i += 2
            continue
        if not a.startswith("-") and project is None:
            project = a
            i += 1
            continue
        rest.append(a)
        i += 1

    cmd = ["desktop", *rest]
    if project:
        cmd.extend(["--project", project])
    return asmlens_main(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
