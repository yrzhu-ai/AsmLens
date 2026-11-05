"""Ingest CRAQ coordinate outputs into AsmLens tracks."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Dict, List, Tuple

from .preprocess import ingest_bed_as_regions

# Typical CRAQ layout under runAQI_out /
CRAQ_BED_MAP = {
    "craq_CRE": ("locER_out/out_final.CRE.bed", "CRE"),
    "craq_CSE": ("strER_out/out_final.CSE.bed", "CSE"),
    "craq_CRH": ("locER_out/out_final.CRH.bed", "CRH"),
    "craq_CSH": ("strER_out/out_final.CSH.bed", "CSH"),
    "craq_lowcov": ("strER_out/out_low_coverage.bed", "CRAQ_LOWCOV"),
}


def find_craq_root(path: Path) -> Path:
    """Accept either runAQI_out itself or its parent Output dir."""
    path = Path(path)
    if (path / "locER_out").is_dir() or (path / "strER_out").is_dir():
        return path
    candidate = path / "runAQI_out"
    if candidate.is_dir():
        return candidate
    return path


def collect_craq_beds(craq_dir: Path) -> Dict[str, Path]:
    root = find_craq_root(craq_dir)
    found: Dict[str, Path] = {}
    for track_id, (rel, _kind) in CRAQ_BED_MAP.items():
        p = root / rel
        if p.is_file():
            found[track_id] = p
        else:
            # also accept basename dropped in a flat folder
            flat = root / Path(rel).name
            if flat.is_file():
                found[track_id] = flat
    return found


def copy_craq_tracks(
    craq_dir: Path,
    tracks_dir: Path,
) -> Tuple[List[dict], Dict[str, List[Tuple[str, int, int, int]]]]:
    """
    Copy CRAQ BED files into project tracks/ and return track metadata + regions.
    """
    tracks_dir = Path(tracks_dir)
    tracks_dir.mkdir(parents=True, exist_ok=True)
    found = collect_craq_beds(craq_dir)
    track_metas: List[dict] = []
    buckets: Dict[str, List[Tuple[str, int, int, int]]] = {}

    colors = {
        "craq_CRE": "#e41a1c",
        "craq_CSE": "#984ea3",
        "craq_CRH": "#ff7f00",
        "craq_CSH": "#a65628",
        "craq_lowcov": "#377eb8",
    }
    labels = {
        "craq_CRE": "CRAQ CRE (regional error)",
        "craq_CSE": "CRAQ CSE (structural error)",
        "craq_CRH": "CRAQ CRH (regional het)",
        "craq_CSH": "CRAQ CSH (structural het)",
        "craq_lowcov": "CRAQ low coverage",
    }

    for track_id, src in found.items():
        dest_name = f"{track_id}.bed"
        dest = tracks_dir / dest_name
        shutil.copy2(src, dest)
        kind = CRAQ_BED_MAP[track_id][1]
        regions = ingest_bed_as_regions(dest)
        buckets[kind] = regions
        track_metas.append(
            {
                "id": track_id,
                "name": labels.get(track_id, track_id),
                "type": "bed",
                "file": f"tracks/{dest_name}",
                "color": colors.get(track_id, "#666666"),
                "height": 28,
                "kind": kind,
            }
        )
    return track_metas, buckets
