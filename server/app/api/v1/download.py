"""Router cho feature Tải video từ URL (TikTok/Douyin/YouTube/FB/IG/Bilibili)."""

import asyncio
import json
import logging
import threading
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rate_limit import require_download_quota
from app.db.models import User
from app.db.session import AsyncSessionLocal
from app.services import social_download_svc, usage_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/download", tags=["Download"])


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
            # Record usage 1 lần khi có project_id (download thành công)
            if not recorded["done"] and item.get("project_id"):
                recorded["done"] = True
                try:
                    async with AsyncSessionLocal() as db:
                        await usage_svc.record(
                            db, user_id=user.id, feature="download",
                            project_id=item.get("project_id"),
                        )
                except Exception as e:
                    logger.warning("record download usage failed: %s", e)
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
