import subprocess
import time
import urllib.request
from pathlib import Path

exe = Path(r"D:\cursor_workspace\AsmLens\dist\AsmLens\AsmLens.exe")
log = exe.parent / "asmlens_desktop.log"
if log.exists():
    log.unlink()

p = subprocess.Popen([str(exe)], cwd=str(exe.parent))
ok = False
for i in range(60):
    time.sleep(0.5)
    try:
        with urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=1) as r:
            print("health", i, r.status, r.read())
            ok = True
            break
    except Exception as e:
        print("wait", i, type(e).__name__, e)

if ok:
    for path in ["/", "/static/app.js", "/static/style.css", "/api/project"]:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8765" + path, timeout=5) as r:
                data = r.read()
                print(path, r.status, "bytes", len(data), "head", data[:60])
        except Exception as e:
            print(path, "ERR", e)
else:
    print("NEVER_HEALTHY")

print("--- log ---")
print(log.read_text(encoding="utf-8") if log.exists() else "NOLOG")
print("exe_alive", p.poll() is None)
# cleanup
try:
    p.terminate()
except Exception:
    pass
import time as _t

_t.sleep(1)
for child in Path(r"D:\cursor_workspace\AsmLens\dist\AsmLens").glob("AsmLens.exe"):
    pass
try:
    import subprocess as _sp

    _sp.run(["taskkill", "/F", "/IM", "AsmLens.exe"], capture_output=True)
except Exception:
    pass
