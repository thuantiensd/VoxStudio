"""Router cho feature Tải video từ URL (TikTok/Douyin/YouTube/FB/IG/Bilibili)."""

import asyncio
import json
import logging
import threading

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.auth.rate_limit import require_download_quota
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
):
    """Lấy metadata + direct URL (không tải). Dùng cho preview card ở UI.

    engine: 'auto' | 'scraper' (Douyin_TikTok_Scraper) | 'ytdlp' (yt-dlp).
    Trả: { platform, title, author, thumbnail, duration, video_url,
            watermark_url, audio_url, source }
    """
    try:
        info = await social_download_svc.fetch_info(url, engine=engine)
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
