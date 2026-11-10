"""
Server-side AsmLens analysis pipeline.

Dual-genome + multi-read coverage → lowcov cross-map → delivery zip.
BAM stays on server (optional keep); desktop gets coordinates only.
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

from .align_genomes import (
    align_minimap2,
    align_nucmer,
    coords_to_intervals,
    paf_to_intervals,
)
from .craq_ingest import copy_craq_tracks
from .lowcov_map import (
    load_bed_regions,
    map_regions_through_hits,
    status_to_bed,
    summarize_statuses,
    write_map_tsv,
)
from .prepare import prepare_project
from .preprocess import depth_to_regions, find_fasta_gaps, write_regions_bed
from .project import parse_fai, save_project, write_chrom_sizes
from .qv_ingest import copy_qv_bed, ingest_qv_table
from .genomesyn_hooks import (
    coords_to_synteny_bed,
    paf_to_synteny_bed,
    run_genomesyn2,
    synteny_track_meta,
)
from .syri_hooks import append_problems_tsv, ingest_syri_out, run_syri


READ_PRESETS = {
    "hifi": "map-hifi",
    "clr": "map-pb",
    "ont": "map-ont",
    "illumina": "sr",
}


@dataclass
class RunConfig:
    query: Path
    threads: int = 8
    out_dir: Path = Path("asmlens_out")
    ref: Optional[Path] = None
    hifi: List[Path] = field(default_factory=list)
    clr: List[Path] = field(default_factory=list)
    ont: List[Path] = field(default_factory=list)
    illumina: List[Path] = field(default_factory=list)
    # Pre-existing alignments (skip remapping when provided)
    query_bam: List[Path] = field(default_factory=list)
    ref_bam: List[Path] = field(default_factory=list)
    name: str = "AsmLens run"
    min_length: int = 100
    low_max_depth: int = 5
    depth_window: int = 1000
    keep_bam: bool = False
    mapq: int = 20
    align_mode: str = "minimap2"  # minimap2 | nucmer
    run_syri: bool = False
    run_genomesyn: bool = False
    map_reads_to_ref: bool = True
    craq_dir: Optional[Path] = None
    qv_bed: Optional[Path] = None
    qv_tsv: Optional[Path] = None
    max_qv: float = 30.0


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
    return batches


def ensure_bam_index(bam: Path, threads: int = 4) -> Path:
    """Ensure ``bam.bai`` or ``bam.csi`` exists next to *bam*."""
    bam = Path(bam)
    bai = Path(str(bam) + ".bai")
    csi = Path(str(bam) + ".csi")
    if bai.is_file() or csi.is_file():
        return bam
    samtools = which_or_die("samtools")
    run_cmd([samtools, "index", "-@", str(max(1, threads // 2)), str(bam)])
    return bam


def stage_bams(bams: Sequence[Path], out_bam: Path, threads: int) -> Path:
    """
    Reuse existing BAM(s): single file → symlink/copy into work/;
    multiple → samtools merge. Always ensure an index beside *out_bam*.
    """
    resolved = [Path(b).resolve() for b in bams]
    for b in resolved:
        if not b.is_file():
            raise FileNotFoundError(f"BAM not found: {b}")
        ensure_bam_index(b, threads=threads)
    out_bam = Path(out_bam)
    out_bam.parent.mkdir(parents=True, exist_ok=True)
    if len(resolved) == 1:
        src = resolved[0]
        if out_bam.exists() or out_bam.is_symlink():
            out_bam.unlink()
        try:
            out_bam.symlink_to(src)
        except OSError:
            shutil.copy2(src, out_bam)
        # index beside staged path
        for suf in (".bai", ".csi"):
            src_idx = Path(str(src) + suf)
            dst_idx = Path(str(out_bam) + suf)
            if src_idx.is_file():
                if dst_idx.exists() or dst_idx.is_symlink():
                    dst_idx.unlink()
                try:
                    dst_idx.symlink_to(src_idx)
                except OSError:
                    shutil.copy2(src_idx, dst_idx)
                break
        else:
            ensure_bam_index(out_bam, threads=threads)
        return out_bam
    return merge_bams(resolved, out_bam, threads)


def obtain_bam(
    *,
    tag: str,
    target: Path,
    batches: List[tuple[str, List[Path]]],
    existing: Sequence[Path],
    work: Path,
    logs: Path,
    threads: int,
    mapq: int,
) -> Path:
    """Prefer pre-existing BAM(s); otherwise map reads → BAM."""
    out = work / f"reads.vs.{tag}.sorted.bam"
    if existing:
        print(f"[run] reuse BAM → {tag}: {', '.join(str(p) for p in existing)}", flush=True)
        return stage_bams(existing, out, threads)
    if not batches:
        raise ValueError(
            f"No BAM for {tag} and no reads to map. "
            f"Provide --bam/--ref-bam and/or -hifi/-clr/-ont/-Illumina."
        )
    return map_all_read_types(
        target, batches, tag=tag, work=work, logs=logs, threads=threads, mapq=mapq,
    )


def map_reads_to_bam(
    target: Path,
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
    cmd = (
        f"{minimap2} -ax {preset} -t {threads} {target} "
        + " ".join(str(r) for r in reads)
        + f" | {samtools} view -b -q {mapq} -F 0x900 -"
        + f" | {samtools} sort -@ {max(1, threads // 2)} -o {tmp_bam} -"
    )
    print("[CMD]", cmd, flush=True)
    log_path = log_dir / f"map_{out_bam.stem}.log"
    with log_path.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(["bash", "-o", "pipefail", "-c", cmd], stdout=fh, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Mapping failed ({out_bam.name}); see {log_path}")
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
    run_cmd([samtools, "merge", "-@", str(max(1, threads // 2)), "-f", str(out_bam)] + [str(b) for b in bams])
    run_cmd([samtools, "index", "-@", str(max(1, threads // 2)), str(out_bam)])
    return out_bam


def bam_to_depth(bam: Path, depth_path: Path, threads: int) -> Path:
    samtools = which_or_die("samtools")
    depth_path = Path(depth_path)
    cmd = [samtools, "depth", "-a", "-@", str(max(1, threads // 2)), str(bam)]
    print("[CMD]", " ".join(cmd), ">", depth_path, flush=True)
    with depth_path.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        cmd = [samtools, "depth", "-a", str(bam)]
        with depth_path.open("w", encoding="utf-8") as fh:
            proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"samtools depth failed: {proc.stderr}")
    return depth_path


def map_all_read_types(
    target: Path,
    batches: List[tuple[str, List[Path]]],
    *,
    tag: str,
    work: Path,
    logs: Path,
    threads: int,
    mapq: int,
) -> Path:
    parts: List[Path] = []
    for read_type, reads in batches:
        part = work / f"{tag}.{read_type}.sorted.bam"
        print(f"[run] map {read_type} → {tag}", flush=True)
        map_reads_to_bam(
            target, reads, read_type=read_type, threads=threads,
            out_bam=part, mapq=mapq, log_dir=logs,
        )
        parts.append(part)
    merged = work / f"reads.vs.{tag}.sorted.bam"
    return merge_bams(parts, merged, threads)


def write_manifest(project_dir: Path, cfg: RunConfig, extra: Dict) -> Path:
    manifest = {
        "format": "asmlens-bundle",
        "format_version": 2,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "name": cfg.name,
        "query": str(cfg.query),
        "ref": str(cfg.ref) if cfg.ref else None,
        "threads": cfg.threads,
        "align_mode": cfg.align_mode,
        "reads": {
            "hifi": [str(p) for p in cfg.hifi],
            "clr": [str(p) for p in cfg.clr],
            "ont": [str(p) for p in cfg.ont],
            "illumina": [str(p) for p in cfg.illumina],
        },
        "bams": {
            "query": [str(p) for p in cfg.query_bam],
            "ref": [str(p) for p in cfg.ref_bam],
        },
        "craq_dir": str(cfg.craq_dir) if cfg.craq_dir else None,
        "qv_bed": str(cfg.qv_bed) if cfg.qv_bed else None,
        "qv_tsv": str(cfg.qv_tsv) if cfg.qv_tsv else None,
        **extra,
    }
    path = project_dir / "bundle.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def pack_delivery(project_dir: Path, zip_path: Path) -> Path:
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


def _append_track(tracks: List[dict], meta: dict) -> None:
    tracks.append(meta)


def run_pipeline(cfg: RunConfig) -> Dict[str, Path]:
    which_or_die("minimap2")
    which_or_die("samtools")

    out_dir = Path(cfg.out_dir).resolve()
    work = out_dir / "work"
    project_dir = out_dir / "project"
    tracks_dir = project_dir / "tracks"
    logs = out_dir / "logs"
    for d in (work, project_dir, tracks_dir, logs):
        d.mkdir(parents=True, exist_ok=True)

    query = Path(cfg.query).resolve()
    if not query.is_file():
        raise FileNotFoundError(f"-q genome not found: {query}")
    if cfg.ref is not None:
        cfg.ref = Path(cfg.ref).resolve()
        if not cfg.ref.is_file():
            raise FileNotFoundError(f"-ref not found: {cfg.ref}")

    print(f"[run] query (-q): {query}", flush=True)
    print(f"[run] ref  (-ref): {cfg.ref}", flush=True)
    print(f"[run] out: {out_dir}", flush=True)

    q_fai = ensure_fai(query, threads=cfg.threads)
    q_sizes = parse_fai(q_fai)
    write_chrom_sizes(project_dir / "chrom.sizes", q_sizes)

    batches = collect_read_batches(cfg)
    for _, reads in batches:
        for r in reads:
            if not Path(r).is_file():
                raise FileNotFoundError(f"Read file not found: {r}")
    if not batches and not cfg.query_bam:
        raise ValueError(
            "Provide at least one of: -hifi / -clr / -ont / -Illumina / --bam"
        )

    # ---- 1) reads/BAM → query coverage ----
    q_bam = obtain_bam(
        tag="query",
        target=query,
        batches=batches,
        existing=cfg.query_bam,
        work=work,
        logs=logs,
        threads=cfg.threads,
        mapq=cfg.mapq,
    )
    q_depth = work / "coverage.query.depth.txt"
    print("[run] depth on query ...", flush=True)
    bam_to_depth(q_bam, q_depth, cfg.threads)

    prepare_project(
        project_dir,
        fai=q_fai,
        depth=q_depth,
        low_max_depth=cfg.low_max_depth,
        min_length=cfg.min_length,
        depth_window=cfg.depth_window,
        include_coverage_track=True,
        name=cfg.name,
    )
    # rename default tracks for clarity
    for old, new in (
        ("zero_coverage.bed", "query_zero_coverage.bed"),
        ("low_coverage.bed", "query_low_coverage.bed"),
        ("coverage.bedgraph", "query_coverage.bedgraph"),
    ):
        src, dst = tracks_dir / old, tracks_dir / new
        if src.is_file():
            src.replace(dst)

    # Assembly gaps (N-runs) on query genome
    print("[run] scan assembly gaps (N) on query ...", flush=True)
    q_gaps = find_fasta_gaps(query, min_n=10)
    write_regions_bed(q_gaps, tracks_dir / "query_gaps.bed", name_prefix="gap")
    print(f"[run] query gaps: {len(q_gaps)}", flush=True)

    # Coverage is the primary IGV-like track; low/zero/attr beds are overlays (ui=overlay).
    track_metas: List[dict] = [
        {"id": "query_gaps", "name": "组装 Gap (N)", "type": "bed",
         "file": "tracks/query_gaps.bed", "color": "#2c3e50", "height": 22, "kind": "GAP_Q",
         "genome": "query"},
        {"id": "query_coverage", "name": "Reads 覆盖", "type": "bedgraph",
         "file": "tracks/query_coverage.bedgraph", "color": "#377eb8", "height": 110, "kind": "COV_Q",
         "genome": "query", "style": "igv_coverage"},
        {"id": "query_low_coverage", "name": "覆盖偏低（叠图）", "type": "bed",
         "file": "tracks/query_low_coverage.bed", "color": "#ff7f00", "height": 26, "kind": "LOW_Q",
         "genome": "query", "ui": "overlay"},
        {"id": "query_zero_coverage", "name": "零覆盖（叠图）", "type": "bed",
         "file": "tracks/query_zero_coverage.bed", "color": "#e41a1c", "height": 26, "kind": "ZERO_Q",
         "genome": "query", "ui": "overlay"},
    ]

    summary: Dict = {"query_lowcov_status": {}, "query_gap_count": len(q_gaps)}
    hits: List[dict] = []
    ref_chrom_sizes_rel = None

    # ---- 2) optional ref branch ----
    if cfg.ref is not None:
        r_fai = ensure_fai(cfg.ref, threads=cfg.threads)
        r_sizes = parse_fai(r_fai)
        write_chrom_sizes(project_dir / "ref.chrom.sizes", r_sizes)
        ref_chrom_sizes_rel = "ref.chrom.sizes"
        (project_dir / "ref_info.txt").write_text(f"ref={cfg.ref}\n", encoding="utf-8")
        try:
            shutil.copy2(str(cfg.ref) + ".fai", project_dir / "ref.fa.fai")
        except OSError:
            pass

        # Reference gaps (N-runs) — for overview comparison vs assembly
        print("[run] scan assembly gaps (N) on ref ...", flush=True)
        r_gaps = find_fasta_gaps(cfg.ref, min_n=10)
        write_regions_bed(r_gaps, tracks_dir / "ref_gaps.bed", name_prefix="ref_gap")
        print(f"[run] ref gaps: {len(r_gaps)}", flush=True)
        track_metas.append({
            "id": "ref_gaps", "name": "参考 Gap (N)", "type": "bed",
            "file": "tracks/ref_gaps.bed", "color": "#2c3e50", "height": 22, "kind": "GAP_R",
            "genome": "ref",
        })
        summary["ref_gap_count"] = len(r_gaps)

        # genome align
        print(f"[run] genome align ({cfg.align_mode}): ref ↔ query ...", flush=True)
        if cfg.align_mode == "nucmer":
            _delta, coords = align_nucmer(cfg.ref, query, work / "ref_vs_query", threads=cfg.threads)
            hits = coords_to_intervals(coords)
            shutil.copy2(coords, project_dir / "ref_vs_query.coords")
        else:
            paf = align_minimap2(cfg.ref, query, work / "ref_vs_query.paf", threads=cfg.threads)
            hits = paf_to_intervals(paf)
            shutil.copy2(paf, project_dir / "ref_vs_query.paf")
        print(f"[run] synteny hits: {len(hits)}", flush=True)

        # reads/BAM → ref
        if cfg.map_reads_to_ref and (cfg.ref_bam or batches):
            r_bam = obtain_bam(
                tag="ref",
                target=cfg.ref,
                batches=batches,
                existing=cfg.ref_bam,
                work=work,
                logs=logs,
                threads=cfg.threads,
                mapq=cfg.mapq,
            )
            r_depth = work / "coverage.ref.depth.txt"
            print("[run] depth on ref ...", flush=True)
            bam_to_depth(r_bam, r_depth, cfg.threads)
            r_zero = depth_to_regions(r_depth, max_depth=0, min_length=cfg.min_length)
            r_low = depth_to_regions(r_depth, max_depth=cfg.low_max_depth, min_length=cfg.min_length)
            write_regions_bed(r_zero, tracks_dir / "ref_zero_coverage.bed", name_prefix="ref_zero")
            write_regions_bed(r_low, tracks_dir / "ref_low_coverage.bed", name_prefix="ref_low")
            from .preprocess import downsample_depth_bedgraph
            downsample_depth_bedgraph(r_depth, tracks_dir / "ref_coverage.bedgraph", window=cfg.depth_window)
            track_metas.extend([
                {"id": "ref_coverage", "name": "Reads 覆盖", "type": "bedgraph",
                 "file": "tracks/ref_coverage.bedgraph", "color": "#4daf4a", "height": 110, "kind": "COV_R",
                 "genome": "ref", "style": "igv_coverage"},
                {"id": "ref_low_coverage", "name": "覆盖偏低（叠图）", "type": "bed",
                 "file": "tracks/ref_low_coverage.bed", "color": "#984ea3", "height": 26, "kind": "LOW_R",
                 "genome": "ref", "ui": "overlay"},
                {"id": "ref_zero_coverage", "name": "零覆盖（叠图）", "type": "bed",
                 "file": "tracks/ref_zero_coverage.bed", "color": "#a65628", "height": 26, "kind": "ZERO_R",
                 "genome": "ref", "ui": "overlay"},
            ])
        else:
            if cfg.map_reads_to_ref and not cfg.ref_bam and not batches:
                print(
                    "[run] skip reads→ref: no --ref-bam and no reads "
                    "(provide --ref-bam / reads, or --no-map-reads-to-ref)",
                    flush=True,
                )
            r_low = []
            write_regions_bed([], tracks_dir / "ref_low_coverage.bed")

        # cross-map lowcov both directions
        q_low_bed = tracks_dir / "query_low_coverage.bed"
        r_low_bed = tracks_dir / "ref_low_coverage.bed"
        q_regions = load_bed_regions(q_low_bed)
        r_regions = load_bed_regions(r_low_bed)

        print("[run] map query-lowcov → ref ...", flush=True)
        q2r = map_regions_through_hits(q_regions, hits, region_is_query=True, other_lowcov=r_regions)
        write_map_tsv(q2r, project_dir / "query_lowcov_map_to_ref.tsv")
        status_to_bed(q2r, tracks_dir / "query_lowcov_attribution.bed")
        summary["query_lowcov_status"] = summarize_statuses(q2r)
        track_metas.append({
            "id": "query_lowcov_attribution",
            "name": "映射归因（叠图）",
            "type": "bed",
            "file": "tracks/query_lowcov_attribution.bed",
            "color": "#e41a1c",
            "height": 28,
            "kind": "ATTR_Q",
            "genome": "query",
            "ui": "overlay",
        })

        print("[run] map ref-lowcov → query ...", flush=True)
        r2q = map_regions_through_hits(r_regions, hits, region_is_query=False, other_lowcov=q_regions)
        write_map_tsv(r2q, project_dir / "ref_lowcov_map_to_query.tsv")
        status_to_bed(r2q, tracks_dir / "ref_lowcov_attribution.bed")
        summary["ref_lowcov_status"] = summarize_statuses(r2q)
        track_metas.append({
            "id": "ref_lowcov_attribution",
            "name": "映射归因（叠图）",
            "type": "bed",
            "file": "tracks/ref_lowcov_attribution.bed",
            "color": "#984ea3",
            "height": 28,
            "kind": "ATTR_R",
            "genome": "ref",
            "ui": "overlay",
        })

        # attribution legend
        (project_dir / "attribution_legend.txt").write_text(
            "both_lowcov: 两边都低覆盖（可能真实难区/共同困难）\n"
            "mapped_not_lowcov: 能映射到对方且对方覆盖正常 → 更像本侧组装问题\n"
            "unmapped: 共线性无法映射（结构变异/独有区/比对丢失）\n",
            encoding="utf-8",
        )

        # Collinearity BED tracks (always from align result when -ref given)
        try:
            if cfg.align_mode == "nucmer":
                coords_path = project_dir / "ref_vs_query.coords"
                if coords_path.is_file():
                    bed_q, nq = coords_to_synteny_bed(
                        coords_path, tracks_dir / "synteny_query.bed", genome="query"
                    )
                    bed_r, nr = coords_to_synteny_bed(
                        coords_path, tracks_dir / "synteny_ref.bed", genome="ref"
                    )
                    print(f"[run] synteny beds: query={nq} ref={nr}", flush=True)
                    track_metas.append(synteny_track_meta("tracks/synteny_query.bed", genome="query", name="共线性 (组装)"))
                    track_metas.append(synteny_track_meta("tracks/synteny_ref.bed", genome="ref", name="共线性 (参考)"))
            else:
                paf_path = project_dir / "ref_vs_query.paf"
                if paf_path.is_file():
                    bed_q, nq = paf_to_synteny_bed(paf_path, tracks_dir / "synteny_query.bed", genome="query")
                    bed_r, nr = paf_to_synteny_bed(paf_path, tracks_dir / "synteny_ref.bed", genome="ref")
                    print(f"[run] synteny beds: query={nq} ref={nr}", flush=True)
                    track_metas.append(synteny_track_meta("tracks/synteny_query.bed", genome="query", name="共线性 (组装)"))
                    track_metas.append(synteny_track_meta("tracks/synteny_ref.bed", genome="ref", name="共线性 (参考)"))
        except Exception as exc:  # noqa: BLE001
            print(f"[run] synteny bed export failed: {exc}", flush=True)

        if cfg.run_genomesyn:
            run_genomesyn2(cfg.ref, query, out_dir / "genomesyn", threads=cfg.threads, align="minimap2")

        if cfg.run_syri:
            coords = project_dir / "ref_vs_query.coords"
            delta = work / "ref_vs_query.f.delta"
            if not delta.is_file():
                delta = work / "ref_vs_query.delta"
            syri_dir = run_syri(
                cfg.ref,
                query,
                out_dir / "syri",
                coords=coords if coords.is_file() else None,
                delta=delta if delta.is_file() else None,
            )
            if syri_dir:
                for g in ("query", "ref"):
                    metas, probs = ingest_syri_out(syri_dir, tracks_dir, genome=g)
                    track_metas.extend(metas)
                    if probs and g == "query":
                        append_problems_tsv(project_dir / "problems.tsv", probs)

    # ---- CRAQ / QV optional ingest ----
    if cfg.craq_dir:
        metas, _ = copy_craq_tracks(Path(cfg.craq_dir), tracks_dir)
        track_metas.extend(metas)
    if cfg.qv_bed:
        meta, _ = copy_qv_bed(Path(cfg.qv_bed), tracks_dir)
        track_metas.append(meta)
    elif cfg.qv_tsv:
        meta, _ = ingest_qv_table(Path(cfg.qv_tsv), tracks_dir, max_qv=cfg.max_qv)
        track_metas.append(meta)

    # rewrite project.json with full track list + Chinese-friendly defaults
    project = {
        "name": cfg.name,
        "version": "1.0.0",
        "chrom_sizes": "chrom.sizes",
        "ref_chrom_sizes": ref_chrom_sizes_rel,
        "problems_file": "problems.tsv",
        "tracks": track_metas,
        "tables": {
            "query_lowcov_map_to_ref": "query_lowcov_map_to_ref.tsv" if cfg.ref else None,
            "ref_lowcov_map_to_query": "ref_lowcov_map_to_query.tsv" if cfg.ref else None,
        },
        "defaults": {"problem_only": True, "flank_bp": 50000},
        "summary": summary,
    }
    save_project(project_dir, project)
    (project_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    write_manifest(project_dir, cfg, extra={"project_dir": str(project_dir), "summary": summary})

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = out_dir / f"asmlens_bundle_{stamp}.zip"
    print(f"[run] packing delivery → {zip_path}", flush=True)
    pack_delivery(project_dir, zip_path)
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
    if summary:
        print(f"[run] summary : {json.dumps(summary, ensure_ascii=False)}", flush=True)
    return {"out_dir": out_dir, "project": project_dir, "bundle": zip_path}
