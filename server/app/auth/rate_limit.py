"""Rate limit + quota enforcement dependency.

Gọi trước khi enqueue job GPU-bound (dubbing/stt/tts/clone). Check:
  - user.is_banned → 403
  - concurrent jobs ≥ plan.concurrent_jobs → 429
  - daily jobs ≥ plan.daily_jobs → 429
  - monthly feature usage ≥ plan.<feature>_min_month → 429 (only if quota set)

Return plan info kèm để handler dùng tiếp (set priority, enforce extra).
"""
from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.db.session import get_session
from app.services import plan_svc, usage_svc
from .deps import get_current_user

logger = logging.getLogger(__name__)


FEATURE_TO_LIMIT_KEY = {
    "dubbing":  "dubbing_min_month",
    "stt":      "stt_min_month",
    "tts":      "tts_chars_month",
    "clone":    None,   # không quota theo phút, chỉ theo số voice
    "separate": None,
}


class QuotaExceeded(HTTPException):
    def __init__(self, detail: str, code: str = "quota_exceeded"):
        super().__init__(status_code=429, detail=detail)
        self.error_code = code


async def check_quota(
    user: User,
    feature: str,
    db: AsyncSession,
) -> dict:
    """Raise 429 nếu vượt quota. Return dict {plan, concurrent, daily_count}
    để caller dùng tiếp."""
    if user.is_banned:
        raise HTTPException(
            status_code=403,
            detail="Tài khoản của bạn đã bị khoá. Vui lòng liên hệ hỗ trợ.",
        )

    plan = await plan_svc.get_plan(db, user.plan or "free")
    if not plan:
        # Fallback: nếu plan không tồn tại, dùng free
        plan = await plan_svc.get_plan(db, "free")

    # 1. Concurrent limit
    concurrent_max = plan_svc.get_limit(plan, "concurrent_jobs", 1)
    if concurrent_max != -1:
        running = await usage_svc.count_concurrent_jobs(db, user.id)
        if running >= concurrent_max:
            raise QuotaExceeded(
                f"Bạn đang có {running} tác vụ đang xử lý. "
                f"Gói {plan.name} cho phép tối đa {concurrent_max} tác vụ đồng thời. "
                f"Vui lòng đợi xong rồi thử lại.",
                code="concurrent_limit",
            )

    # 2. Daily count limit
    daily_max = plan_svc.get_limit(plan, "daily_jobs", -1)
    if daily_max != -1:
        today = await usage_svc.count_jobs_today(db, user.id)
        if today >= daily_max:
            raise QuotaExceeded(
                f"Hôm nay bạn đã dùng {today}/{daily_max} lượt. "
                f"Vui lòng thử lại vào ngày mai hoặc nâng cấp gói.",
                code="daily_limit",
            )

    # 3. Monthly feature-specific quota
    limit_key = FEATURE_TO_LIMIT_KEY.get(feature)
    if limit_key:
        month_max = plan_svc.get_limit(plan, limit_key, -1)
        if month_max != -1:
            month_summary = await usage_svc.get_month_summary(db, user.id)
            if feature in ("dubbing", "stt"):
                used = month_summary.get(f"{feature}_min", 0)
                if used >= month_max:
                    raise QuotaExceeded(
                        f"Bạn đã dùng hết {month_max} phút {feature} tháng này. "
                        f"Nâng cấp gói để tiếp tục.",
                        code="monthly_limit",
                    )
            elif feature == "tts":
                used_chars = month_summary.get("tts_chars", 0)
                if used_chars >= month_max:
                    raise QuotaExceeded(
                        f"Bạn đã dùng hết {month_max:,} ký tự TTS tháng này. "
                        f"Nâng cấp gói để tiếp tục.",
                        code="monthly_limit",
                    )

    return {"plan": plan}


def require_quota(feature: str):
    """Factory dep: require_quota('dubbing') → gắn vào endpoint. Trả về
    dict {user, plan} sau khi pass check."""
    async def dep(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_session),
    ) -> dict:
        info = await check_quota(user, feature, db)
        return {"user": user, "plan": info["plan"], "db": db}
    return dep


async def check_download_quota(user: User, db: AsyncSession) -> dict:
    """Riêng cho download: chỉ check daily_downloads (không tính concurrent
    vì download nhanh, không enqueue queue như dubbing/STT)."""
    if user.is_banned:
        raise HTTPException(403, "Tài khoản của bạn đã bị khoá. Vui lòng liên hệ hỗ trợ.")
    plan = await plan_svc.get_plan(db, user.plan or "free")
    if not plan:
        plan = await plan_svc.get_plan(db, "free")
    daily_max = plan_svc.get_limit(plan, "daily_downloads", -1)
    if daily_max != -1:
        today = await usage_svc.count_downloads_today(db, user.id)
        if today >= daily_max:
            raise QuotaExceeded(
                f"Hôm nay bạn đã tải {today}/{daily_max} video. "
                f"Vui lòng thử lại vào ngày mai hoặc nâng cấp gói {plan.name}.",
                code="daily_download_limit",
            )
    return {"plan": plan}


def require_download_quota():
    """Dep cho /download/to-project — check daily_downloads."""
    async def dep(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_session),
    ) -> dict:
        info = await check_download_quota(user, db)
        return {"user": user, "plan": info["plan"], "db": db}
    return dep
