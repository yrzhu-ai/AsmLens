"""Optional GenomeSyn2 runner + light synteny BED export from PAF/coords."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple


def which(name: str) -> Optional[str]:
    return shutil.which(name)


def run_genomesyn2(
    ref: Path,
    query: Path,
    out_dir: Path,
    *,
    threads: int = 8,
    align: str = "minimap2",
) -> Optional[Path]:
    """
    Run GenomeSyn2 if available on PATH.

    Layout expected by GenomeSyn2::
        fa_data/<ref.fa>
        fa_data/<query.fa>
        GenomeSyn2 --align minimap2 --genome fa_data --outdir output --thread N
    """
    exe = which("GenomeSyn2") or which("genomesyn2") or which("GenomeSyn")
    if not exe:
        print("[genomesyn] GenomeSyn2 not found on PATH — skip", flush=True)
        return None

    out_dir = Path(out_dir)
    fa_data = out_dir / "fa_data"
    result = out_dir / "output"
    fa_data.mkdir(parents=True, exist_ok=True)
    result.mkdir(parents=True, exist_ok=True)

    ref_link = fa_data / "1.ref.fa"
    qry_link = fa_data / "2.query.fa"
    for dst, src in ((ref_link, Path(ref)), (qry_link, Path(query))):
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        try:
            dst.symlink_to(src.resolve())
        except OSError:
            shutil.copy2(src, dst)

    cmd = [
        exe,
        "--align", align,
        "--genome", str(fa_data),
        "--outdir", str(result),
        "--thread", str(threads),
    ]
    print("[CMD]", " ".join(cmd), flush=True)
    log = out_dir / "genomesyn2.log"
    with log.open("w", encoding="utf-8") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, text=True, cwd=str(out_dir))
    if proc.returncode != 0:
        print(f"[genomesyn] failed (see {log}) — continue", flush=True)
        return None
    print(f"[genomesyn] done → {result}", flush=True)
    return result


def paf_to_synteny_bed(
    paf: Path,
    out_bed: Path,
    *,
    min_len: int = 10000,
    genome: str = "query",
) -> Tuple[Path, int]:
    """
    Convert minimap2 PAF (ref←query) into a BED on the query (or ref) axis
    for AsmLens collinearity track.
    """
    out_bed = Path(out_bed)
    out_bed.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with Path(paf).open(encoding="utf-8", errors="replace") as fin, out_bed.open(
        "w", encoding="utf-8"
    ) as fout:
        for line in fin:
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 12:
                continue
            qname, _qlen, qs, qe = parts[0], parts[1], int(parts[2]), int(parts[3])
            strand = parts[4]
            tname, _tlen, ts, te = parts[5], parts[6], int(parts[7]), int(parts[8])
            qspan = abs(qe - qs)
            if qspan < min_len:
                continue
            if genome == "ref":
                s0, e0, chrom = min(ts, te), max(ts, te), tname
                name = f"syn_{qname}:{qs}-{qe}{strand}"
            else:
                s0, e0, chrom = min(qs, qe), max(qs, qe), qname
                name = f"syn_{tname}:{ts}-{te}{strand}"
            fout.write(f"{chrom}\t{s0}\t{e0}\t{name}\t{qspan}\t{strand}\n")
            n += 1
    return out_bed, n


def coords_to_synteny_bed(
    coords: Path,
    out_bed: Path,
    *,
    min_len: int = 10000,
    genome: str = "query",
) -> Tuple[Path, int]:
    """MUMmer show-coords → BED (query or ref)."""
    out_bed = Path(out_bed)
    out_bed.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with Path(coords).open(encoding="utf-8", errors="replace") as fin, out_bed.open(
        "w", encoding="utf-8"
    ) as fout:
        for line in fin:
            if not line.strip() or line.startswith("=") or line.startswith("["):
                continue
            # typical: S1 E1 | S2 E2 | LEN1 LEN2 | %IDY | ... | TAG1 TAG2
            parts = line.replace("|", " ").split()
            if len(parts) < 9:
                continue
            try:
                s1, e1 = int(float(parts[0])), int(float(parts[1]))
                s2, e2 = int(float(parts[2])), int(float(parts[3]))
            except ValueError:
                continue
            tag1 = parts[-2] if len(parts) >= 2 else "ref"
            tag2 = parts[-1] if len(parts) >= 1 else "query"
            if genome == "ref":
                chrom, s0, e0 = tag1, min(s1, e1) - 1, max(s1, e1)
                name = f"syn_{tag2}:{min(s2, e2)}-{max(s2, e2)}"
                span = abs(e1 - s1)
            else:
                chrom, s0, e0 = tag2, min(s2, e2) - 1, max(s2, e2)
                name = f"syn_{tag1}:{min(s1, e1)}-{max(s1, e1)}"
                span = abs(e2 - s2)
            if span < min_len:
                continue
            strand = "+" if (e1 - s1) * (e2 - s2) > 0 else "-"
            fout.write(f"{chrom}\t{s0}\t{e0}\t{name}\t{span}\t{strand}\n")
            n += 1
    return out_bed, n


def synteny_track_meta(bed_rel: str, *, genome: str, name: str) -> Dict:
    return {
        "id": f"synteny_{genome}",
        "name": name,
        "type": "bed",
        "file": bed_rel,
        "color": "#2b8a3e" if genome == "query" else "#5c7cfa",
        "height": 28,
        "kind": "COLLINEAR",
        "genome": genome,
    }
