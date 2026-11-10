"""AsmLens project schema and I/O."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_FILENAME = "project.json"


def load_project(project_dir: Path) -> Dict[str, Any]:
    path = Path(project_dir) / PROJECT_FILENAME
    if not path.is_file():
        raise FileNotFoundError(f"Missing {path}")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    data["_root"] = str(Path(project_dir).resolve())
    return data


def save_project(project_dir: Path, data: Dict[str, Any]) -> Path:
    project_dir = Path(project_dir)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "tracks").mkdir(exist_ok=True)
    out = {k: v for k, v in data.items() if not k.startswith("_")}
    path = project_dir / PROJECT_FILENAME
    with path.open("w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def read_chrom_sizes(path: Path) -> Dict[str, int]:
    sizes: Dict[str, int] = {}
    with Path(path).open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            sizes[parts[0]] = int(parts[1])
    return sizes


def write_chrom_sizes(path: Path, sizes: Dict[str, int]) -> None:
    with Path(path).open("w", encoding="utf-8") as fh:
        for chrom, length in sizes.items():
            fh.write(f"{chrom}\t{length}\n")


def parse_fai(fai_path: Path) -> Dict[str, int]:
    """Parse samtools .fai into chrom -> length."""
    sizes: Dict[str, int] = {}
    with Path(fai_path).open(encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2:
                sizes[parts[0]] = int(parts[1])
    return sizes


def track_path(project: Dict[str, Any], track_id: str) -> Path:
    root = Path(project["_root"])
    for tr in project.get("tracks", []):
        if tr["id"] == track_id:
            return root / tr["file"]
    raise KeyError(track_id)


# Feature-category → problem type codes (keep in sync with web/app.js)
PROBLEM_CATEGORY_TYPES: Dict[str, List[str]] = {
    "lowcov": [
        "ZERO_COV", "LOW_COV", "ZERO_Q", "LOW_Q", "ZERO_R", "LOW_R", "CRAQ_LOWCOV",
    ],
    "craq": ["CRE", "CRAQ_LOWCOV", "LOW_QV"],
    "refmap": ["ATTR_Q", "ATTR_R"],
    "synteny": [
        "COLLINEAR", "INV", "TRANS", "DUP", "NOTAL",
        "SYRI_SYN", "SYRI_INV", "SYRI_TRANS", "SYRI_DUP", "SYRI_NOTAL",
        "SYRI_INVTR", "SYRI_INVDP",
    ],
}


def _parse_problem_row(header: List[str], cols: List[str]) -> Optional[Dict[str, Any]]:
    row = {header[i]: cols[i] if i < len(cols) else "" for i in range(len(header))}
    try:
        row["start"] = int(row.get("start", 0))
        row["end"] = int(row.get("end", 0))
        row["length"] = int(row.get("length", row["end"] - row["start"]))
    except ValueError:
        return None
    return row


def iter_problems(
    project: Dict[str, Any],
    *,
    chroms: Optional[set] = None,
    types: Optional[set] = None,
    limit: Optional[int] = None,
):
    """Stream problems.tsv with optional chrom/type filters (stops early at limit)."""
    root = Path(project["_root"])
    path = root / project.get("problems_file", "problems.tsv")
    if not path.is_file():
        return
    with path.open(encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        n = 0
        for line in fh:
            if not line.strip():
                continue
            cols = line.rstrip("\n").split("\t")
            row = _parse_problem_row(header, cols)
            if row is None:
                continue
            if chroms is not None and row.get("chrom") not in chroms:
                continue
            if types is not None and row.get("type") not in types:
                continue
            yield row
            n += 1
            if limit is not None and n >= limit:
                return


def list_problems(
    project: Dict[str, Any],
    *,
    chroms: Optional[set] = None,
    types: Optional[set] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    return list(iter_problems(project, chroms=chroms, types=types, limit=limit))


def count_problems(project: Dict[str, Any]) -> int:
    """Fast line count for problems.tsv (avoids parsing on project open)."""
    summary = project.get("summary") or {}
    if isinstance(summary.get("problem_count"), int):
        return int(summary["problem_count"])
    if isinstance(project.get("problem_count"), int):
        return int(project["problem_count"])
    root = Path(project["_root"])
    path = root / project.get("problems_file", "problems.tsv")
    if not path.is_file():
        return 0
    n = 0
    with path.open(encoding="utf-8") as fh:
        next(fh, None)  # header
        for line in fh:
            if line.strip():
                n += 1
    return n


def resolve_problem_types(
    type_one: Optional[str] = None,
    types_csv: Optional[str] = None,
    categories_csv: Optional[str] = None,
) -> Optional[set]:
    """Build a type filter set from type / types / category query params."""
    out: set = set()
    if type_one:
        out.add(type_one)
    if types_csv:
        out.update(t.strip() for t in types_csv.split(",") if t.strip())
    if categories_csv:
        for cat in categories_csv.split(","):
            cat = cat.strip()
            for t in PROBLEM_CATEGORY_TYPES.get(cat, []):
                out.add(t)
            # also accept SYN* prefix via category synteny — handled client-side;
            # include common SYN_ codes if present as exact types above
    return out or None


def query_bed(
    bed_path: Path,
    chrom: Optional[str] = None,
    start: Optional[int] = None,
    end: Optional[int] = None,
    limit: int = 50000,
) -> List[Dict[str, Any]]:
    """
    Read BED (0-based half-open). Optional viewport filter.
    Accepts 3+ columns; 4th=name, 5th=score when present.
    """
    features: List[Dict[str, Any]] = []
    if not bed_path.is_file():
        return features
    with bed_path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip() or line.startswith(("track", "browser", "#")):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            c = parts[0]
            try:
                s = int(parts[1])
                e = int(parts[2])
            except ValueError:
                continue
            if chrom is not None and c != chrom:
                continue
            if start is not None and end is not None:
                if e <= start or s >= end:
                    continue
            feat: Dict[str, Any] = {
                "chrom": c,
                "start": s,
                "end": e,
                "name": parts[3] if len(parts) > 3 else "",
                "score": _to_float(parts[4]) if len(parts) > 4 else None,
            }
            features.append(feat)
            if len(features) >= limit:
                break
    return features


def query_bedgraph(
    path: Path,
    chrom: str,
    start: int,
    end: int,
    limit: int = 100000,
) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    if not path.is_file():
        return points
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip() or line.startswith(("track", "browser", "#")):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            if parts[0] != chrom:
                continue
            try:
                s, e = int(parts[1]), int(parts[2])
                val = float(parts[3])
            except ValueError:
                continue
            if e <= start or s >= end:
                continue
            points.append({"chrom": chrom, "start": s, "end": e, "value": val})
            if len(points) >= limit:
                break
    return points


def _to_float(x: str) -> Optional[float]:
    try:
        return float(x)
    except ValueError:
        return None
