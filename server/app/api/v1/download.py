"""Router cho feature Tải video từ URL (TikTok/Douyin/YouTube/FB/IG/Bilibili)."""

import asyncio
import json
import logging
import re
import threading
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.auth.audio_sig import sign as sign_url, verify as verify_sig
from app.auth.rate_limit import require_download_quota
from app.config import VIDEO_CACHE_DIR
from app.db.models import User
from app.db.session import AsyncSessionLocal
from app.services import audit_svc, dubbing_project_svc, dubbing_svc, social_download_svc, usage_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/download", tags=["Download"])


def _client_ip(request: Request) -> str | None:
    return request.client.host if request and request.client else None


@router.post("/info")
async def fetch_info(
    url: str = Body(..., embed=True),
    engine: str = Body("auto", embed=True),
    cookies_txt: Optional[str] = Body(None, embed=True),
):
    """Lấy metadata + direct URL (không tải). Dùng cho preview card ở UI.

    engine: 'auto' | 'scraper' (Douyin_TikTok_Scraper) | 'ytdlp' (yt-dlp).
    cookies_txt: Netscape cookie text user paste (bypass platform login).
    Trả: { platform, title, author, thumbnail, duration, video_url,
            watermark_url, audio_url, source }
    """
    try:
        info = await social_download_svc.fetch_info(
            url, engine=engine, cookies_txt=cookies_txt,
        )
        return info.to_dict()
    except Exception as e:
        logger.warning("fetch_info failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e)[:300])


@router.post("/to-project")
async def download_to_project(
    request: Request,
    url: str = Body(..., embed=True),
    target_language: str = Body("vietnamese", embed=True),
    source_language: str = Body("auto", embed=True),
    enable_dubbing: bool = Body(True, embed=True),
    enable_subtitle: bool = Body(False, embed=True),
    use_watermark: bool = Body(False, embed=True),
    engine: str = Body("auto", embed=True),
    max_height: int = Body(1080, embed=True),
    cookies_txt: Optional[str] = Body(None, embed=True),
    ctx: dict = Depends(require_download_quota()),
):
    """Tải URL về → tạo dubbing project luôn. SSE stream progress.

    Khi step=='done' payload có project_id để frontend navigate /studio/{id}.
    """
    user: User = ctx["user"]

    async def event_generator():
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()
        recorded = {"done": False}

        def producer():
            try:
                for update in social_download_svc.download_to_project_generator(
                    url,
                    target_language=target_language,
                    source_language=source_language,
                    enable_dubbing=enable_dubbing,
                    enable_subtitle=enable_subtitle,
                    use_watermark=use_watermark,
                    engine=engine,
                    max_height=max_height,
                    cookies_txt=cookies_txt,
                ):
                    loop.call_soon_threadsafe(q.put_nowait, update)
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait,
                    {"step": "error", "label": str(e)[:280], "progress": -1})
            finally:
                loop.call_soon_threadsafe(q.put_nowait, SENTINEL)

        threading.Thread(target=producer, daemon=True).start()
        while True:
            item = await q.get()
            if item is SENTINEL: break
            # Gắn ownership DB trước khi báo done cho client; nếu lỗi thì xoá
            # files vừa tải để tránh orphan project user không mở được.
            project_id = item.get("project_id")
            if not recorded["done"] and project_id:
                recorded["done"] = True
                try:
                    project_meta = dubbing_svc.get_project(project_id) or {}
                    filename = item.get("filename") or project_meta.get("video_filename") or "video.mp4"
                    title = item.get("title") or filename
                    duration = float(item.get("duration") or project_meta.get("video_duration") or 0.0)
                    video_path = dubbing_svc.get_video_path(project_id)
                    file_size = video_path.stat().st_size if video_path and video_path.exists() else 0
                    async with AsyncSessionLocal() as db:
                        existing = await dubbing_project_svc.get(db, project_id)
                        if existing is None:
                            await dubbing_project_svc.create(
                                db,
                                project_id=project_id,
                                user_id=user.id,
                                title=title,
                                video_filename=filename,
                                duration_sec=duration,
                                file_size_bytes=file_size,
                                source_language=source_language,
                                target_language=target_language,
                            )
                        await usage_svc.record(
                            db, user_id=user.id, feature="download",
                            project_id=project_id,
                        )
                        await audit_svc.log(
                            db, user_id=user.id, action="download.to_project",
                            ip=_client_ip(request),
                            user_agent=request.headers.get("user-agent"),
                            metadata={
                                "project_id": project_id,
                                "url": url[:120],
                                "platform": item.get("platform"),
                                "duration_sec": duration,
                            },
                        )
                except Exception as e:
                    logger.exception("download project ownership create failed: %s", e)
                    try:
                        dubbing_svc.delete_project(project_id)
                    except Exception:
                        pass
                    item = {
                        "step": "error",
                        "progress": -1,
                        "label": "Không lưu được dự án sau khi tải video. Vui lòng thử lại.",
                    }
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/to-file")
async def download_to_file(
    request: Request,
    url: str = Body(..., embed=True),
    engine: str = Body("auto", embed=True),
    max_height: int = Body(1080, embed=True),
    use_watermark: bool = Body(False, embed=True),
    cookies_txt: Optional[str] = Body(None, embed=True),
    ctx: dict = Depends(require_download_quota()),
):
    """Tải URL về cache server → SSE progress → final event chứa signed URL
    /download/file/{id} để browser GET stream MP4 về máy user.

    Flow:
      1. SSE bắn progress (resolving → meta → downloading → processing → done).
      2. Khi step='done', payload có {file_url, filename, ...}.
      3. Frontend dùng <a href={file_url} download={filename}> hoặc fetch().

    Cache file có TTL ~2h, cleanup tự động (xem cleanup_video_cache).
    """
    user: User = ctx["user"]

    async def event_generator():
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        SENTINEL = object()

        def producer():
            try:
                for update in social_download_svc.download_video_only_generator(
                    url,
                    engine=engine,
                    max_height=max_height,
                    use_watermark=use_watermark,
                    cookies_txt=cookies_txt,
                ):
                    loop.call_soon_threadsafe(q.put_nowait, update)
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait,
                    {"step": "error", "label": str(e)[:280], "progress": -1})
            finally:
                loop.call_soon_threadsafe(q.put_nowait, SENTINEL)

        threading.Thread(target=producer, daemon=True).start()
        recorded = False
        while True:
            item = await q.get()
            if item is SENTINEL: break
            # Khi worker bắn step='done', gắn signed URL + ghi audit ownership
            if not recorded and item.get("step") == "done" and item.get("file_id"):
                recorded = True
                file_id = item["file_id"]
                params = sign_url(file_id, user.id, ttl_seconds=3600)
                qs = "&".join(f"{k}={v}" for k, v in params.items())
                item["file_url"] = f"/api/v1/download/file/{file_id}?{qs}"
                try:
                    async with AsyncSessionLocal() as db:
                        await usage_svc.record(
                            db, user_id=user.id, feature="download",
                        )
                        await audit_svc.log(
                            db, user_id=user.id, action="download.to_file",
                            ip=_client_ip(request),
                            user_agent=request.headers.get("user-agent"),
                            metadata={
                                "file_id": file_id,
                                "url": url[:120],
                                "platform": item.get("platform"),
                                "size_bytes": item.get("size_bytes"),
                                "duration_sec": item.get("duration"),
                            },
                        )
                except Exception as e:
                    logger.warning("download.to_file usage log failed: %s", e)
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


