"""Admin API — require role=admin.

Endpoints cho admin web quản lý user + job + flag + audit + health.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_admin
from app.db.models import (
    AuditLog, FeatureFlag, Job, Plan, UsageEvent, User,
)
from app.db.session import get_session
from app.services import audit_svc, job_svc, plan_svc, usage_svc, billing_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Dashboard stats ────────────────────────────────────────

@router.get("/stats")
async def stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    now = datetime.utcnow()
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    banned_users = (await db.execute(
        select(func.count(User.id)).where(User.is_banned == True)  # noqa: E712
    )).scalar() or 0
    dau = (await db.execute(
        select(func.count(User.id)).where(User.last_active_at >= day_ago)
    )).scalar() or 0
    wau = (await db.execute(
        select(func.count(User.id)).where(User.last_active_at >= week_ago)
    )).scalar() or 0
    mau = (await db.execute(
        select(func.count(User.id)).where(User.last_active_at >= month_ago)
    )).scalar() or 0
    new_today = (await db.execute(
        select(func.count(User.id)).where(User.created_at >= day_ago)
    )).scalar() or 0

    # Jobs
    jobs_today = (await db.execute(
        select(func.count(Job.id)).where(Job.created_at >= day_ago)
    )).scalar() or 0
    jobs_running = (await db.execute(
        select(func.count(Job.id)).where(Job.status == "running")
    )).scalar() or 0
    jobs_pending = (await db.execute(
        select(func.count(Job.id)).where(Job.status == "pending")
    )).scalar() or 0
    jobs_error_24h = (await db.execute(
        select(func.count(Job.id))
        .where(Job.status == "error", Job.created_at >= day_ago)
    )).scalar() or 0

    # Plan breakdown
    plan_rows = await db.execute(
        select(User.plan, func.count(User.id)).group_by(User.plan)
    )
    plan_breakdown = {plan: count for plan, count in plan_rows.all()}

    return {
        "users": {
            "total": total_users,
            "banned": banned_users,
            "new_today": new_today,
            "dau": dau, "wau": wau, "mau": mau,
            "by_plan": plan_breakdown,
        },
        "jobs": {
            "today": jobs_today,
            "running": jobs_running,
            "pending": jobs_pending,
            "errors_24h": jobs_error_24h,
        },
        "server_time": now.isoformat(),
    }


@router.get("/health")
async def admin_health(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Chi tiết hơn /health public: DB ping + Worker alive + VRAM."""
    from app.core.gpu_manager import gpu
    try:
        vram = gpu.vram_stats()
    except Exception as e:
        vram = {"error": str(e)}

    # DB ping
    try:
        await db.execute(select(1))
        db_ok = True
    except Exception:
        db_ok = False

    from app.worker import gpu_worker
    worker_alive = (
        gpu_worker._worker_thread is not None
        and gpu_worker._worker_thread.is_alive()
    )

    return {
        "db": db_ok,
        "gpu_ready": getattr(gpu, "ready", False),
        "worker_alive": worker_alive,
        "vram": vram,
    }


