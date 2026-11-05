"""Ingest Merqury / window QV / low-QV BED into AsmLens tracks."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .preprocess import ingest_bed_as_regions


def copy_qv_bed(
    bed_path: Path,
    tracks_dir: Path,
    *,
    track_id: str = "low_qv",
    name: str = "Low QV regions",
    color: str = "#4daf4a",
) -> Tuple[dict, List[Tuple[str, int, int, int]]]:
    tracks_dir = Path(tracks_dir)
    tracks_dir.mkdir(parents=True, exist_ok=True)
    dest = tracks_dir / f"{track_id}.bed"
    shutil.copy2(bed_path, dest)
    regions = ingest_bed_as_regions(dest)
    meta = {
        "id": track_id,
        "name": name,
        "type": "bed",
        "file": f"tracks/{dest.name}",
        "color": color,
        "height": 28,
        "kind": "LOW_QV",
    }
    return meta, regions


def windows_tsv_to_low_qv_bed(
    tsv_path: Path,
    out_bed: Path,
    *,
    qv_col: Optional[str] = None,
    max_qv: float = 30.0,
    chrom_col: str = "chrom",
    start_col: str = "start",
    end_col: str = "end",
) -> int:
    """
    Convert a windowed QV table to BED of windows with QV <= max_qv.

    Accepts TSV with header. If qv_col is None, tries: QV, qv, score.
    Coordinates: if start looks 1-based dense windows, still emit 0-based BED
    using start-1 when start>=1 and values look 1-based; default assume 0-based
    if min(start)==0 else 1-based.
    """
    tsv_path = Path(tsv_path)
    rows = []
    with tsv_path.open(encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        idx = {h: i for i, h in enumerate(header)}
        if qv_col is None:
            for cand in ("QV", "qv", "score", "qv_score"):
                if cand in idx:
                    qv_col = cand
                    break
        if qv_col is None or chrom_col not in idx or start_col not in idx or end_col not in idx:
            raise ValueError(
                f"Need columns {chrom_col}/{start_col}/{end_col}/QV in {tsv_path}; got {header}"
            )
        for line in fh:
            if not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            rows.append(parts)

    starts = [int(r[idx[start_col]]) for r in rows[:100] if r[idx[start_col]].lstrip("-").isdigit()]
    one_based = bool(starts) and min(starts) >= 1

    n = 0
    out_bed = Path(out_bed)
    with out_bed.open("w", encoding="utf-8") as fh:
        for parts in rows:
            try:
                chrom = parts[idx[chrom_col]]
                s = int(parts[idx[start_col]])
                e = int(parts[idx[end_col]])
                qv = float(parts[idx[qv_col]])
            except (ValueError, IndexError):
                continue
            if qv > max_qv:
                continue
            if one_based:
                s0, e0 = s - 1, e
            else:
                s0, e0 = s, e
            fh.write(f"{chrom}\t{s0}\t{e0}\tQV_{qv:.1f}\t{qv:.2f}\n")
            n += 1
    return n


def ingest_qv_table(
    tsv_path: Path,
    tracks_dir: Path,
    *,
    max_qv: float = 30.0,
) -> Tuple[dict, List[Tuple[str, int, int, int]]]:
    tracks_dir = Path(tracks_dir)
    tracks_dir.mkdir(parents=True, exist_ok=True)
    bed = tracks_dir / "low_qv.bed"
    windows_tsv_to_low_qv_bed(tsv_path, bed, max_qv=max_qv)
    regions = ingest_bed_as_regions(bed)
    meta = {
        "id": "low_qv",
        "name": f"Low QV (≤{max_qv})",
        "type": "bed",
        "file": "tracks/low_qv.bed",
        "color": "#4daf4a",
        "height": 28,
        "kind": "LOW_QV",
    }
    return meta, regions
