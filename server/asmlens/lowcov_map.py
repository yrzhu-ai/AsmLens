"""
Map low-coverage intervals across genomes using synteny hits.

Attribution statuses (query-centric names when mapping query→ref):
  - both_lowcov      : mapped and overlaps lowcov on the other genome
  - mapped_not_lowcov: mapped but other side is covered
  - unmapped         : no synteny hit
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


Region = Tuple[str, int, int]  # chrom, start0, end0


def load_bed_regions(path: Path) -> List[Region]:
    out: List[Region] = []
    if not path.is_file():
        return out
    with Path(path).open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip() or line.startswith(("track", "browser", "#")):
                continue
            p = line.split()
            if len(p) < 3:
                continue
            out.append((p[0], int(p[1]), int(p[2])))
    return out


def overlap_bp(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def index_regions(regions: Sequence[Region]) -> Dict[str, List[Region]]:
    idx: Dict[str, List[Region]] = {}
    for c, s, e in regions:
        idx.setdefault(c, []).append((c, s, e))
    for c in idx:
        idx[c].sort(key=lambda x: x[1])
    return idx


def region_overlap_sum(idx: Dict[str, List[Region]], chrom: str, s: int, e: int) -> int:
    total = 0
    for _, rs, re in idx.get(chrom, []):
        if re <= s:
            continue
        if rs >= e:
            break
        total += overlap_bp(s, e, rs, re)
    return total


def map_regions_through_hits(
    regions: Sequence[Region],
    hits: Sequence[dict],
    *,
    region_is_query: bool,
    other_lowcov: Sequence[Region],
    min_map_frac: float = 0.05,
) -> List[dict]:
    """
    For each region, find overlapping synteny hits and project to the other genome.

    If region_is_query=True, region coords are on query; hits use q_* / r_*.
    If False, region coords are on ref.
    """
    other_idx = index_regions(other_lowcov)
    rows: List[dict] = []

    for i, (chrom, s, e) in enumerate(regions, 1):
        length = e - s
        matched = []
        for h in hits:
            if region_is_query:
                hc, hs, he = h["q_chrom"], h["q_start"], h["q_end"]
                oc, os_, oe = h["r_chrom"], h["r_start"], h["r_end"]
            else:
                hc, hs, he = h["r_chrom"], h["r_start"], h["r_end"]
                oc, os_, oe = h["q_chrom"], h["q_start"], h["q_end"]
            if hc != chrom:
                continue
            ov = overlap_bp(s, e, hs, he)
            if ov <= 0:
                continue
            # linear project overlap window onto other genome
            if he == hs:
                continue
            frac0 = (max(s, hs) - hs) / (he - hs)
            frac1 = (min(e, he) - hs) / (he - hs)
            if h["strand"] == "+":
                ps = int(os_ + (oe - os_) * frac0)
                pe = int(os_ + (oe - os_) * frac1)
            else:
                ps = int(oe - (oe - os_) * frac0)
                pe = int(oe - (oe - os_) * frac1)
            if pe < ps:
                ps, pe = pe, ps
            matched.append(
                {
                    "ov": ov,
                    "o_chrom": oc,
                    "o_start": ps,
                    "o_end": max(ps + 1, pe),
                    "strand": h["strand"],
                    "identity": h.get("identity", 0),
                }
            )

        mapped_bp = sum(m["ov"] for m in matched)
        mapped_frac = mapped_bp / length if length else 0.0
        mapped = mapped_frac >= min_map_frac and bool(matched)

        primary = max(matched, key=lambda m: m["ov"]) if matched else None
        other_low_bp = 0
        hit_strs = []
        for m in matched:
            ol = region_overlap_sum(other_idx, m["o_chrom"], m["o_start"], m["o_end"])
            other_low_bp += ol
            hit_strs.append(
                f"{m['o_chrom']}:{m['o_start']}-{m['o_end']}|id={m['identity']}|strand={m['strand']}|ov={m['ov']}|other_low={ol}"
            )

        if not mapped:
            status = "unmapped"
        elif other_low_bp > 0:
            status = "both_lowcov"
        else:
            status = "mapped_not_lowcov"

        rows.append(
            {
                "region_id": i,
                "chrom": chrom,
                "start": s + 1,  # 1-based for tables
                "end": e,
                "length": length,
                "mapped": "yes" if mapped else "no",
                "mapped_bp": mapped_bp,
                "mapped_frac": round(mapped_frac, 4),
                "status": status,
                "other_lowcov_bp": other_low_bp,
                "primary_other_chrom": primary["o_chrom"] if primary else "",
                "primary_other_start": (primary["o_start"] + 1) if primary else "",
                "primary_other_end": primary["o_end"] if primary else "",
                "primary_strand": primary["strand"] if primary else "",
                "primary_identity": primary["identity"] if primary else "",
                "all_hits": " ; ".join(hit_strs),
            }
        )
    return rows


def write_map_tsv(rows: Iterable[dict], path: Path) -> int:
    path = Path(path)
    rows = list(rows)
    if not rows:
        path.write_text(
            "region_id\tchrom\tstart\tend\tlength\tmapped\tmapped_bp\tmapped_frac\tstatus\t"
            "other_lowcov_bp\tprimary_other_chrom\tprimary_other_start\tprimary_other_end\t"
            "primary_strand\tprimary_identity\tall_hits\n",
            encoding="utf-8",
        )
        return 0
    fields = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def summarize_statuses(rows: Sequence[dict]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        out[r["status"]] = out.get(r["status"], 0) + 1
    return out


def status_to_bed(rows: Sequence[dict], path: Path, *, only: Optional[str] = None) -> int:
    """Write BED (0-based) colored by status for desktop tracks."""
    n = 0
    with Path(path).open("w", encoding="utf-8") as fh:
        for r in rows:
            if only and r["status"] != only:
                continue
            s0 = int(r["start"]) - 1
            e0 = int(r["end"])
            name = f"{r['status']}_{r['region_id']}"
            score = {"both_lowcov": 1000, "mapped_not_lowcov": 500, "unmapped": 100}.get(r["status"], 0)
            fh.write(f"{r['chrom']}\t{s0}\t{e0}\t{name}\t{score}\n")
            n += 1
    return n
