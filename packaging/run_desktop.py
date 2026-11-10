"""Launch AsmLens desktop window (dev)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from asmlens.cli import main

if __name__ == "__main__":
    port = sys.argv[1] if len(sys.argv) > 1 else "8777"
    raise SystemExit(main(["desktop", "--port", port]))