# ── Users ──────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    q: str = Query("", description="Search email/name"),
    plan: str = Query("", description="Filter theo plan"),
    banned: str = Query("", description="'only' | 'hide' | '' (all)"),
    sort: str = Query("created_desc", description="created_desc|created_asc|active_desc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=200),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    query = select(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(User.email.ilike(like), User.name.ilike(like)))
    if plan:
        query = query.where(User.plan == plan)
    if banned == "only":
        query = query.where(User.is_banned == True)  # noqa: E712
    elif banned == "hide":
        query = query.where(User.is_banned == False)  # noqa: E712

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    sort_map = {
        "created_desc": User.created_at.desc(),
        "created_asc":  User.created_at.asc(),
        "active_desc":  User.last_active_at.desc().nulls_last(),
    }
    query = query.order_by(sort_map.get(sort, User.created_at.desc()))
    query = query.limit(per_page).offset((page - 1) * per_page)
    rows = (await db.execute(query)).scalars().all()

    return {
        "users": [u.public_dict() for u in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")
    usage = await usage_svc.get_month_summary(db, user_id)
    # Audit recent
    audits = (await db.execute(
        select(AuditLog).where(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc()).limit(20)
    )).scalars().all()
    # Jobs recent
    jobs = (await db.execute(
        select(Job).where(Job.user_id == user_id)
        .order_by(Job.created_at.desc()).limit(20)
    )).scalars().all()
    # Payments của user
    from app.db.models import Payment
    payments = (await db.execute(
        select(Payment).where(Payment.user_id == user_id)
        .order_by(Payment.created_at.desc()).limit(50)
    )).scalars().all()
    total_spent_vnd = sum(
        (p.amount_vnd or 0) for p in payments if p.status == "paid"
    )
    return {
        "user": user.public_dict(),
        "usage_month": usage,
        "total_spent_vnd": total_spent_vnd,
        "payments": [
            {
                "ref_code": p.id, "plan_id": p.plan_id,
                "amount_vnd": p.amount_vnd, "amount_usd": p.amount_usd,
                "is_ltd": bool(p.is_ltd), "status": p.status,
                "note": p.note,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            } for p in payments
        ],
        "audit_recent": [
            {
                "id": a.id, "action": a.action,
                "target_type": a.target_type, "target_id": a.target_id,
                "metadata": json.loads(a.metadata_json) if a.metadata_json else None,
                "ip": a.ip, "created_at": a.created_at.isoformat(),
            } for a in audits
        ],
        "jobs_recent": [
            {
                "id": j.id, "kind": j.kind, "status": j.status,
                "progress": j.progress,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
                "error": j.error,
            } for j in jobs
        ],
    }


class UpdateUserRequest(BaseModel):
    plan: str | None = None
    is_banned: bool | None = None
    role: str | None = None


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")

    if user.id == admin.id:
        # Admin không thể tự ban/giáng role mình (tránh khoá chính tài khoản quản trị)
        if body.is_banned is True:
            raise HTTPException(400, "Không thể tự ban chính bạn")
        if body.role and body.role != "admin":
            raise HTTPException(400, "Không thể tự hạ role chính bạn")

    changes = {}
    if body.plan is not None and body.plan != user.plan:
        # Validate plan tồn tại
        p = await db.get(Plan, body.plan)
        if not p:
            raise HTTPException(400, f"Plan không tồn tại: {body.plan}")
        changes["plan"] = (user.plan, body.plan)
        user.plan = body.plan
    if body.is_banned is not None and body.is_banned != user.is_banned:
        changes["is_banned"] = (user.is_banned, body.is_banned)
        user.is_banned = body.is_banned
    if body.role is not None and body.role != user.role:
        if body.role not in ("user", "admin"):
            raise HTTPException(400, "Role không hợp lệ")
        changes["role"] = (user.role, body.role)
        user.role = body.role

    if changes:
        await db.commit()
        await db.refresh(user)
        await audit_svc.log(
            db, user_id=admin.id, action="admin_update_user",
            target_type="user", target_id=str(user_id),
            metadata={"changes": {k: {"from": v[0], "to": v[1]} for k, v in changes.items()}},
        )
    return {"user": user.public_dict()}


@router.delete("/users/{user_id}")
async def soft_delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Soft-delete: ban user (set is_banned=True). Data còn nguyên, có thể unban."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")
    if user.id == admin.id:
        raise HTTPException(400, "Không thể xoá chính bạn")
    user.is_banned = True
    await db.commit()
    await audit_svc.log(
        db, user_id=admin.id, action="admin_soft_delete_user",
        target_type="user", target_id=str(user_id),
    )
    return {"ok": True}


@router.delete("/users/{user_id}/purge")
async def purge_user(
    user_id: int,
    confirm: str = Query("", description='Phải = "DELETE" để xác nhận'),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Hard-delete: xoá vĩnh viễn user + cascade Payment/Voice/Job/UsageEvent
    + xoá voices folder. KHÔNG HOÀN TÁC ĐƯỢC.

    Frontend phải bắt admin gõ "DELETE" vào ô input để confirm.
    """
    if confirm != "DELETE":
        raise HTTPException(
            400,
            'Phải gửi tham số confirm="DELETE" để xác nhận xoá vĩnh viễn.',
        )
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")
    if user.id == admin.id:
        raise HTTPException(400, "Không thể xoá chính bạn")
    if user.role == "admin":
        raise HTTPException(
            400,
            "Không thể xoá admin khác. Demote về role=user trước rồi mới xoá.",
        )

    user_email = user.email  # save trước khi xoá để log

    # Wipe voices folder của user
    try:
        from app.core.storage import delete_user_voices
        n = delete_user_voices(user_id)
        logger.info("admin_purge_user=%d wiped %d voice files", user_id, n)
    except Exception as e:
        logger.warning("admin_purge_user: voice cleanup failed: %s", e)

    # Cascade DELETE qua FK: Payment/Voice/Job/UsageEvent tự xoá. AuditLog SET NULL.
    await db.delete(user)
    await db.commit()

    await audit_svc.log(
        db, user_id=admin.id, action="admin_purge_user",
        target_type="user", target_id=str(user_id),
        metadata={"email": user_email},
    )
    logger.info("admin_purge_user: user %d (%s) purged by admin %d",
                user_id, user_email, admin.id)
    return {"ok": True, "deleted_email": user_email}


# ── Audit log ──────────────────────────────────────────────

@router.get("/audit")
async def list_audit(
    user_id: int | None = Query(None),
    action: str = Query(""),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    q = select(AuditLog)
    if user_id is not None:
        q = q.where(AuditLog.user_id == user_id)
    if action:
        q = q.where(AuditLog.action == action)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    q = q.order_by(AuditLog.created_at.desc()).limit(per_page).offset((page - 1) * per_page)
    rows = (await db.execute(q)).scalars().all()
    return {
        "total": total, "page": page, "per_page": per_page,
        "items": [
            {
                "id": r.id, "user_id": r.user_id, "action": r.action,
                "target_type": r.target_type, "target_id": r.target_id,
                "metadata": json.loads(r.metadata_json) if r.metadata_json else None,
                "ip": r.ip, "user_agent": r.user_agent,
                "created_at": r.created_at.isoformat(),
            } for r in rows
        ],
    }


# ── Feature flags ──────────────────────────────────────────

class FlagRequest(BaseModel):
    enabled: bool = False
    rollout_percent: int = 0
    whitelist_user_ids: list[int] | None = None
    description: str | None = None


@router.get("/feature-flags")
async def list_flags(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    rows = (await db.execute(select(FeatureFlag).order_by(FeatureFlag.name))).scalars().all()
    return {
        "flags": [
            {
                "name": f.name, "enabled": f.enabled,
                "rollout_percent": f.rollout_percent,
                "whitelist_user_ids": json.loads(f.whitelist_user_ids) if f.whitelist_user_ids else [],
                "description": f.description,
                "updated_at": f.updated_at.isoformat() if f.updated_at else None,
            } for f in rows
        ],
    }


@router.put("/feature-flags/{name}")
async def upsert_flag(
    name: str,
    body: FlagRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    flag = await db.get(FeatureFlag, name)
    if not flag:
        flag = FeatureFlag(name=name)
        db.add(flag)
    old = {
        "enabled": flag.enabled,
        "rollout_percent": flag.rollout_percent,
    }
    flag.enabled = body.enabled
    flag.rollout_percent = max(0, min(100, body.rollout_percent))
    flag.whitelist_user_ids = json.dumps(body.whitelist_user_ids or [])
    if body.description is not None:
        flag.description = body.description
    flag.updated_at = datetime.utcnow()
    await db.commit()
    await audit_svc.log(
        db, user_id=admin.id, action="admin_update_flag",
        target_type="feature_flag", target_id=name,
        metadata={"old": old, "new": {"enabled": flag.enabled, "rollout_percent": flag.rollout_percent}},
    )
    return {"ok": True}


@router.delete("/feature-flags/{name}")
async def delete_flag(
    name: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    flag = await db.get(FeatureFlag, name)
    if not flag:
        raise HTTPException(404, "Flag không tồn tại")
    await db.delete(flag)
    await db.commit()
    await audit_svc.log(
        db, user_id=admin.id, action="admin_delete_flag",
        target_type="feature_flag", target_id=name,
    )
    return {"ok": True}


# ── Plans management ──────────────────────────────────────

class PlanUpdateRequest(BaseModel):
    name: str | None = None
    price_vnd: int | None = None
    price_usd: int | None = None
    ltd_price_vnd: int | None = None
    ltd_price_usd: int | None = None
    ltd_slots_total: int | None = None
    features: dict | None = None
    limits: dict | None = None
    is_active: bool | None = None


@router.get("/plans")
async def admin_list_plans(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    plans = await plan_svc.get_all_plans(db, only_active=False)
    return {"plans": [p.to_dict() for p in plans]}


@router.put("/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    body: PlanUpdateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    row = await db.get(Plan, plan_id)
    if not row:
        raise HTTPException(404, "Plan không tồn tại")
    if body.name is not None: row.name = body.name
    if body.price_vnd is not None: row.price_vnd = body.price_vnd
    if body.price_usd is not None: row.price_usd = body.price_usd
    if body.ltd_price_vnd is not None: row.ltd_price_vnd = body.ltd_price_vnd
    if body.ltd_price_usd is not None: row.ltd_price_usd = body.ltd_price_usd
    if body.ltd_slots_total is not None: row.ltd_slots_total = body.ltd_slots_total
    if body.features is not None:
        row.features_json = json.dumps(body.features, ensure_ascii=False)
    if body.limits is not None:
        row.limits_json = json.dumps(body.limits, ensure_ascii=False)
    if body.is_active is not None: row.is_active = body.is_active
    await db.commit()
    await audit_svc.log(
        db, user_id=admin.id, action="admin_update_plan",
        target_type="plan", target_id=plan_id,
    )
    return {"ok": True}


# ── Jobs management ───────────────────────────────────────

@router.get("/jobs")
async def admin_list_jobs(
    status: str = Query("", description="Filter: pending|running|done|error|canceled"),
    kind: str = Query(""),
    user_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    q = select(Job)
    if status:
        q = q.where(Job.status == status)
    if kind:
        q = q.where(Job.kind == kind)
    if user_id is not None:
        q = q.where(Job.user_id == user_id)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    q = q.order_by(Job.created_at.desc()).limit(per_page).offset((page - 1) * per_page)
    rows = (await db.execute(q)).scalars().all()
    return {
        "total": total, "page": page, "per_page": per_page,
        "jobs": [
            {
                "id": j.id, "user_id": j.user_id, "kind": j.kind,
                "status": j.status, "priority": j.priority,
                "progress": j.progress, "current_step": j.current_step,
                "error": j.error,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            } for j in rows
        ],
    }


@router.get("/voices")
async def admin_list_voices(
    user_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """List voices toàn hệ thống. Filter theo user nếu cần."""
    from app.db.models import Voice
    q = select(Voice)
    if user_id is not None:
        q = q.where(Voice.user_id == user_id)
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    q = q.order_by(Voice.created_at.desc()).limit(per_page).offset((page - 1) * per_page)
    rows = (await db.execute(q)).scalars().all()
    return {
        "total": total, "page": page, "per_page": per_page,
        "voices": [
            {
                "id": v.id, "user_id": v.user_id, "name": v.name,
                "ref_text": v.ref_text,
                "has_prompt": v.has_prompt,
                "tags": json.loads(v.tags_json) if v.tags_json else [],
                "created_at": v.created_at.isoformat() if v.created_at else None,
            } for v in rows
        ],
    }


@router.delete("/voices/{voice_id}")
async def admin_delete_voice(
    voice_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Admin xoá bất kỳ voice nào (không cần là owner)."""
    from app.services import voice_svc as _vs
    try:
        ok = await _vs.remove(db, voice_id, admin.id, is_admin=True)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(404, "Voice không tồn tại")
    await audit_svc.log(
        db, user_id=admin.id, action="admin_delete_voice",
        target_type="voice", target_id=voice_id,
    )
    return {"ok": True}


@router.post("/jobs/{job_id}/cancel")
async def admin_cancel_job(
    job_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job không tồn tại")
    await job_svc.mark_canceled(db, job_id)
    from app.worker import gpu_worker
    gpu_worker.publish(job_id, step="canceled")
    await audit_svc.log(
        db, user_id=admin.id, action="admin_cancel_job",
        target_type="job", target_id=job_id,
        metadata={"target_user_id": job.user_id, "kind": job.kind},
    )
    return {"ok": True}


# ── Billing / Payments ────────────────────────────────────

@router.get("/payments")
async def admin_list_payments(
    status: str = Query("pending", description="pending | paid | cancelled | all"),
    limit: int = Query(100, ge=1, le=500),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """List payments cho admin review. Default: pending để confirm."""
    if status == "pending":
        items = await billing_svc.list_pending_for_admin(db, limit=limit)
    else:
        from app.db.models import Payment
        from sqlalchemy import select, desc
        q = select(Payment, User).join(User, User.id == Payment.user_id)
        if status != "all":
            q = q.where(Payment.status == status)
        q = q.order_by(desc(Payment.created_at)).limit(limit)
        rows = (await db.execute(q)).all()
        items = []
        for p, u in rows:
            d = billing_svc._to_dict(p)
            d["user_id"] = u.id
            d["user_email"] = u.email
            d["user_name"] = u.name
            items.append(d)
    return {"payments": items}


class ConfirmPaymentRequest(BaseModel):
    note: str | None = None


@router.post("/payments/{ref_code}/confirm")
async def admin_confirm_payment(
    ref_code: str,
    body: ConfirmPaymentRequest = Body(default=ConfirmPaymentRequest()),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Confirm payment → kích hoạt plan trên user."""
    try:
        payment = await billing_svc.confirm_payment(
            db, ref_code=ref_code, admin_id=admin.id, note=body.note,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit_svc.log(
        db, user_id=admin.id, action="admin_confirm_payment",
        target_type="payment", target_id=ref_code,
        metadata={"plan_id": payment["plan_id"],
                  "amount_vnd": payment["amount_vnd"]},
    )
    return {"ok": True, "payment": payment}


@router.post("/payments/{ref_code}/reject")
async def admin_reject_payment_route(
    ref_code: str,
    body: ConfirmPaymentRequest = Body(default=ConfirmPaymentRequest()),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_session),
):
    """Admin từ chối payment pending."""
    try:
        payment = await billing_svc.admin_reject_payment(
            db, ref_code=ref_code, note=body.note,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    await audit_svc.log(
        db, user_id=admin.id, action="admin_reject_payment",
        target_type="payment", target_id=ref_code,
        metadata={"note": body.note or ""},
    )
    return {"ok": True, "payment": payment}
