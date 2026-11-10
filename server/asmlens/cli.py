#!/usr/bin/env python3
"""AsmLens command-line interface."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _paths(values) -> list:
    if not values:
        return []
    out = []
    for v in values:
        out.append(Path(v))
    return out


def cmd_run(args: argparse.Namespace) -> int:
    from .pipeline import RunConfig, run_pipeline

    if not getattr(args, "q", None):
        raise SystemExit("error: -q / --query is required (assembly FASTA to evaluate)")

    cfg = RunConfig(
        query=Path(args.q),
        threads=args.t,
        out_dir=Path(args.out),
        ref=Path(args.ref) if args.ref else None,
        hifi=_paths(args.hifi),
        clr=_paths(args.clr),
        ont=_paths(args.ont),
        illumina=_paths(args.Illumina),
        query_bam=_paths(getattr(args, "bam", None) or getattr(args, "query_bam", None)),
        ref_bam=_paths(getattr(args, "ref_bam", None)),
        name=args.name,
        min_length=args.min_length,
        low_max_depth=args.low_max_depth,
        depth_window=args.depth_window,
        keep_bam=args.keep_bam,
        mapq=args.mapq,
        align_mode=args.align_mode,
        run_syri=args.run_syri,
        run_genomesyn=getattr(args, "run_genomesyn", False),
        map_reads_to_ref=not args.no_map_reads_to_ref,
        craq_dir=Path(args.craq_dir) if args.craq_dir else None,
        qv_bed=Path(args.qv_bed) if args.qv_bed else None,
        qv_tsv=Path(args.qv_tsv) if args.qv_tsv else None,
        max_qv=args.max_qv,
    )
    run_pipeline(cfg)
    return 0


def add_run_arguments(p: argparse.ArgumentParser) -> None:
    """Shared flags for ``asmlens …`` and ``asmlens run …``."""
    p.add_argument("-q", "--query", dest="q", required=False, help="待评估组装 FASTA（必填）")
    p.add_argument("-t", type=int, default=8, help="Threads")
    p.add_argument("-ref", "--reference", dest="ref", default=None, help="参考基因组 FASTA")
    p.add_argument("-hifi", nargs="+", default=None, help="PacBio HiFi reads (fq/fq.gz)")
    p.add_argument("-clr", nargs="+", default=None, help="PacBio CLR reads")
    p.add_argument("-ont", nargs="+", default=None, help="ONT reads")
    p.add_argument("-Illumina", nargs="+", default=None, help="Illumina short reads")
    p.add_argument(
        "--bam", "--query-bam",
        dest="bam",
        nargs="+",
        default=None,
        help="已有比对到组装(-q)的 BAM（可多个，将合并；有 BAM 时可不再给 reads）",
    )
    p.add_argument(
        "--ref-bam",
        dest="ref_bam",
        nargs="+",
        default=None,
        help="已有比对到参考(-ref)的 BAM（可多个）",
    )
    p.add_argument("-o", "--out", default="asmlens_out", help="Output directory")
    p.add_argument("--name", default="AsmLens run", help="Project display name")
    p.add_argument("--min-length", type=int, default=100, help="Min problem region length")
    p.add_argument("--low-max-depth", type=int, default=5, help="Low-coverage depth cutoff")
    p.add_argument("--depth-window", type=int, default=1000, help="Coverage bedGraph window")
    p.add_argument("--mapq", type=int, default=20, help="Min mapping quality")
    p.add_argument("--keep-bam", action="store_true", help="Keep intermediate BAM files")
    p.add_argument(
        "--align-mode",
        choices=["minimap2", "nucmer"],
        default="minimap2",
        help="Genome–genome aligner for -ref vs -q",
    )
    p.add_argument(
        "--run-syri",
        action="store_true",
        help="跑 SyRI 结构变异（建议 --align-mode nucmer；结果写入共线性/变异轨）",
    )
    p.add_argument(
        "--run-genomesyn",
        action="store_true",
        help="跑 GenomeSyn2 共线性（需 PATH 上有 GenomeSyn2）",
    )
    p.add_argument(
        "--no-map-reads-to-ref",
        action="store_true",
        help="Only map/cover -q (skip reads→ref coverage)",
    )
    p.add_argument(
        "--craq-dir", "--craq",
        dest="craq_dir",
        default=None,
        help="已有 CRAQ 结果目录（含 runAQI_out / locER_out 等）",
    )
    p.add_argument(
        "--qv-bed", "--qv",
        dest="qv_bed",
        default=None,
        help="已有低 QV 区间 BED",
    )
    p.add_argument("--qv-tsv", default=None, help="已有窗口 QV 表（TSV）")
    p.add_argument("--max-qv", type=float, default=30.0, help="QV cutoff for --qv-tsv")
    p.set_defaults(func=cmd_run)

def cmd_prepare(args: argparse.Namespace) -> int:
    from .prepare import prepare_project

    prepare_project(
        Path(args.out),
        fai=Path(args.fai) if args.fai else None,
        chrom_sizes=Path(args.chrom_sizes) if args.chrom_sizes else None,
        depth=Path(args.depth) if args.depth else None,
        zero_max_depth=args.zero_max_depth,
        low_max_depth=args.low_max_depth,
        min_length=args.min_length,
        depth_window=args.depth_window,
        include_coverage_track=not args.no_coverage_track,
        craq_dir=Path(args.craq_dir) if args.craq_dir else None,
        qv_bed=Path(args.qv_bed) if args.qv_bed else None,
        qv_tsv=Path(args.qv_tsv) if args.qv_tsv else None,
        max_qv=args.max_qv,
        name=args.name,
        chrom_filter=args.chrom,
    )
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .api import create_app

    app = create_app(Path(args.project))
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


def _resolve_project(path: Path) -> Path:
    """Accept project directory or delivery zip → project dir."""
    project = Path(path).resolve()
    if project.suffix.lower() == ".zip":
        import tempfile
        import zipfile

        tmp = Path(tempfile.mkdtemp(prefix="asmlens_bundle_"))
        with zipfile.ZipFile(project) as zf:
            zf.extractall(tmp)
        found = list(tmp.rglob("project.json"))
        if not found:
            raise FileNotFoundError(f"压缩包内未找到 project.json: {project}")
        return found[0].parent
    if not (project / "project.json").is_file():
        raise FileNotFoundError(f"目录中缺少 project.json: {project}")
    return project


def _empty_starter_project() -> Path:
    """Blank project so the desktop UI can open without demo_project."""
    import json
    import tempfile

    root = Path(tempfile.mkdtemp(prefix="asmlens_empty_"))
    (root / "tracks").mkdir(exist_ok=True)
    (root / "chrom.sizes").write_text("", encoding="utf-8")
    (root / "problems.tsv").write_text(
        "chrom\tstart\tend\ttype\tsource\tnote\n", encoding="utf-8"
    )
    project = {
        "name": "AsmLens",
        "version": 1,
        "chrom_sizes": "chrom.sizes",
        "problems_file": "problems.tsv",
        "tracks": [],
        "tables": {},
        "defaults": {},
        "summary": {},
        "empty": True,
    }
    (root / "project.json").write_text(
        json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return root


def _stop_proc(proc) -> None:
    if proc is None:
        return
    try:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except Exception:
                proc.kill()
    except Exception:
        pass


def _setup_qt_webengine_env() -> None:
    """Point Qt WebEngine at bundled binaries when frozen."""
    import os

    if not getattr(sys, "frozen", False):
        return
    base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    candidates = list(base.rglob("QtWebEngineProcess.exe"))
    if candidates:
        os.environ["QTWEBENGINEPROCESS_PATH"] = str(candidates[0])
        _desktop_log(f"[desktop] QTWEBENGINEPROCESS_PATH={candidates[0]}")
    # Reduce blank-window issues on some GPUs / remote desktops
    flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    extra = "--disable-gpu --no-sandbox"
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (flags + " " + extra).strip()


def _desktop_qt_window(
    url: str,
    title: str,
    server_proc,
    width: int,
    height: int,
) -> int:
    """Native desktop window via Qt WebEngine (not a browser tab)."""
    _setup_qt_webengine_env()
    try:
        from PySide6.QtCore import QUrl
        from PySide6.QtWebEngineCore import QWebEngineSettings
        from PySide6.QtWebEngineWidgets import QWebEngineView
        from PySide6.QtWidgets import QApplication, QMainWindow
    except Exception as exc:  # noqa: BLE001
        _desktop_log(f"[desktop] PySide6 WebEngine unavailable: {exc}")
        raise

    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)
    app.setApplicationName("AsmLens")
    app.setQuitOnLastWindowClosed(True)

    # Window / taskbar icon — prefer multi-res ICO, then PNG
    try:
        from PySide6.QtGui import QIcon, QPixmap

        if sys.platform.startswith("win"):
            try:
                import ctypes

                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(  # type: ignore[attr-defined]
                    "AsmLens.Desktop.1.1"
                )
            except Exception:
                pass

        icon_candidates = []
        if getattr(sys, "frozen", False):
            meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
            exe_dir = Path(sys.executable).resolve().parent
            icon_candidates += [
                exe_dir / "asmlens.ico",
                meipass / "packaging" / "icons" / "asmlens.ico",
                meipass / "packaging" / "icons" / "asmlens_256.png",
                meipass / "packaging" / "icons" / "asmlens.png",
                exe_dir / "asmlens_256.png",
            ]
        else:
            root = Path(__file__).resolve().parents[2]
            icon_candidates += [
                root / "packaging" / "icons" / "asmlens.ico",
                root / "packaging" / "icons" / "asmlens_256.png",
                root / "packaging" / "icons" / "asmlens.png",
            ]
        icon = QIcon()
        for cand in icon_candidates:
            if not cand.is_file():
                continue
            if cand.suffix.lower() == ".ico":
                icon = QIcon(str(cand))
            else:
                pix = QPixmap(str(cand))
                if not pix.isNull():
                    for edge in (16, 24, 32, 48, 64, 128, 256):
                        icon.addPixmap(pix.scaled(edge, edge))
            if not icon.isNull():
                app.setWindowIcon(icon)
                _desktop_log(f"[desktop] window icon: {cand}")
                break
    except Exception as exc:  # noqa: BLE001
        _desktop_log(f"[desktop] window icon skip: {exc}")

    win = QMainWindow()
    win.setWindowTitle(title)
    win.resize(width, height)
    if not app.windowIcon().isNull():
        win.setWindowIcon(app.windowIcon())

    view = QWebEngineView()
    settings = view.settings()
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)

    def _on_load_finished(ok: bool) -> None:
        _desktop_log(f"[desktop] qt loadFinished ok={ok} url={view.url().toString()}")

    view.loadFinished.connect(_on_load_finished)
    view.setUrl(QUrl(url))
    win.setCentralWidget(view)
    win.show()
    win.raise_()
    win.activateWindow()
    _desktop_log(f"[desktop] qt window open {url}")

    def _cleanup() -> None:
        _stop_proc(server_proc)

    app.aboutToQuit.connect(_cleanup)
    code = int(app.exec())
    _stop_proc(server_proc)
    return code


def _show_error(title: str, message: str) -> None:
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        messagebox.showerror(title, message, parent=root)
        root.destroy()
    except Exception:
        print(f"{title}: {message}", file=sys.stderr)


def _pick_free_port(host: str, preferred: int) -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, preferred))
            return preferred
        except OSError:
            s.bind((host, 0))
            return int(s.getsockname()[1])


def _desktop_log(msg: str) -> None:
    """Write startup log next to the exe (visible when console=False)."""
    try:
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).resolve().parent
        else:
            base = Path.cwd()
        path = base / "asmlens_desktop.log"
        with path.open("a", encoding="utf-8") as fh:
            from datetime import datetime

            fh.write(f"{datetime.now():%F %T} {msg}\n")
    except OSError:
        pass
    print(msg, flush=True)


def _spawn_server_process(project: Path, host: str, port: int):
    """Run HTTP server in a child process (works under PyInstaller freeze)."""
    import os
    import subprocess

    env = os.environ.copy()
    env["ASMLENS_INTERNAL_SERVE"] = "1"
    env["ASMLENS_PROJECT"] = str(project)
    env["ASMLENS_HOST"] = host
    env["ASMLENS_PORT"] = str(port)

    if getattr(sys, "frozen", False):
        cmd = [sys.executable]
        cwd = str(Path(sys.executable).resolve().parent)
    else:
        # Dev: re-enter desktop entry which understands ASMLENS_INTERNAL_SERVE
        entry = Path(__file__).resolve().parents[2] / "desktop" / "asmlens_app.py"
        cmd = [sys.executable, str(entry)]
        cwd = str(Path(__file__).resolve().parents[2])

    flags = 0
    if sys.platform.startswith("win"):
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    _desktop_log(f"[desktop] spawn server: {cmd} port={port}")
    return subprocess.Popen(cmd, env=env, cwd=cwd, creationflags=flags)


def cmd_desktop(args: argparse.Namespace) -> int:
    import time
    import urllib.request

    # 无 -p：空白界面；交付包在「文件 → 打开交付包」中选择
    raw = getattr(args, "project", None)
    if not raw:
        project = _empty_starter_project()
        _desktop_log(f"[desktop] 空白启动，请在「文件」菜单打开交付包: {project}")
    else:
        try:
            project = _resolve_project(Path(raw))
        except FileNotFoundError as exc:
            _show_error("AsmLens", str(exc))
            return 3

    host = args.host
    port = _pick_free_port(host, args.port)
    url = f"http://{host}:{port}/"
    health = f"{url.rstrip('/')}/api/health"

    server_proc = _spawn_server_process(project, host, port)

    ready = False
    deadline = time.time() + 60
    while time.time() < deadline:
        if server_proc.poll() is not None:
            _desktop_log(f"[desktop] server process exited early code={server_proc.returncode}")
            break
        try:
            with urllib.request.urlopen(health, timeout=1) as resp:
                if resp.status == 200:
                    ready = True
                    break
        except Exception:
            time.sleep(0.25)
    if not ready:
        _stop_proc(server_proc)
        log_hint = (
            Path(sys.executable).parent / "asmlens_desktop.log"
            if getattr(sys, "frozen", False)
            else Path("asmlens_desktop.log")
        )
        _show_error(
            "AsmLens",
            "本地服务未能就绪，界面会空白。\n"
            f"请查看日志：{log_hint}\n"
            f"尝试访问：{health}",
        )
        return 4
    _desktop_log(f"[desktop] healthy {health}")

    from . import __version__

    try:
        import json as _json

        _meta = _json.loads((project / "project.json").read_text(encoding="utf-8"))
    except Exception:
        _meta = {}
    if _meta.get("empty"):
        title = f"AsmLens {__version__}"
    else:
        title = f"AsmLens {__version__} — {_meta.get('name') or project.name}"
    # 真正的桌面窗口：Qt WebEngine（不是浏览器打开网址）
    try:
        return _desktop_qt_window(url, title, server_proc, args.width, args.height)
    except Exception as exc:  # noqa: BLE001
        _desktop_log(f"[desktop] qt window failed: {exc}")
        _stop_proc(server_proc)
        _show_error(
            "AsmLens",
            "桌面窗口启动失败。\n"
            f"原因：{exc}\n\n"
            "请确认已安装 PySide6，或重新运行 packaging\\build_windows.bat 打包。",
        )
        return 5


_SUBCOMMANDS = frozenset({"run", "prepare", "serve", "desktop"})


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="asmlens",
        description=(
            "AsmLens: 评估组装覆盖与问题区间，生成桌面交付包。\n"
            "激活 conda 环境 AsmLens-env 后可直接：\n"
            "  asmlens -q asm.fa -ref ref.fa -hifi reads.fq.gz -t 16 -o out\n"
            "  asmlens -q asm.fa --bam existing.bam --craq /path/to/CRAQ -o out"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    # Default pipeline flags also live on the top-level parser so
    # ``asmlens -q …`` works without typing ``run``.
    add_run_arguments(p)

    sub = p.add_subparsers(dest="command", required=False)

    run = sub.add_parser(
        "run",
        help="分析流水线（可省略：直接 asmlens -q …）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    add_run_arguments(run)

    prep = sub.add_parser("prepare", help="从已有 depth/CRAQ/QV 构建工程")
    prep.add_argument("-o", "--out", required=True, help="Output project directory")
    prep.add_argument("--name", default="AsmLens project", help="Project display name")
    g = prep.add_mutually_exclusive_group(required=True)
    g.add_argument("--fai", help="genome.fa.fai (preferred)")
    g.add_argument("--chrom-sizes", help="chrom.sizes (chrom\\tlength)")
    prep.add_argument("--depth", help="samtools depth -a output")
    prep.add_argument("--zero-max-depth", type=int, default=0, help="Zero-cov threshold")
    prep.add_argument("--low-max-depth", type=int, default=5, help="Low-cov threshold")
    prep.add_argument("--min-length", type=int, default=100, help="Min region length bp")
    prep.add_argument("--depth-window", type=int, default=1000, help="Coverage bedGraph window")
    prep.add_argument("--no-coverage-track", action="store_true", help="Skip bedGraph coverage track")
    prep.add_argument("--craq-dir", "--craq", dest="craq_dir", help="CRAQ 结果目录")
    prep.add_argument("--qv-bed", "--qv", dest="qv_bed", help="Low-QV regions BED")
    prep.add_argument("--qv-tsv", help="Window QV TSV")
    prep.add_argument("--max-qv", type=float, default=30.0, help="QV cutoff for --qv-tsv")
    prep.add_argument("--chrom", action="append", help="Only process these chromosomes")
    prep.set_defaults(func=cmd_prepare)

    serve = sub.add_parser("serve", help="为工程启动 HTTP 服务")
    serve.add_argument("-p", "--project", required=True, help="Project directory")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.set_defaults(func=cmd_serve)

    desk = sub.add_parser("desktop", help="打开桌面窗口（工程目录或交付 zip）")
    desk.add_argument(
        "-p",
        "--project",
        default=None,
        help="Project directory or asmlens_bundle_*.zip（可省略：空白启动，再在文件菜单打开）",
    )
    desk.add_argument("--host", default="127.0.0.1")
    desk.add_argument("--port", type=int, default=8765)
    desk.add_argument("--width", type=int, default=1400)
    desk.add_argument("--height", type=int, default=900)
    desk.set_defaults(func=cmd_desktop)

    return p


def main(argv: list[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    # Default subcommand = run, so ``asmlens -q asm.fa …`` works.
    if raw and raw[0] not in _SUBCOMMANDS and raw[0] not in ("-h", "--help"):
        raw = ["run"] + raw
    parser = build_parser()
    args = parser.parse_args(raw)
    func = getattr(args, "func", None) or cmd_run
    return int(func(args))


if __name__ == "__main__":
    raise SystemExit(main())