_FILE_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")


@router.get("/file/{file_id}")
async def get_video_file(
    file_id: str,
    sig: Optional[str] = Query(None),
    u: Optional[str] = Query(None),
    exp: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
):
    """Stream MP4 đã tải về cache với HMAC sig auth (giống /tts/audio/...).

    Auth qua signed URL vì <a download> không gắn được Bearer header.
    File_id phải là hex string (path traversal protection).
    """
    if not _FILE_ID_RE.match(file_id):
        raise HTTPException(status_code=400, detail="Invalid file_id")
    if not sig or not u or not exp:
        raise HTTPException(status_code=403, detail="Missing signature")
    try:
        u_int = int(u)
    except (ValueError, TypeError):
        raise HTTPException(status_code=403, detail="Invalid signature")
    verify_sig(file_id, user_id_request=u_int, sig=sig, u=u, exp=exp)

    path = VIDEO_CACHE_DIR / f"{file_id}.mp4"
    if not path.exists():
        raise HTTPException(
            status_code=410,
            detail="File đã hết hạn cache, vui lòng tải lại.",
        )

    safe_name = (name or f"{file_id}.mp4").strip()
    safe_name = re.sub(r"[^\w\s.\-]", "_", safe_name)[:120] or f"{file_id}.mp4"

    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=safe_name,
    )
