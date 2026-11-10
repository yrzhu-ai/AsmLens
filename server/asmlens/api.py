"""FastAPI server for AsmLens projects."""

from __future__ import annotations

import csv
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import APP_NAME, APP_NAME_ZH, GITHUB_REPO, UPDATE_CHECK_URL, __version__
from .project import (
    count_problems,
    list_problems,
    load_project,
    query_bed,
    query_bedgraph,
    read_chrom_sizes,
    resolve_problem_types,
    track_path,
)


def web_dir() -> Path:
    """Locate web assets (repo checkout or PyInstaller freeze)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        cand = Path(sys._MEIPASS) / "web"
        if cand.is_dir():
            return cand
    # repo_root/web — package lives in server/asmlens
    return Path(__file__).resolve().parents[2] / "web"


def _parse_tag(tag: str) -> str:
    return str(tag or "").lstrip("vV").strip()


def _version_tuple(v: str) -> tuple:
    parts = []
    for chunk in _parse_tag(v).split("."):
        num = ""
        for ch in chunk:
            if ch.isdigit():
                num += ch
            else:
                break
        parts.append(int(num) if num else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def create_app(project_dir: Path) -> FastAPI:
    project_dir = Path(project_dir).resolve()
    app = FastAPI(title=APP_NAME, version=__version__)
    state: Dict[str, Any] = {"project_dir": project_dir}

    def project() -> Dict[str, Any]:
        return load_project(state["project_dir"])

    @app.get("/api/health")
    def health() -> Dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/version")
    def get_version() -> Dict[str, Any]:
        return {
            "name": APP_NAME,
            "name_zh": APP_NAME_ZH,
            "version": __version__,
            "github": f"https://github.com/{GITHUB_REPO}",
            "meaning": (
                "AsmLens = Assembly Lens（组装透镜）："
                "像透镜一样聚焦查看基因组组装的问题区间（覆盖度/归因/CRAQ/QV），"
                "而不是整条基因组浏览器。"
            ),
        }

    @app.get("/api/updates/check")
    def check_updates() -> Dict[str, Any]:
        """Compare local version with GitHub latest release."""
        import json as _json
        import urllib.error
        import urllib.request

        out: Dict[str, Any] = {
            "current": __version__,
            "latest": None,
            "update_available": False,
            "html_url": None,
            "download_url": None,
            "name": None,
            "body": None,
            "error": None,
        }
        try:
            req = urllib.request.Request(
                UPDATE_CHECK_URL,
                headers={"Accept": "application/vnd.github+json", "User-Agent": f"AsmLens/{__version__}"},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = _json.loads(resp.read().decode("utf-8"))
            latest = _parse_tag(data.get("tag_name") or "")
            out["latest"] = latest or None
            out["html_url"] = data.get("html_url")
            out["name"] = data.get("name")
            out["body"] = (data.get("body") or "")[:2000]
            assets = data.get("assets") or []
            # Prefer Windows zip/exe asset if present
            for asset in assets:
                name = str(asset.get("name") or "").lower()
                if name.endswith(".zip") or name.endswith(".exe"):
                    out["download_url"] = asset.get("browser_download_url")
                    break
            if not out["download_url"] and out["html_url"]:
                out["download_url"] = out["html_url"]
            if latest:
                out["update_available"] = _version_tuple(latest) > _version_tuple(__version__)
        except urllib.error.HTTPError as exc:
            out["error"] = f"GitHub HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001
            out["error"] = str(exc)
        return out

    @app.get("/api/project")
    def get_project() -> Dict[str, Any]:
        p = project()
        root = Path(p["_root"])
        sizes = read_chrom_sizes(root / p["chrom_sizes"])
        from .project import parse_fai, write_chrom_sizes

        ref_sizes: Dict[str, int] = {}
        ref_rel = p.get("ref_chrom_sizes")
        if ref_rel:
            ref_path = root / ref_rel
            if ref_path.is_file():
                ref_sizes = read_chrom_sizes(ref_path)
        if not ref_sizes and (root / "ref.chrom.sizes").is_file():
            ref_sizes = read_chrom_sizes(root / "ref.chrom.sizes")
        if not ref_sizes and (root / "ref.fa.fai").is_file():
            ref_sizes = parse_fai(root / "ref.fa.fai")
            # backfill missing ref.chrom.sizes so desktop/bundles keep reference
            try:
                write_chrom_sizes(root / "ref.chrom.sizes", ref_sizes)
                if not p.get("ref_chrom_sizes"):
                    p["ref_chrom_sizes"] = "ref.chrom.sizes"
                    from .project import save_project
                    save_project(root, {k: v for k, v in p.items() if not str(k).startswith("_")})
            except OSError:
                pass
        tracks = p.get("tracks", []) or []
        has_ref_track = any(
            (t.get("genome") == "ref")
            or str(t.get("kind") or "").endswith("_R")
            or str(t.get("id") or "").startswith("ref_")
            or "ref_" in str(t.get("id") or "")
            for t in tracks
        )
        return {
            "name": p.get("name"),
            "version": p.get("version"),
            "app_version": __version__,
            "empty": bool(p.get("empty")) or len(sizes) == 0,
            "tracks": tracks,
            "tables": p.get("tables", {}),
            "defaults": p.get("defaults", {}),
            "summary": p.get("summary", {}),
            "chromosomes": [{"id": c, "length": n} for c, n in sizes.items()],
            "ref_chromosomes": [{"id": c, "length": n} for c, n in ref_sizes.items()],
            "has_ref": len(ref_sizes) > 0 or has_ref_track,
            "problem_count": count_problems(p),
        }

    @app.get("/api/problems")
    def get_problems(
        chrom: Optional[str] = None,
        chroms: Optional[str] = None,
        type: Optional[str] = Query(None, alias="type"),
        types: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        """Fetch problems with optional chrom / type / category filters (streamed)."""
        chrom_set = None
        if chroms:
            chrom_set = {c.strip() for c in chroms.split(",") if c.strip()}
        elif chrom:
            chrom_set = {chrom}
        type_set = resolve_problem_types(type, types, category)
        return list_problems(
            project(),
            chroms=chrom_set,
            types=type_set,
            limit=max(1, min(limit, 100000)),
        )

    @app.get("/api/tables/{table_name}")
    def get_table(
        table_name: str,
        chrom: Optional[str] = None,
        chroms: Optional[str] = None,
        limit: int = 100000,
    ) -> List[Dict[str, Any]]:
        """Read a project TSV table (e.g. query_lowcov_map_to_ref)."""
        p = project()
        tables = p.get("tables") or {}
        rel = tables.get(table_name)
        if not rel:
            # allow direct filename under project root
            cand = Path(p["_root"]) / f"{table_name}.tsv"
            if not cand.is_file():
                raise HTTPException(404, f"Unknown table {table_name}")
            path = cand
        else:
            path = Path(p["_root"]) / rel
        if not path.is_file():
            raise HTTPException(404, f"Missing table file {path.name}")
        chrom_set = None
        if chroms:
            chrom_set = {c.strip() for c in chroms.split(",") if c.strip()}
        elif chrom:
            chrom_set = {chrom}
        rows: List[Dict[str, Any]] = []
        with path.open(encoding="utf-8") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            for row in reader:
                if chrom_set and row.get("chrom") not in chrom_set:
                    continue
                for key in ("start", "end", "length", "mapped_bp", "other_lowcov_bp",
                            "primary_other_start", "primary_other_end"):
                    if key in row and row[key] not in (None, ""):
                        try:
                            row[key] = int(float(row[key]))
                        except ValueError:
                            pass
                for key in ("mapped_frac", "primary_identity"):
                    if key in row and row[key] not in (None, ""):
                        try:
                            row[key] = float(row[key])
                        except ValueError:
                            pass
                if "mapped" in row:
                    row["mapped"] = str(row["mapped"]).lower() in ("1", "true", "yes")
                rows.append(row)
                if len(rows) >= limit:
                    break
        return rows

    @app.get("/api/summary")
    def get_summary() -> Dict[str, Any]:
        p = project()
        root = Path(p["_root"])
        if p.get("summary"):
            return p["summary"]
        sp = root / "summary.json"
        if sp.is_file():
            return json.loads(sp.read_text(encoding="utf-8"))
        return {}

    @app.post("/api/open_bundle")
    async def open_bundle(file: UploadFile = File(...)) -> Dict[str, Any]:
        """Load a delivery zip chosen from the UI after the window is open."""
        name = file.filename or "bundle.zip"
        if not name.lower().endswith(".zip"):
            raise HTTPException(400, "请选择 asmlens_bundle_*.zip 交付包")
        tmp_root = Path(tempfile.mkdtemp(prefix="asmlens_upload_"))
        zip_path = tmp_root / name
        data = await file.read()
        zip_path.write_bytes(data)
        extract_dir = tmp_root / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(extract_dir)
        except zipfile.BadZipFile as exc:
            raise HTTPException(400, f"无效的 zip：{exc}") from exc
        found = list(extract_dir.rglob("project.json"))
        if not found:
            raise HTTPException(400, "压缩包内未找到 project.json")
        state["project_dir"] = found[0].parent.resolve()
        p = project()
        return {
            "ok": True,
            "name": p.get("name"),
            "path": str(state["project_dir"]),
            "problem_count": count_problems(p),
        }

    @app.get("/api/tracks/{track_id}")
    def get_track(
        track_id: str,
        chrom: str,
        start: int = Query(0, ge=0),
        end: int = Query(..., gt=0),
        limit: int = 50000,
    ) -> Dict[str, Any]:
        p = project()
        try:
            path = track_path(p, track_id)
        except KeyError:
            raise HTTPException(404, f"Unknown track {track_id}")
        meta = next(t for t in p["tracks"] if t["id"] == track_id)
        if end <= start:
            raise HTTPException(400, "end must be > start")
        if meta.get("type") == "bedgraph":
            feats = query_bedgraph(path, chrom, start, end, limit=limit)
        else:
            feats = query_bed(path, chrom=chrom, start=start, end=end, limit=limit)
        return {"track": meta, "features": feats}

    static = web_dir()
    if static.is_dir():
        # 先注册 / 再 mount /static，避免冻结环境下首页异常
        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(
                static / "index.html",
                media_type="text/html; charset=utf-8",
            )

        app.mount("/static", StaticFiles(directory=str(static)), name="static")
    else:
        @app.get("/")
        def index_missing() -> Dict[str, str]:
            return {"error": f"web assets missing: {static}"}

    return app
