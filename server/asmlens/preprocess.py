"""
Coverage / CRAQ / QV preprocessing for AsmLens projects.

Zero-coverage extraction logic adapted from the user's
`可视化覆盖/统计覆盖率零区域的.txt` script (samtools depth → regions).
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


def depth_to_regions(
    depth_path: Path,
    *,
    max_depth: int = 0,
    min_length: int = 1,
    chrom_filter: Optional[Sequence[str]] = None,
) -> List[Tuple[str, int, int, int]]:
    """
    From `samtools depth -a` (chrom, pos, depth), merge consecutive positions
    with depth <= max_depth into 1-based closed intervals.

    Returns list of (chrom, start, end, length).
    """
    chrom_set = set(chrom_filter) if chrom_filter else None
    regions: List[Tuple[str, int, int, int]] = []

    cur_chrom: Optional[str] = None
    in_run = False
    run_start = 0
    last_pos = 0

    def flush(chrom: str, start: int, end: int) -> None:
        length = end - start + 1
        if length >= min_length:
            regions.append((chrom, start, end, length))

    with Path(depth_path).open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            chrom, pos_s, dep_s = parts[0], parts[1], parts[2]
            if chrom_set is not None and chrom not in chrom_set:
                if in_run and cur_chrom is not None:
                    flush(cur_chrom, run_start, last_pos)
                    in_run = False
                cur_chrom = None
                continue
            try:
                pos = int(pos_s)
                dep = int(float(dep_s))
            except ValueError:
                continue

            if chrom != cur_chrom:
                if in_run and cur_chrom is not None:
                    flush(cur_chrom, run_start, last_pos)
                    in_run = False
                cur_chrom = chrom
                last_pos = 0

            if dep <= max_depth:
                if not in_run:
                    in_run = True
                    run_start = pos
                last_pos = pos
            else:
                if in_run:
                    flush(cur_chrom, run_start, last_pos)
                    in_run = False
                last_pos = pos

            if lineno % 10_000_000 == 0:
                print(f"  depth processed {lineno:,} lines ...", flush=True)

    if in_run and cur_chrom is not None:
        flush(cur_chrom, run_start, last_pos)
    return regions


def write_regions_tsv(
    regions: Iterable[Tuple[str, int, int, int]],
    path: Path,
    *,
    source: str = "",
    kind: str = "",
) -> int:
    path = Path(path)
    n = 0
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        header = ["chrom", "start", "end", "length"]
        if kind:
            header.append("type")
        if source:
            header.append("source")
        w.writerow(header)
        for chrom, start, end, length in regions:
            row = [chrom, start, end, length]
            if kind:
                row.append(kind)
            if source:
                row.append(source)
            w.writerow(row)
            n += 1
    return n


def find_fasta_gaps(
    fasta: Path,
    *,
    min_n: int = 10,
) -> List[Tuple[str, int, int, int]]:
    """
    Scan FASTA for runs of N/n (assembly gaps).
    Returns 1-based closed intervals (chrom, start, end, length).
    """
    fasta = Path(fasta)
    regions: List[Tuple[str, int, int, int]] = []
    chrom: Optional[str] = None
    pos = 0  # 1-based position of last written base
    run_start: Optional[int] = None

    def flush_run(end_pos: int) -> None:
        nonlocal run_start
        if chrom is None or run_start is None:
            return
        length = end_pos - run_start + 1
        if length >= min_n:
            regions.append((chrom, run_start, end_pos, length))
        run_start = None

    with fasta.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line:
                continue
            if line.startswith(">"):
                flush_run(pos)
                chrom = line[1:].strip().split()[0] if line.strip()[1:] else "unknown"
                pos = 0
                run_start = None
                continue
            seq = line.strip()
            if not seq or chrom is None:
                continue
            for ch in seq:
                pos += 1
                if ch in "Nn":
                    if run_start is None:
                        run_start = pos
                else:
                    if run_start is not None:
                        flush_run(pos - 1)
        flush_run(pos)
    return regions


def write_regions_bed(
    regions: Iterable[Tuple[str, int, int, int]],
    path: Path,
    *,
    name_prefix: str = "region",
    score: int = 0,
) -> int:
    """Write BED 0-based half-open from 1-based closed intervals."""
    path = Path(path)
    n = 0
    with path.open("w", encoding="utf-8") as fh:
        for chrom, start, end, length in regions:
            # 1-based closed → 0-based half-open
            fh.write(f"{chrom}\t{start - 1}\t{end}\t{name_prefix}_{length}bp\t{score}\n")
            n += 1
    return n


def ingest_bed_as_regions(
    bed_path: Path,
    *,
    min_length: int = 1,
) -> List[Tuple[str, int, int, int]]:
    """Read BED (0-based) → 1-based closed region tuples."""
    out: List[Tuple[str, int, int, int]] = []
    with Path(bed_path).open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip() or line.startswith(("track", "browser", "#")):
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            try:
                s0, e0 = int(parts[1]), int(parts[2])
            except ValueError:
                continue
            start1, end1 = s0 + 1, e0
            length = end1 - start1 + 1
            if length >= min_length:
                out.append((parts[0], start1, end1, length))
    return out


def merge_problems(
    buckets: Dict[str, List[Tuple[str, int, int, int]]],
    out_tsv: Path,
) -> int:
    """Write unified problems.tsv from typed region buckets."""
    out_tsv = Path(out_tsv)
    n = 0
    with out_tsv.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(["chrom", "start", "end", "length", "type", "label"])
        for kind, regions in buckets.items():
            for chrom, start, end, length in regions:
                w.writerow([chrom, start, end, length, kind, f"{kind}:{chrom}:{start}-{end}"])
                n += 1
    return n


def downsample_depth_bedgraph(
    depth_path: Path,
    out_path: Path,
    *,
    window: int = 1000,
    chrom_filter: Optional[Sequence[str]] = None,
) -> int:
    """
    Convert per-base depth to windowed mean bedGraph (0-based).
    Useful as a lightweight coverage track without BAM.
    """
    chrom_set = set(chrom_filter) if chrom_filter else None
    out_path = Path(out_path)
    n_windows = 0
    cur_chrom: Optional[str] = None
    win_start = 0
    win_sum = 0.0
    win_n = 0

    def flush(chrom: str, start: int, end: int, total: float, count: int) -> None:
        nonlocal n_windows
        if count <= 0 or end <= start:
            return
        mean = total / count
        with out_path.open("a", encoding="utf-8") as fh:
            fh.write(f"{chrom}\t{start}\t{end}\t{mean:.3f}\n")
        n_windows += 1

    if out_path.exists():
        out_path.unlink()
    out_path.write_text("", encoding="utf-8")

    with Path(depth_path).open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            chrom = parts[0]
            if chrom_set is not None and chrom not in chrom_set:
                continue
            try:
                pos = int(parts[1])
                dep = float(parts[2])
            except ValueError:
                continue
            # pos is 1-based
            pos0 = pos - 1
            if chrom != cur_chrom:
                if cur_chrom is not None and win_n:
                    flush(cur_chrom, win_start, win_start + window, win_sum, win_n)
                cur_chrom = chrom
                win_start = (pos0 // window) * window
                win_sum = 0.0
                win_n = 0
            this_win = (pos0 // window) * window
            if this_win != win_start:
                flush(cur_chrom, win_start, win_start + window, win_sum, win_n)
                win_start = this_win
                win_sum = 0.0
                win_n = 0
            win_sum += dep
            win_n += 1

    if cur_chrom is not None and win_n:
        flush(cur_chrom, win_start, win_start + window, win_sum, win_n)
    return n_windows
