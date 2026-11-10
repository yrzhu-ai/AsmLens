"""Optional SyRI runner + ingest of syri.out into AsmLens tracks."""

from __future__ import annotations

import csv
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# SyRI annotation → display
SYRI_COLORS = {
    "SYN": "#69db7c",
    "INV": "#ff6b6b",
    "TRANS": "#fcc419",
    "INVTR": "#ff922b",
    "DUP": "#748ffc",
    "INVDP": "#9775fa",
    "NOTAL": "#adb5bd",
    "CPG": "#66d9e8",
    "CPL": "#3bc9db",
    "TDM": "#e599f7",
    "HDR": "#f783ac",
}


def run_syri(
    ref: Path,
    query: Path,
    out_dir: Path,
    *,
    coords: Optional[Path] = None,
    delta: Optional[Path] = None,
    threads: int = 8,
) -> Optional[Path]:
    """
    Run SyRI if available. Prefers MUMmer coords; falls back to delta when given.
    Returns out_dir on success.
    """
    syri = shutil.which("syri")
    if not syri:
        print("[syri] syri not found — skip", flush=True)
        return None
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd: Optional[List[str]] = None
    if coords and Path(coords).is_file():
        cmd = [syri, "-c", str(coords), "-F", "T", "-r", str(ref), "-q", str(query), "--dir", str(out_dir)]
    elif delta and Path(delta).is_file():
        cmd = [syri, "-d", str(delta), "-r", str(ref), "-q", str(query), "--dir", str(out_dir)]
    if cmd is None:
        print("[syri] no coords/delta — skip (need nucmer coords or --align-mode nucmer)", flush=True)
        return None

    print("[CMD]", " ".join(cmd), flush=True)
    log = out_dir / "syri.log"
    with log.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, text=True, cwd=str(out_dir))
    if proc.returncode != 0:
        print(f"[syri] failed (see {log}) — continue without SyRI", flush=True)
        return None
    print(f"[syri] done → {out_dir}", flush=True)
    return out_dir


def find_syri_out(syri_dir: Path) -> Optional[Path]:
    syri_dir = Path(syri_dir)
    for cand in (
        syri_dir / "syri.out",
        *sorted(syri_dir.glob("*syri.out")),
        *sorted(syri_dir.glob("*.out")),
    ):
        if cand.is_file() and cand.stat().st_size > 0:
            return cand
    return None


def ingest_syri_out(
    syri_dir: Path,
    tracks_dir: Path,
    *,
    genome: str = "query",
) -> Tuple[List[dict], List[dict]]:
    """
    Parse syri.out into per-type BED tracks + problem rows.

    SyRI columns (tab): refChr refStart refEnd ... queryChr queryStart queryEnd ... type parent ...
    Exact layout varies; we detect type column by known tags.
    """
    out = find_syri_out(syri_dir)
    if not out:
        print("[syri] no syri.out to ingest", flush=True)
        return [], []

    tracks_dir = Path(tracks_dir)
    tracks_dir.mkdir(parents=True, exist_ok=True)

    by_type: Dict[str, List[Tuple[str, int, int, str]]] = {}
    problems: List[dict] = []

    with out.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 10:
                continue
            # Find annotation type token
            ann = None
            for p in parts:
                up = p.upper()
                if up in SYRI_COLORS or up.startswith("SYN") or up.startswith("INV") or up in {
                    "TRANS", "DUP", "NOTAL", "CPG", "CPL", "TDM", "HDR", "INVTR", "INVDP",
                }:
                    ann = up
                    break
            if not ann:
                continue
            try:
                # Common: 0:refChr 1:refStart 2:refEnd 5:qryChr 6:qryStart 7:qryEnd
                ref_c, rs, re = parts[0], int(float(parts[1])), int(float(parts[2]))
                q_c, qs, qe = parts[5], int(float(parts[6])), int(float(parts[7]))
            except (ValueError, IndexError):
                continue
            if genome == "ref":
                chrom, s0, e0 = ref_c, min(rs, re) - 1, max(rs, re)
                name = f"{ann}_{q_c}:{min(qs, qe)}-{max(qs, qe)}"
            else:
                chrom, s0, e0 = q_c, min(qs, qe) - 1, max(qs, qe)
                name = f"{ann}_{ref_c}:{min(rs, re)}-{max(rs, re)}"
            if e0 <= s0:
                continue
            by_type.setdefault(ann, []).append((chrom, s0, e0, name))
            # structural variants as problems (skip pure SYN for problem list density)
            if ann != "SYN":
                problems.append({
                    "chrom": chrom,
                    "start": s0 + 1,
                    "end": e0,
                    "type": f"SYRI_{ann}",
                    "source": "syri",
                    "note": name,
                })

    metas: List[dict] = []
    for ann, rows in sorted(by_type.items()):
        bed = tracks_dir / f"syri_{ann.lower()}_{genome}.bed"
        with bed.open("w", encoding="utf-8") as fout:
            for chrom, s0, e0, name in rows:
                fout.write(f"{chrom}\t{s0}\t{e0}\t{name}\n")
        metas.append({
            "id": f"syri_{ann.lower()}_{genome}",
            "name": f"SyRI {ann}",
            "type": "bed",
            "file": f"tracks/{bed.name}",
            "color": SYRI_COLORS.get(ann, "#868e96"),
            "height": 22,
            "kind": f"SYRI_{ann}",
            "genome": genome,
        })
    print(f"[syri] ingested {sum(len(v) for v in by_type.values())} intervals → {len(metas)} tracks", flush=True)
    return metas, problems


def append_problems_tsv(problems_tsv: Path, rows: List[dict]) -> None:
    problems_tsv = Path(problems_tsv)
    exists = problems_tsv.is_file() and problems_tsv.stat().st_size > 0
    with problems_tsv.open("a", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(
            fh,
            fieldnames=["chrom", "start", "end", "type", "source", "note"],
            extrasaction="ignore",
        )
        if not exists:
            w.writeheader()
        for r in rows:
            w.writerow(r)
