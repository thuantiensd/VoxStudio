"""Handlers cho mỗi job kind. Đăng ký vào gpu_worker dispatch table.

Wrap các pipeline hiện tại (dubbing_svc.auto_dub sync generator) thành
async handler theo signature worker expect:
    async def handler(payload: dict, job_id: str, progress_cb) -> dict
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from app.services import dubbing_svc
from app.worker.gpu_worker import register_handler

logger = logging.getLogger(__name__)


async def _run_sync_generator(gen_factory, progress_cb):
    """Chạy sync generator trong thread, bridge progress qua asyncio.Queue.

    progress_cb(progress, step) là async function do worker cung cấp.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()
    last_update: dict = {}

    def producer():
        try:
            for update in gen_factory():
                loop.call_soon_threadsafe(queue.put_nowait, update)
        except Exception as e:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"step": "error", "label": str(e), "_exception": e},
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

    threading.Thread(target=producer, daemon=True).start()

    while True:
        item = await queue.get()
        if item is SENTINEL:
            break
        if item.get("step") == "error" and item.get("_exception"):
            raise item["_exception"]
        last_update = item
        progress = item.get("progress")
        if progress is not None and progress < 0:
            progress = None  # -1 sentinel nghĩa là state change, không phải %
        await progress_cb(progress=progress, step=item.get("step") or item.get("label"))
    return last_update


# ── Dubbing handler ────────────────────────────────────────

async def dubbing_handler(payload: dict, *, job_id: str, progress_cb) -> dict:
    """Payload: { project_id, engine }"""
    project_id = payload.get("project_id")
    engine = payload.get("engine", "google")
    if not project_id:
        raise ValueError("Thiếu project_id")

    logger.info("[dubbing] start project=%s engine=%s", project_id, engine)

    def gen_factory():
        return dubbing_svc.auto_dub(project_id, engine=engine)

    last = await _run_sync_generator(gen_factory, progress_cb)

    # Ước tính thời lượng audio/video để tính usage (phút)
    minutes = 0.0
    try:
        from app.services.dubbing_svc import _load_project
        proj = _load_project(project_id)
        if proj and proj.get("duration"):
            minutes = float(proj["duration"]) / 60.0
    except Exception:
        pass

    return {
        "project_id": project_id,
        "engine": engine,
        "final_step": last.get("step") if last else None,
        "output_url": last.get("output_url") if last else None,
        "usage": {
            "minutes": minutes,
            "project_id": project_id,
        },
    }


register_handler("dubbing", dubbing_handler)
