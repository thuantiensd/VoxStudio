"""GPU worker — background thread pick & run jobs từ queue tuần tự.

1 GPU = 1 worker. Khi có 2 GPU, start 2 worker với device_id khác nhau
(SQLite với `SELECT ... LIMIT 1 UPDATE` chạy tuần tự trong 1 connection
nên 2 worker cùng poll sẽ race — cần pick+mark running trong cùng 1 tx
có row-level lock. Hiện tại single-worker nên không race).

Progress callback: svc gọi worker.publish(job_id, step, progress) →
gpu_worker forward qua asyncio.Queue để SSE endpoint stream về client.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Callable, Awaitable, Any

from app.db.session import AsyncSessionLocal
from app.services import job_svc, usage_svc

logger = logging.getLogger(__name__)

# Dispatch table: kind → async handler(job, db, publish)
# Handler signature: async def handler(payload: dict, job_id: str, publish, db) -> dict
# publish(progress, step) — gọi để update realtime
_HANDLERS: dict[str, Callable[..., Awaitable[dict]]] = {}

# Event bus để SSE endpoint subscribe progress của 1 job
# {job_id: [(queue, loop), ...]} — lưu loop để cross-thread-safe put qua
# call_soon_threadsafe (publish từ worker thread → main loop).
_subscribers: dict[str, list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]] = {}
_subscribers_lock = threading.Lock()

# Thread control
_worker_thread: threading.Thread | None = None
_stop_event = threading.Event()
_loop: asyncio.AbstractEventLoop | None = None


def register_handler(kind: str, fn: Callable[..., Awaitable[dict]]):
    """Gọi từ module xử lý (vd dubbing_svc) để đăng ký handler cho kind của mình."""
    _HANDLERS[kind] = fn
    logger.info("[worker] registered handler: %s", kind)


def publish(job_id: str, *, progress: float | None = None,
             step: str | None = None, extra: dict | None = None):
    """Push event ra tất cả subscriber của job_id. Thread-safe."""
    payload = {"job_id": job_id, "type": "progress"}
    if progress is not None:
        payload["progress"] = progress
    if step is not None:
        payload["step"] = step
    if extra:
        payload.update(extra)
    with _subscribers_lock:
        subs = list(_subscribers.get(job_id, []))
    for q, loop in subs:
        try:
            # Cross-thread-safe: schedule put trên loop của consumer
            loop.call_soon_threadsafe(_safe_put, q, payload)
        except RuntimeError:
            # Loop đã đóng — consumer đã disconnect, bỏ qua
            pass


def _safe_put(q: asyncio.Queue, payload: dict):
    """Chạy trong consumer loop. Put nếu queue còn chỗ, drop nếu full."""
    try:
        q.put_nowait(payload)
    except asyncio.QueueFull:
        pass


def subscribe(job_id: str) -> asyncio.Queue:
    """SSE endpoint gọi khi client connect. Trả queue, consumer đọc bằng
    await queue.get(). Tự động bắt loop hiện tại để publish() thread-safe."""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    loop = asyncio.get_running_loop()
    with _subscribers_lock:
        _subscribers.setdefault(job_id, []).append((q, loop))
    return q


def unsubscribe(job_id: str, q: asyncio.Queue):
    with _subscribers_lock:
        if job_id in _subscribers:
            _subscribers[job_id] = [
                (qq, ll) for qq, ll in _subscribers[job_id] if qq is not q
            ]
            if not _subscribers[job_id]:
                del _subscribers[job_id]


async def _process_one(job_row) -> None:
    """Chạy 1 job. Commit success/error vào DB + emit events."""
    job_id = job_row.id
    kind = job_row.kind
    payload = json.loads(job_row.payload) if job_row.payload else {}

    handler = _HANDLERS.get(kind)
    if not handler:
        async with AsyncSessionLocal() as db:
            await job_svc.mark_error(db, job_id, f"No handler for kind={kind}")
        publish(job_id, step="error", extra={"error": f"No handler for {kind}"})
        return

    publish(job_id, step="started", progress=0)

    # Wrapper progress callback — worker thread → publish + optionally save DB
    async def _progress(progress=None, step=None):
        if progress is not None or step is not None:
            async with AsyncSessionLocal() as db:
                await job_svc.update_progress(db, job_id,
                                                progress=progress,
                                                current_step=step)
        publish(job_id, progress=progress, step=step)

    try:
        result = await handler(payload, job_id=job_id, progress_cb=_progress)
        # Auto-record usage nếu handler trả về 'usage' dict
        if result and isinstance(result, dict) and "usage" in result:
            u = result["usage"]
            async with AsyncSessionLocal() as db:
                await usage_svc.record(
                    db,
                    user_id=job_row.user_id,
                    feature=kind,
                    minutes=u.get("minutes", 0),
                    tokens=u.get("tokens", 0),
                    characters=u.get("characters", 0),
                    project_id=u.get("project_id"),
                )
        async with AsyncSessionLocal() as db:
            await job_svc.mark_done(db, job_id, result)
        publish(job_id, step="done", progress=100, extra={"result": result})
        logger.info("[worker] ✓ job %s (%s)", job_id, kind)
    except asyncio.CancelledError:
        async with AsyncSessionLocal() as db:
            await job_svc.mark_canceled(db, job_id)
        publish(job_id, step="canceled")
        logger.info("[worker] ✗ canceled %s", job_id)
        raise
    except Exception as e:
        async with AsyncSessionLocal() as db:
            await job_svc.mark_error(db, job_id, str(e))
        publish(job_id, step="error", extra={"error": str(e)})
        logger.exception("[worker] ✗ %s failed: %s", job_id, e)


async def _worker_loop():
    """Poll DB mỗi giây, pick + run."""
    logger.info("[worker] started")
    while not _stop_event.is_set():
        try:
            async with AsyncSessionLocal() as db:
                job = await job_svc.pick_next(db)
            if not job:
                await asyncio.sleep(1.0)
                continue
            logger.info("[worker] picked %s kind=%s user=%d",
                        job.id, job.kind, job.user_id)
            await _process_one(job)
        except Exception as e:
            logger.exception("[worker] loop error: %s", e)
            await asyncio.sleep(2.0)
    logger.info("[worker] stopped")


def _thread_main():
    """Entry của thread — spin event loop riêng."""
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    try:
        _loop.run_until_complete(_worker_loop())
    finally:
        _loop.close()
        _loop = None


def start_worker():
    """Gọi 1 lần ở FastAPI startup."""
    global _worker_thread
    if _worker_thread and _worker_thread.is_alive():
        return
    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=_thread_main, name="gpu-worker", daemon=True
    )
    _worker_thread.start()


def stop_worker(timeout: float = 5.0):
    """Gọi ở shutdown."""
    _stop_event.set()
    if _worker_thread:
        _worker_thread.join(timeout=timeout)


# ── Import handlers để register ───────────────────────────────
# Làm cuối file để tránh circular import
def _register_builtin_handlers():
    """Lazy import — chạy sau khi module load để chuyển control sang module
    đăng ký handler của họ."""
    try:
        from app.worker import handlers  # noqa: F401
    except Exception as e:
        logger.warning("[worker] handler registration skipped: %s", e)


_register_builtin_handlers()
