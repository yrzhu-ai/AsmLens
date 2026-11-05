"""
Server-side AsmLens analysis pipeline.

Map reads → depth → problem tracks → desktop delivery package (.zip).
Does not require BAM in the delivery package.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from .prepare import prepare_project


READ_PRESETS = {
    "hifi": "map-hifi",
    "clr": "map-pb",
    "ont": "map-ont",
    "illumina": "sr",
}


@dataclass
class RunConfig:
    query: Path  # -q assembly under test
    threads: int = 8
    out_dir: Path = Path("asmlens_out")
    ref: Optional[Path] = None  # optional reference genome
    hifi: List[Path] = field(default_factory=list)
    clr: List[Path] = field(default_factory=list)
    ont: List[Path] = field(default_factory=list)
    illumina: List[Path] = field(default_factory=list)
    name: str = "AsmLens run"
    min_length: int = 100
    low_max_depth: int = 5
    depth_window: int = 1000
    keep_bam: bool = False
    mapq: int = 20


def which_or_die(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(
            f"Required command not found: {name}\n"
            f"Install via: conda install -c bioconda {name}\n"
            f"Or re-run install.sh"
        )
    return path


def run_cmd(cmd: Sequence[str], *, log_path: Optional[Path] = None) -> None:
    print("[CMD]", " ".join(str(c) for c in cmd), flush=True)
    if log_path:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as fh:
            proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, text=True)
    else:
        proc = subprocess.run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {' '.join(map(str, cmd))}")


def ensure_fai(fasta: Path, threads: int = 4) -> Path:
    fai = Path(str(fasta) + ".fai")
    if fai.is_file() and fai.stat().st_mtime >= Path(fasta).stat().st_mtime:
        return fai
    samtools = which_or_die("samtools")
    run_cmd([samtools, "faidx", str(fasta)])
    return fai


def collect_read_batches(cfg: RunConfig) -> List[tuple[str, List[Path]]]:
    batches: List[tuple[str, List[Path]]] = []
    if cfg.hifi:
        batches.append(("hifi", list(cfg.hifi)))
    if cfg.clr:
        batches.append(("clr", list(cfg.clr)))
    if cfg.ont:
        batches.append(("ont", list(cfg.ont)))
    if cfg.illumina:
        batches.append(("illumina", list(cfg.illumina)))
    if not batches:
        raise ValueError("Provide at least one of -hifi / -clr / -ont / -Illumina")
    return batches


def map_reads_to_bam(
    query: Path,
    reads: Sequence[Path],
    *,
    read_type: str,
    threads: int,
    out_bam: Path,
    mapq: int,
    log_dir: Path,
) -> Path:
    minimap2 = which_or_die("minimap2")
    samtools = which_or_die("samtools")
    preset = READ_PRESETS[read_type]
    out_bam = Path(out_bam)
    out_bam.parent.mkdir(parents=True, exist_ok=True)
    tmp_bam = out_bam.with_suffix(".tmp.bam")

    # minimap2 | samtools sort
    cmd = (
        f"{minimap2} -ax {preset} -t {threads} {query} "
        + " ".join(str(r) for r in reads)
        + f" | {samtools} view -b -q {mapq} -F 0x900 -"
        + f" | {samtools} sort -@ {max(1, threads // 2)} -o {tmp_bam} -"
    )
    print("[CMD]", cmd, flush=True)
    log_path = log_dir / f"map_{read_type}.log"
    with log_path.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(["bash", "-o", "pipefail", "-c", cmd], stdout=fh, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Mapping failed for {read_type}; see {log_path}")
    tmp_bam.replace(out_bam)
    run_cmd([samtools, "index", "-@", str(max(1, threads // 2)), str(out_bam)])
    return out_bam


def merge_bams(bams: Sequence[Path], out_bam: Path, threads: int) -> Path:
    samtools = which_or_die("samtools")
    out_bam = Path(out_bam)
    if len(bams) == 1:
        shutil.copy2(bams[0], out_bam)
        bai = Path(str(bams[0]) + ".bai")
        if bai.is_file():
            shutil.copy2(bai, Path(str(out_bam) + ".bai"))
        else:
            run_cmd([samtools, "index", "-@", str(max(1, threads // 2)), str(out_bam)])
        return out_bam
    run_cmd(
        [samtools, "merge", "-@", str(max(1, threads // 2)), "-f", str(out_bam)]
        + [str(b) for b in bams]
    )
    run_cmd([samtools, "index", "-@", str(max(1, threads // 2)), str(out_bam)])
    return out_bam


def bam_to_depth(bam: Path, depth_path: Path, threads: int) -> Path:
    samtools = which_or_die("samtools")
    depth_path = Path(depth_path)
    # samtools depth -a may ignore -@ on older versions; still fine
    cmd = [samtools, "depth", "-a", "-@", str(max(1, threads // 2)), str(bam)]
    print("[CMD]", " ".join(cmd), ">", depth_path, flush=True)
    with depth_path.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        # fallback without -@
        cmd = [samtools, "depth", "-a", str(bam)]
        with depth_path.open("w", encoding="utf-8") as fh:
            proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"samtools depth failed: {proc.stderr}")
    return depth_path


def write_manifest(project_dir: Path, cfg: RunConfig, extra: Dict) -> Path:
    manifest = {
        "format": "asmlens-bundle",
        "format_version": 1,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "name": cfg.name,
        "query": str(cfg.query),
        "ref": str(cfg.ref) if cfg.ref else None,
        "threads": cfg.threads,
        "reads": {
            "hifi": [str(p) for p in cfg.hifi],
            "clr": [str(p) for p in cfg.clr],
            "ont": [str(p) for p in cfg.ont],
            "illumina": [str(p) for p in cfg.illumina],
        },
        **extra,
    }
    path = project_dir / "bundle.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def pack_delivery(project_dir: Path, zip_path: Path) -> Path:
    """Zip project for desktop download (coordinates only; no BAM/depth)."""
    project_dir = Path(project_dir)
    zip_path = Path(zip_path)
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    skip_suffixes = {".bam", ".bai", ".fastq", ".fq"}
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in project_dir.rglob("*"):
            if not p.is_file():
                continue
            name = p.name.lower()
            if p.suffix.lower() in skip_suffixes:
                continue
            if name.endswith(".depth.txt") or name.endswith(".fastq.gz") or name.endswith(".fq.gz"):
                continue
            rel = p.relative_to(project_dir)
            zf.write(p, arcname=str(Path(project_dir.name) / rel))
    return zip_path

def run_pipeline(cfg: RunConfig) -> Dict[str, Path]:
    which_or_die("minimap2")
    which_or_die("samtools")

    out_dir = Path(cfg.out_dir).resolve()
    work = out_dir / "work"
    project_dir = out_dir / "project"
    logs = out_dir / "logs"
    for d in (work, project_dir, logs):
        d.mkdir(parents=True, exist_ok=True)

    query = Path(cfg.query).resolve()
    if not query.is_file():
        raise FileNotFoundError(f"-q genome not found: {query}")
    if cfg.ref is not None:
        cfg.ref = Path(cfg.ref).resolve()
        if not cfg.ref.is_file():
            raise FileNotFoundError(f"-ref not found: {cfg.ref}")

    print(f"[run] query (-q): {query}", flush=True)
    print(f"[run] out: {out_dir}", flush=True)
    fai = ensure_fai(query, threads=cfg.threads)

    batches = collect_read_batches(cfg)
    bam_parts: List[Path] = []
    for read_type, reads in batches:
        for r in reads:
            if not Path(r).is_file():
                raise FileNotFoundError(f"Read file not found ({read_type}): {r}")
        part = work / f"{read_type}.sorted.bam"
        print(f"[run] mapping {read_type}: {len(reads)} file(s)", flush=True)
        map_reads_to_bam(
            query,
            reads,
            read_type=read_type,
            threads=cfg.threads,
            out_bam=part,
            mapq=cfg.mapq,
            log_dir=logs,
        )
        bam_parts.append(part)

    merged = work / "reads.vs.query.sorted.bam"
    merge_bams(bam_parts, merged, cfg.threads)

    depth_path = work / "coverage.depth.txt"
    print("[run] computing depth ...", flush=True)
    bam_to_depth(merged, depth_path, cfg.threads)

    print("[run] building AsmLens project ...", flush=True)
    prepare_project(
        project_dir,
        fai=fai,
        depth=depth_path,
        low_max_depth=cfg.low_max_depth,
        min_length=cfg.min_length,
        depth_window=cfg.depth_window,
        include_coverage_track=True,
        name=cfg.name,
    )

    # optional: record ref path in bundle (desktop may ignore for now)
    if cfg.ref is not None:
        ref_meta = project_dir / "ref_info.txt"
        ref_meta.write_text(f"ref={cfg.ref}\n", encoding="utf-8")
        try:
            ensure_fai(cfg.ref, threads=cfg.threads)
            shutil.copy2(str(cfg.ref) + ".fai", project_dir / "ref.fa.fai")
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] could not index/copy ref fai: {exc}", flush=True)

    write_manifest(
        project_dir,
        cfg,
        extra={
            "project_dir": str(project_dir),
            "merged_bam": str(merged) if cfg.keep_bam else None,
        },
    )

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = out_dir / f"asmlens_bundle_{stamp}.zip"
    print(f"[run] packing delivery → {zip_path}", flush=True)
    pack_delivery(project_dir, zip_path)

    # write pointer for convenience
    (out_dir / "LATEST_BUNDLE.txt").write_text(str(zip_path) + "\n", encoding="utf-8")

    if not cfg.keep_bam:
        for p in list(work.glob("*.bam")) + list(work.glob("*.bai")):
            try:
                p.unlink()
            except OSError:
                pass

    print("[run] DONE", flush=True)
    print(f"[run] project : {project_dir}", flush=True)
    print(f"[run] bundle  : {zip_path}", flush=True)
    print("[run] Desktop: download the zip, unzip, then: asmlens desktop -p <project_dir>", flush=True)
    return {"out_dir": out_dir, "project": project_dir, "bundle": zip_path}
