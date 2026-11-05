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

    cfg = RunConfig(
        query=Path(args.q),
        threads=args.t,
        out_dir=Path(args.out),
        ref=Path(args.ref) if args.ref else None,
        hifi=_paths(args.hifi),
        clr=_paths(args.clr),
        ont=_paths(args.ont),
        illumina=_paths(args.Illumina),
        name=args.name,
        min_length=args.min_length,
        low_max_depth=args.low_max_depth,
        depth_window=args.depth_window,
        keep_bam=args.keep_bam,
        mapq=args.mapq,
    )
    run_pipeline(cfg)
    return 0


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


def cmd_desktop(args: argparse.Namespace) -> int:
    try:
        import webview
    except ImportError:
        print(
            "Desktop UI requires pywebview. Install with:\n"
            "  pip install 'asmlens[desktop]'   # or: pip install pywebview",
            file=sys.stderr,
        )
        return 2

    import threading

    import uvicorn

    from .api import create_app

    project = Path(args.project).resolve()
    # allow opening a delivery zip
    if project.suffix.lower() == ".zip":
        import tempfile
        import zipfile

        tmp = Path(tempfile.mkdtemp(prefix="asmlens_bundle_"))
        with zipfile.ZipFile(project) as zf:
            zf.extractall(tmp)
        # find project.json
        found = list(tmp.rglob("project.json"))
        if not found:
            print(f"No project.json inside {project}", file=sys.stderr)
            return 3
        project = found[0].parent

    app = create_app(project)
    host, port = args.host, args.port
    url = f"http://{host}:{port}/"

    def run_server() -> None:
        uvicorn.run(app, host=host, port=port, log_level="warning")

    th = threading.Thread(target=run_server, daemon=True)
    th.start()

    webview.create_window(
        f"AsmLens — {project.name}",
        url,
        width=args.width,
        height=args.height,
        confirm_close=True,
    )
    webview.start()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="asmlens",
        description=(
            "AsmLens: map reads to an assembly, find coverage problem regions, "
            "and produce a desktop delivery bundle (no BAM required on desktop)."
        ),
    )
    sub = p.add_subparsers(dest="command", required=True)

    run = sub.add_parser(
        "run",
        help="Server pipeline: map reads → coverage → delivery zip",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    run.add_argument("-q", required=True, help="Query/assembly FASTA to evaluate")
    run.add_argument("-t", type=int, default=8, help="Threads")
    run.add_argument("-ref", default=None, help="Optional reference genome FASTA")
    run.add_argument("-hifi", nargs="+", default=None, help="PacBio HiFi reads (fq/fq.gz)")
    run.add_argument("-clr", nargs="+", default=None, help="PacBio CLR reads")
    run.add_argument("-ont", nargs="+", default=None, help="ONT reads")
    run.add_argument("-Illumina", nargs="+", default=None, help="Illumina short reads")
    run.add_argument("-o", "--out", default="asmlens_out", help="Output directory")
    run.add_argument("--name", default="AsmLens run", help="Project display name")
    run.add_argument("--min-length", type=int, default=100, help="Min problem region length")
    run.add_argument("--low-max-depth", type=int, default=5, help="Low-coverage depth cutoff")
    run.add_argument("--depth-window", type=int, default=1000, help="Coverage bedGraph window")
    run.add_argument("--mapq", type=int, default=20, help="Min mapping quality")
    run.add_argument("--keep-bam", action="store_true", help="Keep intermediate BAM files")
    run.set_defaults(func=cmd_run)

    prep = sub.add_parser("prepare", help="Build a project from existing depth/CRAQ/QV files")
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
    prep.add_argument("--craq-dir", help="CRAQ runAQI_out directory")
    prep.add_argument("--qv-bed", help="Low-QV regions BED")
    prep.add_argument("--qv-tsv", help="Window QV TSV")
    prep.add_argument("--max-qv", type=float, default=30.0, help="QV cutoff for --qv-tsv")
    prep.add_argument("--chrom", action="append", help="Only process these chromosomes")
    prep.set_defaults(func=cmd_prepare)

    serve = sub.add_parser("serve", help="Start server for a project")
    serve.add_argument("-p", "--project", required=True, help="Project directory")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.set_defaults(func=cmd_serve)

    desk = sub.add_parser("desktop", help="Open desktop window (project dir or delivery zip)")
    desk.add_argument("-p", "--project", required=True, help="Project directory or asmlens_bundle_*.zip")
    desk.add_argument("--host", default="127.0.0.1")
    desk.add_argument("--port", type=int, default=8765)
    desk.add_argument("--width", type=int, default=1400)
    desk.add_argument("--height", type=int, default=900)
    desk.set_defaults(func=cmd_desktop)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
