"""Genome–genome alignment helpers (minimap2 / MUMmer)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple


def which(name: str) -> Optional[str]:
    return shutil.which(name)


def align_minimap2(
    ref: Path,
    query: Path,
    out_paf: Path,
    *,
    threads: int = 8,
    preset: str = "asm5",
) -> Path:
    mm = which("minimap2")
    if not mm:
        raise RuntimeError("minimap2 not found")
    out_paf = Path(out_paf)
    out_paf.parent.mkdir(parents=True, exist_ok=True)
    cmd = [mm, "-x", preset, "-c", "-t", str(threads), str(ref), str(query)]
    print("[CMD]", " ".join(cmd), ">", out_paf, flush=True)
    with out_paf.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"minimap2 genome align failed: {proc.stderr[-2000:]}")
    return out_paf


def align_nucmer(
    ref: Path,
    query: Path,
    prefix: Path,
    *,
    threads: int = 8,
    mincluster: int = 1000,
    minmatch: int = 100,
    min_len_filter: int = 10000,
) -> Tuple[Path, Path]:
    """Return (filtered.delta, coords)."""
    for tool in ("nucmer", "delta-filter", "show-coords"):
        if not which(tool):
            raise RuntimeError(f"{tool} not found (need MUMmer4)")
    prefix = Path(prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    delta = Path(str(prefix) + ".delta")
    fdelta = Path(str(prefix) + ".f.delta")
    coords = Path(str(prefix) + ".f.coords")

    cmd = [
        "nucmer", "-c", str(mincluster), "-l", str(minmatch),
        "--batch=500000000", "-t", str(threads),
        "--prefix", str(prefix), str(ref), str(query),
    ]
    print("[CMD]", " ".join(cmd), flush=True)
    log = prefix.parent / (prefix.name + ".nucmer.log")
    with log.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"nucmer failed; see {log}")

    with fdelta.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(
            ["delta-filter", "-r", "-l", str(min_len_filter), str(delta)],
            stdout=fh, stderr=subprocess.PIPE, text=True,
        )
    if proc.returncode != 0:
        raise RuntimeError(f"delta-filter failed: {proc.stderr}")

    with coords.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(
            ["show-coords", "-r", "-l", str(fdelta)],
            stdout=fh, stderr=subprocess.PIPE, text=True,
        )
    if proc.returncode != 0:
        raise RuntimeError(f"show-coords failed: {proc.stderr}")
    return fdelta, coords


def paf_to_intervals(paf: Path, min_len: int = 1000, min_id: float = 0.9) -> List[dict]:
    """
    Parse PAF into alignment intervals.
    Returns dicts with ref/query chrom, 0-based half-open coords, strand, identity.
    """
    hits: List[dict] = []
    with Path(paf).open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            p = line.split("\t")
            if len(p) < 12:
                continue
            qname, qlen, qs, qe = p[0], int(p[1]), int(p[2]), int(p[3])
            strand = p[4]
            tname, tlen, ts, te = p[5], int(p[6]), int(p[7]), int(p[8])
            nmatch, alnlen = int(p[9]), int(p[10])
            if alnlen < min_len:
                continue
            ident = nmatch / alnlen if alnlen else 0.0
            if ident < min_id:
                continue
            hits.append(
                {
                    "q_chrom": qname,
                    "q_start": qs,
                    "q_end": qe,
                    "r_chrom": tname,
                    "r_start": ts,
                    "r_end": te,
                    "strand": strand,
                    "identity": round(ident * 100, 2),
                    "alen": alnlen,
                }
            )
    return hits


def coords_to_intervals(coords: Path, min_len: int = 1000, min_id: float = 90.0) -> List[dict]:
    """Parse MUMmer show-coords -r -l into intervals (ref=S1, query=S2)."""
    hits: List[dict] = []
    with Path(coords).open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip() or line.startswith("/") or line.startswith("NUCMER") or "[S1]" in line or line.startswith("="):
                continue
            parts = line.replace("|", " ").split()
            if len(parts) < 11:
                continue
            try:
                s1, e1, s2, e2 = map(int, parts[0:4])
                idy = float(parts[6])
                ref, qry = parts[-2], parts[-1]
            except ValueError:
                continue
            alen = abs(e1 - s1) + 1
            if alen < min_len or idy < min_id:
                continue
            # store 0-based half-open on both
            r0, r1 = (min(s1, e1) - 1, max(s1, e1))
            q0, q1 = (min(s2, e2) - 1, max(s2, e2))
            strand = "+" if (e1 - s1) * (e2 - s2) > 0 else "-"
            hits.append(
                {
                    "q_chrom": qry,
                    "q_start": q0,
                    "q_end": q1,
                    "r_chrom": ref,
                    "r_start": r0,
                    "r_end": r1,
                    "strand": strand,
                    "identity": idy,
                    "alen": alen,
                }
            )
    return hits
