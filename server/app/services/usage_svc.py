"""Usage tracking — record + aggregate cho quota + analytics."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UsageEvent

logger = logging.getLogger(__name__)


async def record(
    db: AsyncSession,
    *,
    user_id: int,
    feature: str,
    minutes: float = 0.0,
    tokens: int = 0,
    characters: int = 0,
    project_id: str | None = None,
) -> UsageEvent | None:
    """Ghi 1 event usage. Không raise."""
    try:
        ev = UsageEvent(
            user_id=user_id,
            feature=feature,
            minutes=float(minutes or 0),
            tokens=int(tokens or 0),
            characters=int(characters or 0),
            project_id=project_id,
        )
        db.add(ev)
        await db.commit()
        return ev
    except Exception as e:
        logger.warning("usage.record failed [%s/%s]: %s", user_id, feature, e)
        try:
            await db.rollback()
        except Exception:
            pass
        return None


def _month_start() -> datetime:
    now = datetime.utcnow()
    return datetime(now.year, now.month, 1)


def _day_start() -> datetime:
    now = datetime.utcnow()
    return datetime(now.year, now.month, now.day)


async def get_month_summary(db: AsyncSession, user_id: int) -> dict:
    """Tổng usage trong tháng hiện tại theo từng feature."""
    since = _month_start()
    q = (
        select(
            UsageEvent.feature,
            func.coalesce(func.sum(UsageEvent.minutes), 0.0),
            func.coalesce(func.sum(UsageEvent.tokens), 0),
            func.coalesce(func.sum(UsageEvent.characters), 0),
        )
        .where(UsageEvent.user_id == user_id,
                UsageEvent.created_at >= since)
        .group_by(UsageEvent.feature)
    )
    res = await db.execute(q)
    out = {
        "dubbing_min": 0.0,
        "stt_min": 0.0,
        "tts_chars": 0,
        "translate_tokens": 0,
        "clone_min": 0.0,
    }
    for feature, minutes, tokens, chars in res.all():
        if feature == "dubbing":
            out["dubbing_min"] = round(float(minutes), 2)
        elif feature == "stt":
            out["stt_min"] = round(float(minutes), 2)
        elif feature == "tts":
            out["tts_chars"] = int(chars)
        elif feature == "translate":
            out["translate_tokens"] = int(tokens)
        elif feature == "clone":
            out["clone_min"] = round(float(minutes), 2)
    return out


async def count_jobs_today(db: AsyncSession, user_id: int) -> int:
    """Đếm số job đã submit trong 24h qua — để rate limit daily."""
    from app.db.models import Job
    since = _day_start()
    q = (
        select(func.count(Job.id))
        .where(Job.user_id == user_id, Job.created_at >= since)
    )
    res = await db.execute(q)
    return int(res.scalar() or 0)


async def count_concurrent_jobs(db: AsyncSession, user_id: int) -> int:
    """Job của user đang pending/running — cho rate limit concurrent."""
    from app.db.models import Job
    q = (
        select(func.count(Job.id))
        .where(Job.user_id == user_id,
                Job.status.in_(["pending", "running"]))
    )
    res = await db.execute(q)
    return int(res.scalar() or 0)
