"""Video dubbing API endpoints."""

import json
import logging

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dubbing_schemas import (
    ExportOptions, MergeRequest, SegmentUpdate, SplitRequest, SubtitleStyle,
)
import os

from app.auth.deps import get_current_user
from app.auth.rate_limit import require_quota
from app.db.models import User
from app.db.session import get_session
from app.services import dubbing_svc, edge_tts_svc, gemini_translate_svc, ingest_svc, job_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dubbing", tags=["Dubbing"])


# ── Projects ────────────────────────────────────────

@router.post("/projects")
async def create_project(
    video: UploadFile = File(...),
    target_language: str = Form(...),
    voice_id: str = Form(None),
    source_language: str = Form("auto"),
    enable_dubbing: bool = Form(True),
    enable_subtitle: bool = Form(False),
):
    """Upload video and create dubbing project."""
    try:
        data = await video.read()
        result = dubbing_svc.create_project(
            video_data=data,
            video_filename=video.filename,
            target_language=target_language,
            voice_id=voice_id,
            source_language=source_language,
            enable_dubbing=enable_dubbing,
            enable_subtitle=enable_subtitle,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects")
async def list_projects():
    return {"projects": dubbing_svc.list_projects()}


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    project = dubbing_svc.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    if dubbing_svc.delete_project(project_id):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Project not found")


@router.get("/projects/{project_id}/video")
async def stream_video(project_id: str):
    """Stream original video for preview."""
    path = dubbing_svc.get_video_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(str(path), media_type="video/mp4")


@router.get("/projects/{project_id}/thumbnail")
async def get_thumbnail(project_id: str):
    """Return pre-generated thumbnail (JPEG) for the project."""
    path = dubbing_svc.get_thumbnail_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(path), media_type="image/jpeg")


# ── Transcribe ──────────────────────────────────────

