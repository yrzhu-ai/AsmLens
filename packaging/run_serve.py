"""Launch AsmLens browser serve (dev)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from asmlens.cli import main

if __name__ == "__main__":
    demo = ROOT / "examples" / "demo_project"
    port = sys.argv[1] if len(sys.argv) > 1 else "8765"
    raise SystemExit(main(["serve", "-p", str(demo), "--host", "127.0.0.1", "--port", port]))
