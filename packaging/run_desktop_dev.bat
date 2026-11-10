@echo off
set PYTHONPATH=D:\cursor_workspace\AsmLens\server
cd /d D:\cursor_workspace\AsmLens
python -c "from asmlens.cli import main; raise SystemExit(main(['desktop','--port','8777']))"