@router.post("/projects/{project_id}/transcribe")
async def transcribe(project_id: str):
    try:
        result = dubbing_svc.transcribe_project(project_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Project Settings ───────────────────────────────

@router.put("/projects/{project_id}/settings")
async def update_settings(project_id: str, body: dict):
    """Update project toggles (enable_dubbing, enable_subtitle, etc)."""
    try:
        result = dubbing_svc.update_project_settings(project_id, body)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/projects/{project_id}/subtitle-style")
async def update_subtitle_style(project_id: str, body: SubtitleStyle):
    """Update subtitle styling."""
    try:
        result = dubbing_svc.update_subtitle_style(project_id, body.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Subtitle Download ─────────────────────────────

@router.post("/projects/{project_id}/subtitles/generate")
async def generate_subtitles(project_id: str):
    """Generate SRT + ASS subtitle files."""
    try:
        dubbing_svc.generate_srt(project_id)
        dubbing_svc.generate_ass(project_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/subtitles/{fmt}")
async def download_subtitle(project_id: str, fmt: str):
    """Download subtitle file (srt or ass)."""
    if fmt not in ("srt", "ass"):
        raise HTTPException(status_code=400, detail="Format must be 'srt' or 'ass'")
    # Generate on the fly
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
async def translate_project(project_id: str, use_llm: bool = False, engine: str = "google"):
    """Auto-translate all segments to target language.

    Query params:
        use_llm: Use local LLM (Qwen) for emotion/pauses polish.
        engine: "google" or "gemini" (context-aware film translation).
    """
    try:
        result = dubbing_svc.translate_project(project_id, use_llm=use_llm, engine=engine)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Segments ────────────────────────────────────────

@router.put("/projects/{project_id}/segments/{seg_id}")
async def update_segment(project_id: str, seg_id: str, body: SegmentUpdate):
    try:
        result = dubbing_svc.update_segment(project_id, seg_id, body.model_dump(exclude_none=True))
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/projects/{project_id}/segments/{seg_id}")
async def delete_segment(project_id: str, seg_id: str):
    try:
        return dubbing_svc.delete_segment(project_id, seg_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/projects/{project_id}/segments/{seg_id}/split")
async def split_segment(project_id: str, seg_id: str, body: SplitRequest):
    try:
        return dubbing_svc.split_segment(project_id, seg_id, body.split_at)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/segments/merge")
async def merge_segments(project_id: str, body: MergeRequest):
    try:
        return dubbing_svc.merge_segments(project_id, body.segment_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Generate ────────────────────────────────────────

@router.post("/projects/{project_id}/segments/{seg_id}/generate")
async def generate_segment(project_id: str, seg_id: str):
    try:
        return dubbing_svc.generate_segment(project_id, seg_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/projects/{project_id}/segments/{seg_id}/audio")
async def get_segment_audio(project_id: str, seg_id: str):
    path = dubbing_svc.get_segment_audio_path(project_id, seg_id)
    if not path:
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(str(path), media_type="audio/wav")


@router.post("/projects/{project_id}/generate-all")
async def generate_all(project_id: str):
    """Generate TTS for all segments. Returns JSON with progress array."""
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
async def export_video(project_id: str, body: ExportOptions = None):
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
async def download_export(project_id: str):
    path = dubbing_svc.get_export_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Export not found")
    project = dubbing_svc.get_project(project_id)
    filename = project["video_filename"].rsplit(".", 1)[0] + "_dubbed.mp4" if project else "dubbed.mp4"
    return FileResponse(str(path), media_type="video/mp4", filename=filename)


@router.get("/projects/{project_id}/export/stream")
async def stream_export(project_id: str):
    """Stream video đã dub inline (KHÔNG force download) — dùng cho <video> tag."""
    path = dubbing_svc.get_export_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(str(path), media_type="video/mp4")


@router.get("/projects/{project_id}/dubbed-track")
async def get_dubbed_track(project_id: str):
    """Stream the continuous dubbed audio track."""
    path = dubbing_svc.get_dubbed_track_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Dubbed track not found")
    return FileResponse(str(path), media_type="audio/wav")


# ── Vocal Separation ──────────────────────────────

@router.post("/projects/{project_id}/separate-vocals")
async def separate_vocals(project_id: str):
    """Separate vocals from accompaniment (music/SFX) using Demucs."""
    try:
        result = dubbing_svc.separate_vocals(project_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/accompaniment")
async def get_accompaniment(project_id: str):
    """Stream the accompaniment (background music/SFX) track."""
    path = dubbing_svc.get_accompaniment_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Accompaniment not found. Run vocal separation first.")
    return FileResponse(str(path), media_type="audio/wav")


@router.get("/projects/{project_id}/vocals")
async def get_vocals(project_id: str):
    """Stream the extracted vocals track."""
    path = dubbing_svc.get_vocals_path(project_id)
    if not path:
        raise HTTPException(status_code=404, detail="Vocals not found. Run vocal separation first.")
    return FileResponse(str(path), media_type="audio/wav")


@router.get("/gemini-status")
async def gemini_status():
    """Check if Gemini API key is configured."""
    return {"available": gemini_translate_svc.is_available()}


@router.post("/gemini-key")
async def set_gemini_key(body: dict):
    """Save Gemini API key (runtime only — set env var for persistence)."""
    key = body.get("api_key", "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is required")
    os.environ["GEMINI_API_KEY"] = key
    # Update the config module's cached value
    import app.config as cfg
    cfg.GEMINI_API_KEY = key
    return {"status": "ok", "available": True}


# ── Auto-Dub Pipeline ─────────────────────────────

@router.post("/projects/{project_id}/auto-dub")
async def auto_dub(
    project_id: str,
    engine: str = "google",
    ctx: dict = Depends(require_quota("dubbing")),
):
    """Enqueue dubbing job vào GPU queue rồi stream SSE progress luôn
    trong cùng HTTP response — backward compat với FE cũ đang đọc SSE.

    Client POST → enqueue + subscribe worker → SSE format như cũ, có thêm
    event 'queued' với queue_position + eta_seconds ở đầu.
    """
    import asyncio
    from app.db.session import AsyncSessionLocal
    from app.worker import gpu_worker

    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]

    # Enqueue ngay — lấy job.id rồi subscribe worker publisher
    job = await job_svc.enqueue(
        db,
        user_id=user.id,
        kind="dubbing",
        payload={"project_id": project_id, "engine": engine},
    )
    job_id = job.id
    position = await job_svc.get_queue_position(db, job_id)
    eta = await job_svc.estimate_wait_seconds(db, job_id)

    async def event_generator():
        # 1. Initial queue position
        yield f"data: {json.dumps({'step': 'queued', 'job_id': job_id, 'queue_position': position, 'eta_seconds': eta, 'progress': 0})}\n\n"

        # 2. Subscribe to worker events
        q = gpu_worker.subscribe(job_id)

        async def emit_position_updates():
            """Trong lúc vẫn pending, đẩy queue_position update mỗi 3s."""
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

    from app.db.models import Job  # local import để tránh circular
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/projects/from-url")
async def create_project_from_url(
    url: str = Body(..., embed=True),
    target_language: str = Body("vietnamese", embed=True),
    source_language: str = Body("auto", embed=True),
    enable_dubbing: bool = Body(True, embed=True),
    enable_subtitle: bool = Body(False, embed=True),
):
    """Tạo project bằng cách tải video từ URL (TikTok / Douyin / YouTube / FB / IG
    / Bilibili / Twitter …) qua yt-dlp. Stream SSE progress về.

    Payload từng event:
      { step, label, progress, detail?, project_id? }
    Khi step == 'done' → payload có project_id, frontend navigate tới dubbing.
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
        while True:
            item = await queue.get()
            if item is SENTINEL:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/projects/{project_id}/cancel")
async def cancel_auto_dub(project_id: str):
    """Yêu cầu huỷ pipeline đang chạy cho project. Pipeline sẽ thoát sớm
    tại checkpoint gần nhất (giữa các bước, hoặc trong loop TTS)."""
    dubbing_svc.request_cancel(project_id)
    return {"ok": True, "project_id": project_id}


@router.get("/edge-voices")
async def list_edge_voices():
    """List available Edge TTS voices."""
    try:
        voices = await edge_tts_svc.list_voices()
        return {"voices": [
            {"name": v["ShortName"], "locale": v["Locale"], "gender": v["Gender"]}
            for v in voices
        ]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
