"""Job queue service — enqueue, pick next (fair scheduling), update progress.

Single-GPU design: 1 worker thread pick job từ DB, xử lý tuần tự.
Khi scale lên 2+ GPU, chỉ cần start thêm worker — cùng DB lock row "running"
nên không double-pick. Fair scheduling: user ít job chạy nhất được ưu tiên.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Job, User
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Priority theo plan (cao hơn = chạy trước)
PRIORITY_BY_PLAN = {
    "free":   0,
    "pro":    10,
    "studio": 20,
}


async def enqueue_and_wait(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    payload: dict[str, Any] | None = None,
    priority: int | None = None,
    timeout: float = 1800.0,  # 30 phút
) -> dict:
    """Enqueue + đợi kết quả (blocking). Dùng cho endpoint sync như
    /stt/transcribe, /tts/generate — frontend POST đợi response bình thường
    nhưng backend serialize qua GPU queue chống OOM.

    Raises ValueError nếu job fail hoặc timeout.
    """
    import asyncio as _asyncio
    from app.worker import gpu_worker

    job = await enqueue(db, user_id=user_id, kind=kind,
                          payload=payload, priority=priority)
    q = gpu_worker.subscribe(job.id)
    try:
        deadline = _asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - _asyncio.get_event_loop().time()
            if remaining <= 0:
                raise ValueError("Xử lý quá thời gian cho phép. Vui lòng thử lại.")
            try:
                event = await _asyncio.wait_for(q.get(), timeout=min(30, remaining))
            except _asyncio.TimeoutError:
                # Kiểm tra trạng thái job — nếu đã xong trong DB thì thoát
                async with __import__("app.db.session", fromlist=["AsyncSessionLocal"]).AsyncSessionLocal() as db2:
                    j = await db2.get(Job, job.id)
                    if j and j.status in ("done", "error", "canceled"):
                        if j.status == "done":
                            import json as _json
                            return _json.loads(j.result) if j.result else {}
                        raise ValueError(j.error or f"Xử lý thất bại ({j.status})")
                continue
            step = event.get("step")
            if step == "done":
                # Handler đôi khi gọi progress_cb(step="done") để báo finish nội
                # bộ, nhưng worker mới là người emit "done" cuối cùng có 'result'.
                # Bỏ qua done event không có result để tránh trả về {} sớm.
                result = event.get("result")
                if result:
                    return result
                continue
            if step == "error":
                raise ValueError(event.get("error") or "Xử lý thất bại.")
            if step == "canceled":
                raise ValueError("Tác vụ đã bị huỷ.")
    finally:
        gpu_worker.unsubscribe(job.id, q)


async def enqueue(
    db: AsyncSession,
    *,
    user_id: int,
    kind: str,
    payload: dict[str, Any] | None = None,
    priority: int | None = None,
) -> Job:
    """Tạo job mới status='pending'. Worker sẽ pick theo fair + priority."""
    # Nếu không chỉ định priority, lookup từ plan
    if priority is None:
        user = await db.get(User, user_id)
        priority = PRIORITY_BY_PLAN.get(user.plan if user else "free", 0)

    job = Job(
        id=str(uuid.uuid4()),
        user_id=user_id,
        kind=kind,
        status="pending",
        priority=priority,
        payload=json.dumps(payload, ensure_ascii=False) if payload else None,
        progress=0.0,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    logger.info("[job] enqueued %s user=%d kind=%s prio=%d",
                job.id, user_id, kind, priority)
    return job


async def pick_next(db: AsyncSession) -> Job | None:
    """Fair scheduling:
      1. Ưu tiên user đang có ít job running nhất
      2. Cùng running count → priority cao hơn trước
      3. Cùng priority → FIFO (created_at asc)

    Atomic: pick row pending → mark running (SQLite OK vì worker single-thread).
    Khi lên multi-worker, thêm row lock (SELECT … FOR UPDATE SKIP LOCKED).
    """
    # Subquery: running count per user
    running_count_subq = (
        select(Job.user_id, func.count(Job.id).label("rc"))
        .where(Job.status == "running")
        .group_by(Job.user_id)
        .subquery()
    )

    q = (
        select(Job, func.coalesce(running_count_subq.c.rc, 0).label("rc"))
        .outerjoin(running_count_subq, Job.user_id == running_count_subq.c.user_id)
        .where(Job.status == "pending")
        .order_by(
            func.coalesce(running_count_subq.c.rc, 0).asc(),
            Job.priority.desc(),
            Job.created_at.asc(),
        )
        .limit(1)
    )
    res = await db.execute(q)
    row = res.first()
    if not row:
        return None
    job: Job = row[0]

    # Mark running
    job.status = "running"
    job.started_at = datetime.utcnow()
    await db.commit()
    await db.refresh(job)
    return job


async def update_progress(
    db: AsyncSession,
    job_id: str,
    *,
    progress: float | None = None,
    current_step: str | None = None,
) -> None:
    """Update progress 0-100 + current step label (cho SSE hiển thị)."""
    patch: dict = {}
    if progress is not None:
        patch["progress"] = max(0.0, min(100.0, float(progress)))
    if current_step is not None:
        patch["current_step"] = current_step
    if not patch:
        return
    await db.execute(update(Job).where(Job.id == job_id).values(**patch))
    await db.commit()


async def mark_done(
    db: AsyncSession,
    job_id: str,
    result: dict[str, Any] | None = None,
) -> None:
    await db.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(
            status="done",
            progress=100.0,
            result=json.dumps(result, ensure_ascii=False) if result else None,
            finished_at=datetime.utcnow(),
        )
    )
    await db.commit()


async def mark_error(db: AsyncSession, job_id: str, error: str) -> None:
    await db.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(
            status="error",
            error=error[:1000] if error else None,
            finished_at=datetime.utcnow(),
        )
    )
    await db.commit()


async def mark_canceled(db: AsyncSession, job_id: str) -> None:
    await db.execute(
        update(Job)
        .where(Job.id == job_id, Job.status.in_(["pending", "running"]))
        .values(status="canceled", finished_at=datetime.utcnow())
    )
    await db.commit()


async def get_job(db: AsyncSession, job_id: str) -> Job | None:
    return await db.get(Job, job_id)


async def get_queue_position(db: AsyncSession, job_id: str) -> int:
    """Vị trí trong hàng đợi (1-based) nếu pending. Trả 0 nếu đang chạy/xong."""
    job = await db.get(Job, job_id)
    if not job or job.status != "pending":
        return 0
    # Count số job pending đứng trước (priority cao hơn hoặc FIFO khi bằng)
    q = (
        select(func.count(Job.id))
        .where(
            Job.status == "pending",
            # Ưu tiên hơn, hoặc cùng priority nhưng tạo trước
            (Job.priority > job.priority)
            | and_(Job.priority == job.priority, Job.created_at < job.created_at),
        )
    )
    res = await db.execute(q)
    ahead = int(res.scalar() or 0)
    return ahead + 1


async def estimate_wait_seconds(db: AsyncSession, job_id: str) -> int | None:
    """Ước tính thời gian đợi = (vị trí * avg duration của kind gần đây).
    Trả None nếu không đủ data."""
    job = await db.get(Job, job_id)
    if not job or job.status != "pending":
        return None
    pos = await get_queue_position(db, job_id)
    if pos <= 0:
        return 0
    # Average duration của 20 job kind này vừa xong
    since = datetime.utcnow() - timedelta(days=7)
    q = (
        select(Job.started_at, Job.finished_at)
        .where(
            Job.kind == job.kind,
            Job.status == "done",
            Job.finished_at.isnot(None),
            Job.started_at.isnot(None),
            Job.finished_at >= since,
        )
        .order_by(Job.finished_at.desc())
        .limit(20)
    )
    res = await db.execute(q)
    durs = [
        (fin - sta).total_seconds()
        for sta, fin in res.all()
        if sta and fin and (fin - sta).total_seconds() > 0
    ]
    if not durs:
        # Fallback: giả sử 3 phút cho dubbing, 30s cho stt/tts
        default = {"dubbing": 180, "stt": 30, "tts": 15, "clone": 60, "separate": 60}
        avg = default.get(job.kind, 60)
    else:
        avg = sum(durs) / len(durs)
    return int(pos * avg)
