"""Jobs API — query status + SSE stream progress + cancel.

Thống nhất cho mọi kind (dubbing / stt / tts / clone). FE subscribe
qua /jobs/{id}/stream → nhận event_stream từ worker publisher.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.models import User, Job
from app.db.session import AsyncSessionLocal, get_session
from app.services import job_svc
from app.worker import gpu_worker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["Jobs"])


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job không tồn tại")
    if job.user_id != user.id and user.role != "admin":
        raise HTTPException(403, "Không có quyền xem")
    position = await job_svc.get_queue_position(db, job_id) if job.status == "pending" else 0
    eta = await job_svc.estimate_wait_seconds(db, job_id) if position > 0 else None
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "current_step": job.current_step,
        "queue_position": position,
        "eta_seconds": eta,
        "result": json.loads(job.result) if job.result else None,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@router.get("/{job_id}/stream")
async def stream_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """SSE stream progress realtime. Format mỗi event:
      {job_id, type, progress?, step?, result?, error?}
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job không tồn tại")
    if job.user_id != user.id and user.role != "admin":
        raise HTTPException(403, "Không có quyền xem")

    async def event_gen():
        # 1. Emit initial snapshot
        position = (await job_svc.get_queue_position(db, job_id)) if job.status == "pending" else 0
        eta = (await job_svc.estimate_wait_seconds(db, job_id)) if position > 0 else None
        snap = {
            "type": "snapshot",
            "job_id": job_id,
            "status": job.status,
            "progress": job.progress,
            "current_step": job.current_step,
            "queue_position": position,
            "eta_seconds": eta,
        }
        if job.status in ("done", "error", "canceled"):
            snap["result"] = json.loads(job.result) if job.result else None
            snap["error"] = job.error
            yield f"data: {json.dumps(snap)}\n\n"
            return
        yield f"data: {json.dumps(snap)}\n\n"

        # 2. Subscribe to worker publisher
        q = gpu_worker.subscribe(job_id)
        position_task = None

        async def position_updater():
            try:
                while True:
                    await asyncio.sleep(3.0)
                    async with AsyncSessionLocal() as db2:
                        j2 = await db2.get(Job, job_id)
                        if not j2 or j2.status != "pending":
                            return
                        pos = await job_svc.get_queue_position(db2, job_id)
                        eta = await job_svc.estimate_wait_seconds(db2, job_id)
                    await q.put({
                        "type": "queue_update",
                        "job_id": job_id,
                        "queue_position": pos,
                        "eta_seconds": eta,
                    })
            except asyncio.CancelledError:
                return

        try:
            if job.status == "pending":
                position_task = asyncio.create_task(position_updater())

            while True:
                event = await q.get()
                yield f"data: {json.dumps(event)}\n\n"
                step = event.get("step")
                if step in ("done", "error", "canceled"):
                    break
        finally:
            if position_task:
                position_task.cancel()
            gpu_worker.unsubscribe(job_id, q)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job không tồn tại")
    if job.user_id != user.id and user.role != "admin":
        raise HTTPException(403, "Không có quyền")
    if job.status not in ("pending", "running"):
        return {"status": job.status, "message": "Đã xong hoặc đã huỷ"}
    await job_svc.mark_canceled(db, job_id)
    gpu_worker.publish(job_id, step="canceled")
    return {"status": "canceled"}


@router.get("")
async def list_my_jobs(
    limit: int = 20,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List job của user đang login (desc theo created_at)."""
    from sqlalchemy import select
    q = (
        select(Job)
        .where(Job.user_id == user.id)
        .order_by(Job.created_at.desc())
        .limit(min(limit, 100))
    )
    res = await db.execute(q)
    items = []
    for j in res.scalars().all():
        items.append({
            "id": j.id,
            "kind": j.kind,
            "status": j.status,
            "progress": j.progress,
            "current_step": j.current_step,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            "error": j.error,
        })
    return {"jobs": items}
