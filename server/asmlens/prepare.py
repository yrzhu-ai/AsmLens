"""Build an AsmLens project directory from coordinate inputs (no BAM)."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from . import __version__
from .craq_ingest import copy_craq_tracks
from .preprocess import (
    depth_to_regions,
    downsample_depth_bedgraph,
    merge_problems,
    write_regions_bed,
)
from .project import parse_fai, save_project, write_chrom_sizes
from .qv_ingest import copy_qv_bed, ingest_qv_table


def prepare_project(
    out_dir: Path,
    *,
    fai: Optional[Path] = None,
    chrom_sizes: Optional[Path] = None,
    depth: Optional[Path] = None,
    zero_max_depth: int = 0,
    low_max_depth: int = 5,
    min_length: int = 100,
    depth_window: int = 1000,
    include_coverage_track: bool = True,
    craq_dir: Optional[Path] = None,
    qv_bed: Optional[Path] = None,
    qv_tsv: Optional[Path] = None,
    max_qv: float = 30.0,
    name: str = "AsmLens project",
    chrom_filter: Optional[Sequence[str]] = None,
) -> Path:
    out_dir = Path(out_dir)
    tracks = out_dir / "tracks"
    tracks.mkdir(parents=True, exist_ok=True)

    if fai is not None:
        sizes = parse_fai(Path(fai))
    elif chrom_sizes is not None:
        from .project import read_chrom_sizes

        sizes = read_chrom_sizes(Path(chrom_sizes))
    else:
        raise ValueError("Provide --fai or --chrom-sizes")

    write_chrom_sizes(out_dir / "chrom.sizes", sizes)

    track_metas: List[dict] = []
    buckets: Dict[str, List[Tuple[str, int, int, int]]] = {}

    if depth is not None:
        depth = Path(depth)
        print(f"[prepare] scanning depth for zero coverage (depth<={zero_max_depth}) ...")
        zero = depth_to_regions(
            depth,
            max_depth=zero_max_depth,
            min_length=min_length,
            chrom_filter=chrom_filter,
        )
        write_regions_bed(zero, tracks / "zero_coverage.bed", name_prefix="zero", score=0)
        buckets["ZERO_COV"] = zero
        track_metas.append(
            {
                "id": "zero_coverage",
                "name": "Zero coverage",
                "type": "bed",
                "file": "tracks/zero_coverage.bed",
                "color": "#e41a1c",
                "height": 26,
                "kind": "ZERO_COV",
            }
        )

        if low_max_depth > zero_max_depth:
            print(f"[prepare] scanning depth for low coverage (depth<={low_max_depth}) ...")
            low = depth_to_regions(
                depth,
                max_depth=low_max_depth,
                min_length=min_length,
                chrom_filter=chrom_filter,
            )
            # exclude pure zeros already listed if desired — keep all low incl zero for track
            write_regions_bed(low, tracks / "low_coverage.bed", name_prefix="low", score=1)
            buckets["LOW_COV"] = low
            track_metas.append(
                {
                    "id": "low_coverage",
                    "name": f"Low coverage (≤{low_max_depth}×)",
                    "type": "bed",
                    "file": "tracks/low_coverage.bed",
                    "color": "#ff7f00",
                    "height": 26,
                    "kind": "LOW_COV",
                }
            )

        if include_coverage_track and depth_window > 0:
            print(f"[prepare] writing windowed coverage bedGraph (w={depth_window}) ...")
            downsample_depth_bedgraph(
                depth,
                tracks / "coverage.bedgraph",
                window=depth_window,
                chrom_filter=chrom_filter,
            )
            track_metas.append(
                {
                    "id": "coverage",
                    "name": f"Coverage ({depth_window} bp mean)",
                    "type": "bedgraph",
                    "file": "tracks/coverage.bedgraph",
                    "color": "#377eb8",
                    "height": 64,
                    "kind": "COV",
                }
            )

    if craq_dir is not None:
        print(f"[prepare] ingesting CRAQ from {craq_dir} ...")
        metas, craq_buckets = copy_craq_tracks(Path(craq_dir), tracks)
        track_metas.extend(metas)
        buckets.update(craq_buckets)

    if qv_bed is not None:
        print(f"[prepare] ingesting QV BED {qv_bed} ...")
        meta, regions = copy_qv_bed(Path(qv_bed), tracks)
        track_metas.append(meta)
        buckets["LOW_QV"] = regions
    elif qv_tsv is not None:
        print(f"[prepare] ingesting QV table {qv_tsv} (max_qv={max_qv}) ...")
        meta, regions = ingest_qv_table(Path(qv_tsv), tracks, max_qv=max_qv)
        track_metas.append(meta)
        buckets["LOW_QV"] = regions

    n_prob = merge_problems(buckets, out_dir / "problems.tsv")
    print(f"[prepare] problems.tsv rows: {n_prob}")

    project = {
        "name": name,
        "version": __version__,
        "chrom_sizes": "chrom.sizes",
        "problems_file": "problems.tsv",
        "tracks": track_metas,
        "defaults": {
            "problem_only": True,
            "flank_bp": 50000,
        },
    }
    save_project(out_dir, project)
    print(f"[prepare] wrote project → {out_dir / 'project.json'}")
    return out_dir
