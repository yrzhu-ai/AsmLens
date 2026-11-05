"""FastAPI server for AsmLens projects."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .project import (
    list_problems,
    load_project,
    query_bed,
    query_bedgraph,
    read_chrom_sizes,
    track_path,
)


def web_dir() -> Path:
    # repo_root/web — package lives in server/asmlens
    return Path(__file__).resolve().parents[2] / "web"


def create_app(project_dir: Path) -> FastAPI:
    project_dir = Path(project_dir).resolve()
    app = FastAPI(title="AsmLens", version="0.1.0")
    state: Dict[str, Any] = {"project_dir": project_dir}

    def project() -> Dict[str, Any]:
        return load_project(state["project_dir"])

    @app.get("/api/health")
    def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/project")
    def get_project() -> Dict[str, Any]:
        p = project()
        sizes = read_chrom_sizes(Path(p["_root"]) / p["chrom_sizes"])
        return {
            "name": p.get("name"),
            "version": p.get("version"),
            "tracks": p.get("tracks", []),
            "defaults": p.get("defaults", {}),
            "chromosomes": [{"id": c, "length": n} for c, n in sizes.items()],
            "problem_count": len(list_problems(p)),
        }

    @app.get("/api/problems")
    def get_problems(
        chrom: Optional[str] = None,
        type: Optional[str] = Query(None, alias="type"),
        limit: int = 5000,
    ) -> List[Dict[str, Any]]:
        rows = list_problems(project())
        out = []
        for r in rows:
            if chrom and r.get("chrom") != chrom:
                continue
            if type and r.get("type") != type:
                continue
            out.append(r)
            if len(out) >= limit:
                break
        return out

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
        app.mount("/static", StaticFiles(directory=str(static)), name="static")

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(static / "index.html")

    return app
