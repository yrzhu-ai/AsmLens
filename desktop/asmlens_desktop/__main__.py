"""python -m asmlens_desktop [--project PATH]

省略 --project 时弹出选择框；取消则打开演示工程。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    repo = Path(__file__).resolve().parents[2]
    server = repo / "server"
    if str(server) not in sys.path:
        sys.path.insert(0, str(server))

    from asmlens.cli import main as asmlens_main

    p = argparse.ArgumentParser(description="AsmLens desktop")
    p.add_argument("-p", "--project", default=None, help="工程目录或交付 zip（可省略）")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--width", type=int, default=1400)
    p.add_argument("--height", type=int, default=900)
    args = p.parse_args()
    argv = [
        "desktop",
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--width",
        str(args.width),
        "--height",
        str(args.height),
    ]
    if args.project:
        argv.extend(["--project", args.project])
    return asmlens_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
