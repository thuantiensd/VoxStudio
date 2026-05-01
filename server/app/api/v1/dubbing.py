"""Video dubbing API endpoints — DB-backed ownership + ownership checks.

Bảo mật:
  - Mọi endpoint cần auth (Depends get_current_user) trừ utility (edge-voices).
  - Mọi route có {project_id} đều require_owned() check ownership trước.
  - Admin được bypass (vẫn dùng đường require_owned, hàm tự allow).
  - Soft delete: DELETE chỉ mark deleted_at, file giữ 30 ngày trước khi
    cleanup task xoá hẳn — phòng user lỡ tay.
  - Audit log: các action mutating (create, delete, auto-dub) được ghi audit.

Cấu trúc:
  - dubbing_svc.py = pipeline (STT/translate/TTS/render) — không đổi.
  - dubbing_project_svc.py = DB ownership + lifecycle.
  - dubbing.py (file này) = HTTP layer, gate giữa client và service.
"""

import json
import logging
import os
import sys
import traceback

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dubbing_schemas import (
    ExportOptions, MergeRequest, SegmentUpdate, SplitRequest, SubtitleStyle,
)

from app.auth.deps import get_current_user
from app.auth.rate_limit import require_quota
from app.db.models import User
from app.db.session import get_session
from app.services import (
    dubbing_svc, edge_tts_svc, gemini_translate_svc, ingest_svc, job_svc,
    dubbing_project_svc, audit_svc,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dubbing", tags=["Dubbing"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request and request.client else None


# ── Projects ────────────────────────────────────────

@router.post("/projects")
async def create_project(
    request: Request,
    video: UploadFile = File(...),
    target_language: str = Form(...),
    voice_id: str = Form(None),
    source_language: str = Form("auto"),
    enable_dubbing: bool = Form(True),
    enable_subtitle: bool = Form(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Upload video và tạo project. Tạo cả filesystem files lẫn DB row."""
    try:
        data = await video.read()
        # 1. Tạo files + meta.json (project_id sinh trong service)
        project = dubbing_svc.create_project(
            video_data=data,
            video_filename=video.filename or "video.mp4",
            target_language=target_language,
            voice_id=voice_id,
            source_language=source_language,
            enable_dubbing=enable_dubbing,
            enable_subtitle=enable_subtitle,
        )
        # 2. Tạo DB row gắn ownership ngay sau khi files đã ghi
        try:
            await dubbing_project_svc.create(
                db,
                project_id=project["id"],
                user_id=user.id,
                title=video.filename or "",
                video_filename=video.filename or "",
                duration_sec=float(project.get("video_duration", 0.0)),
                file_size_bytes=len(data),
                source_language=source_language,
                target_language=target_language,
            )
        except Exception:
            # Rollback files nếu DB insert fail (tránh orphan files)
            logger.exception("DB insert failed for project %s — rolling back files", project["id"])
            try:
                dubbing_svc.delete_project(project["id"])
            except Exception:
                pass
            raise
        # 3. Audit log
        await audit_svc.log(
            db, user_id=user.id, action="dubbing.create_project",
            ip=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            metadata={
                "project_id": project["id"],
                "duration_sec": project.get("video_duration"),
                "size_bytes": len(data),
            },
        )
        return project
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("create_project failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects")
async def list_projects(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
    limit: int = 100,
    offset: int = 0,
):
    """List projects của user hiện tại (admin chỉ thấy của chính admin —
    muốn xem global thì dùng admin endpoint khác)."""
    rows = await dubbing_project_svc.list_for_user(
        db, user, limit=min(limit, 200), offset=max(offset, 0),
    )
    # Hydrate thêm meta filesystem (status, segments count) để UI render
    out = []
    for row in rows:
        meta = dubbing_svc.get_project(row.id) or {}
        out.append({
            "id": row.id,
            "title": row.title,
            "video_filename": row.video_filename,
            "duration_sec": row.duration_sec,
            "source_language": row.source_language,
            "target_language": row.target_language,
            "status": row.status,
            "created_at": row.created_at.isoformat(),
            # Trường từ meta filesystem (segments, settings, ...)
            "meta": meta,
        })
    return {"projects": out}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    project = dubbing_svc.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Soft delete: mark deleted_at trong DB, file giữ 30 ngày trước khi cleanup."""
    p = await dubbing_project_svc.require_owned(db, project_id, user)
    await dubbing_project_svc.soft_delete(db, p)
    await audit_svc.log(
        db, user_id=user.id, action="dubbing.delete_project",
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"project_id": project_id},
    )
    return {"ok": True}


@router.get("/projects/{project_id}/video")
async def stream_video(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Stream original video for preview."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_video_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(str(path), media_type="video/mp4")


@router.get("/projects/{project_id}/thumbnail")
async def get_thumbnail(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Return pre-generated thumbnail (JPEG) for the project."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_thumbnail_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(path), media_type="image/jpeg")


# ── Transcribe ──────────────────────────────────────

@router.post("/projects/{project_id}/transcribe")
async def transcribe(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        result = dubbing_svc.transcribe_project(project_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("transcribe failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Project Settings ───────────────────────────────

@router.put("/projects/{project_id}/settings")
async def update_settings(
    project_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Update project toggles (enable_dubbing, enable_subtitle, etc)."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.update_project_settings(project_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/projects/{project_id}/subtitle-style")
async def update_subtitle_style(
    project_id: str,
    body: SubtitleStyle,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Update subtitle styling."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.update_subtitle_style(project_id, body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Subtitle Download ─────────────────────────────

@router.post("/projects/{project_id}/subtitles/generate")
async def generate_subtitles(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Generate SRT + ASS subtitle files."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        dubbing_svc.generate_srt(project_id)
        dubbing_svc.generate_ass(project_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/subtitles/{fmt}")
async def download_subtitle(
    project_id: str,
    fmt: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Download subtitle file (srt or ass)."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    if fmt not in ("srt", "ass"):
        raise HTTPException(status_code=400, detail="Format must be 'srt' or 'ass'")
    try:
        if fmt == "srt":
            dubbing_svc.generate_srt(project_id)
        else:
            dubbing_svc.generate_ass(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    path = dubbing_svc.get_subtitle_path(project_id, fmt)
    if not path:
        raise HTTPException(status_code=404, detail="Subtitle not found")

    project = dubbing_svc.get_project(project_id)
    base = project["video_filename"].rsplit(".", 1)[0] if project else "subtitles"
    return FileResponse(str(path), media_type="text/plain", filename=f"{base}.{fmt}")


# ── Translate ──────────────────────────────────────

@router.post("/projects/{project_id}/translate")
async def translate_project(
    project_id: str,
    use_llm: bool = False,
    engine: str = "google",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Auto-translate all segments to target language."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.translate_project(project_id, use_llm=use_llm, engine=engine)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("translate failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Segments ────────────────────────────────────────

@router.put("/projects/{project_id}/segments/{seg_id}")
async def update_segment(
    project_id: str,
    seg_id: str,
    body: SegmentUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.update_segment(project_id, seg_id, body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/projects/{project_id}/segments/{seg_id}")
async def delete_segment(
    project_id: str,
    seg_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.delete_segment(project_id, seg_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/projects/{project_id}/segments/{seg_id}/split")
async def split_segment(
    project_id: str,
    seg_id: str,
    body: SplitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.split_segment(project_id, seg_id, body.split_at)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/segments/merge")
async def merge_segments(
    project_id: str,
    body: MergeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.merge_segments(project_id, body.segment_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Generate ────────────────────────────────────────

@router.post("/projects/{project_id}/segments/{seg_id}/generate")
async def generate_segment(
    project_id: str,
    seg_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.generate_segment(project_id, seg_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/segments/{seg_id}/audio")
async def get_segment_audio(
    project_id: str,
    seg_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_segment_audio_path(project_id, seg_id)
    if not path:
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(str(path), media_type="audio/wav")


@router.post("/projects/{project_id}/generate-all")
async def generate_all(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Generate TTS for all segments. Returns JSON with progress array."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        results = []
        for progress in dubbing_svc.generate_all(project_id):
            results.append(progress)
        project = dubbing_svc.get_project(project_id)
        return {"progress": results, "project": project}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Export ──────────────────────────────────────────

@router.post("/projects/{project_id}/export")
async def export_video(
    project_id: str,
    body: ExportOptions = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    if body is None:
        body = ExportOptions()
    try:
        dubbing_svc.export_video(
            project_id,
            keep_original_audio=body.keep_original_audio,
            original_audio_volume=body.original_audio_volume,
            enable_ducking=body.enable_ducking,
            duck_level=body.duck_level,
            duck_attack=body.duck_attack,
            duck_release=body.duck_release,
            use_pro_mix=body.use_pro_mix,
            target_lufs=body.target_lufs,
        )
        return {"ok": True, "download_url": f"/api/v1/dubbing/projects/{project_id}/export/download"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/export/download")
async def download_export(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_export_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Export not found")
    project = dubbing_svc.get_project(project_id)
    filename = project["video_filename"].rsplit(".", 1)[0] + "_dubbed.mp4" if project else "dubbed.mp4"
    return FileResponse(str(path), media_type="video/mp4", filename=filename)


@router.get("/projects/{project_id}/export/stream")
async def stream_export(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Stream video đã dub inline (KHÔNG force download) — dùng cho <video> tag."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_export_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(str(path), media_type="video/mp4")


@router.get("/projects/{project_id}/dubbed-track")
async def get_dubbed_track(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Stream the continuous dubbed audio track."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_dubbed_track_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Dubbed track not found")
    return FileResponse(str(path), media_type="audio/wav")


# ── Vocal Separation ──────────────────────────────

@router.post("/projects/{project_id}/separate-vocals")
async def separate_vocals(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Separate vocals from accompaniment (music/SFX) using Demucs."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    try:
        return dubbing_svc.separate_vocals(project_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("separate_vocals failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/accompaniment")
async def get_accompaniment(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Stream the accompaniment (background music/SFX) track."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_accompaniment_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Accompaniment not found. Run vocal separation first.")
    return FileResponse(str(path), media_type="audio/wav")


@router.get("/projects/{project_id}/vocals")
async def get_vocals(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Stream the extracted vocals track."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    path = dubbing_svc.get_vocals_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Vocals not found. Run vocal separation first.")
    return FileResponse(str(path), media_type="audio/wav")


# ── Gemini key (admin / user-level) ───────────────

@router.get("/gemini-status")
async def gemini_status(user: User = Depends(get_current_user)):
    """Check if Gemini API key is configured (server-side env)."""
    return {"available": gemini_translate_svc.is_available()}


@router.post("/gemini-key")
async def set_gemini_key(
    body: dict,
    user: User = Depends(get_current_user),
):
    """Save Gemini API key vào server env. Chỉ admin được set global key —
    user thường nên dùng BYOK qua per-request payload."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can set global Gemini key")
    key = (body.get("api_key") or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is required")
    os.environ["GEMINI_API_KEY"] = key
    import app.config as cfg
    cfg.GEMINI_API_KEY = key
    return {"status": "ok", "available": True}


# ── Auto-Dub Pipeline ─────────────────────────────

class AutoDubRequest(BaseModel):
    engine: str | None = "google"
    translate_api_key: str | None = None


@router.post("/projects/{project_id}/auto-dub")
async def auto_dub(
    project_id: str,
    request: Request,
    engine: str = "google",
    ctx: dict = Depends(require_quota("dubbing")),
):
    """Enqueue dubbing job vào GPU queue rồi stream SSE progress.

    require_quota đã verify user + plan. Tiếp tục check ownership project.
    """
    import asyncio
    from app.db.session import AsyncSessionLocal
    from app.worker import gpu_worker

    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]

    # Ownership check — user phải là chủ project mới được dub
    await dubbing_project_svc.require_owned(db, project_id, user)

    translate_api_key: str | None = None
    try:
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()
            engine = body.get("engine") or engine
            translate_api_key = body.get("translate_api_key") or None
    except Exception:
        pass

    job = await job_svc.enqueue(
        db,
        user_id=user.id,
        kind="dubbing",
        payload={
            "project_id": project_id,
            "engine": engine,
            "translate_api_key": translate_api_key,
        },
    )
    job_id = job.id
    position = await job_svc.get_queue_position(db, job_id)
    eta = await job_svc.estimate_wait_seconds(db, job_id)

    # Audit log
    await audit_svc.log(
        db, user_id=user.id, action="dubbing.auto_dub_start",
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"project_id": project_id, "engine": engine, "job_id": job_id},
    )

    async def event_generator():
        yield f"data: {json.dumps({'step': 'queued', 'job_id': job_id, 'queue_position': position, 'eta_seconds': eta, 'progress': 0})}\n\n"
        q = gpu_worker.subscribe(job_id)

        async def emit_position_updates():
            try:
                while True:
                    await asyncio.sleep(3.0)
                    async with AsyncSessionLocal() as db2:
                        j = await db2.get(Job, job_id)
                        if not j or j.status != "pending":
                            return
                        pos = await job_svc.get_queue_position(db2, job_id)
                        e = await job_svc.estimate_wait_seconds(db2, job_id)
                    await q.put({
                        "step": "queued", "job_id": job_id,
                        "queue_position": pos, "eta_seconds": e,
                        "progress": 0,
                    })
            except asyncio.CancelledError:
                return

        pos_task = asyncio.create_task(emit_position_updates())
        try:
            while True:
                event = await q.get()
                yield f"data: {json.dumps(event)}\n\n"
                step = event.get("step")
                if step in ("done", "error", "canceled"):
                    break
        finally:
            pos_task.cancel()
            gpu_worker.unsubscribe(job_id, q)

    from app.db.models import Job  # local import tránh circular
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/projects/from-url")
async def create_project_from_url(
    request: Request,
    url: str = Body(..., embed=True),
    target_language: str = Body("vietnamese", embed=True),
    source_language: str = Body("auto", embed=True),
    enable_dubbing: bool = Body(True, embed=True),
    enable_subtitle: bool = Body(False, embed=True),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Tạo project bằng cách tải video từ URL qua yt-dlp. Stream SSE progress.

    Khi step == 'done' và có project_id → tạo DB row gắn ownership cho user.
    """
    import asyncio
    import threading

    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        def producer():
            try:
                for update in ingest_svc.ingest_url_generator(
                    url,
                    target_language=target_language,
                    source_language=source_language,
                    enable_dubbing=enable_dubbing,
                    enable_subtitle=enable_subtitle,
                ):
                    loop.call_soon_threadsafe(queue.put_nowait, update)
            except Exception as e:
                loop.call_soon_threadsafe(queue.put_nowait,
                    {"step": "error", "label": str(e), "progress": -1})
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

        threading.Thread(target=producer, daemon=True).start()

        last_project_id: str | None = None
        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            # Khi pipeline báo done với project_id → gắn ownership vào DB
            if item.get("step") == "done" and item.get("project_id"):
                last_project_id = item["project_id"]
                project_meta = dubbing_svc.get_project(last_project_id) or {}
                try:
                    await dubbing_project_svc.create(
                        db,
                        project_id=last_project_id,
                        user_id=user.id,
                        title=project_meta.get("video_filename") or "URL import",
                        video_filename=project_meta.get("video_filename") or "",
                        duration_sec=float(project_meta.get("video_duration", 0.0)),
                        source_language=source_language,
                        target_language=target_language,
                    )
                    await audit_svc.log(
                        db, user_id=user.id, action="dubbing.create_from_url",
                        ip=_client_ip(request),
                        user_agent=request.headers.get("user-agent"),
                        metadata={"project_id": last_project_id, "url": url[:120]},
                    )
                except Exception:
                    logger.exception("Failed to create DB row for url-imported project %s",
                                     last_project_id)
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/projects/{project_id}/cancel")
async def cancel_auto_dub(
    project_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Yêu cầu huỷ pipeline đang chạy cho project."""
    await dubbing_project_svc.require_owned(db, project_id, user)
    dubbing_svc.request_cancel(project_id)
    await audit_svc.log(
        db, user_id=user.id, action="dubbing.cancel",
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"project_id": project_id},
    )
    return {"ok": True, "project_id": project_id}


# ── Utility (no project_id, no sensitive data) ───

@router.get("/edge-voices")
async def list_edge_voices():
    """List Edge TTS voices — public, không có user data."""
    try:
        voices = await edge_tts_svc.list_voices()
        return {"voices": [
            {"name": v["ShortName"], "locale": v["Locale"], "gender": v["Gender"]}
            for v in voices
        ]}
    except Exception as e:
        logger.exception("list_edge_voices failed")
        raise HTTPException(status_code=500, detail=str(e))
