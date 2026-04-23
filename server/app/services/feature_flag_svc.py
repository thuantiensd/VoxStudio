"""Feature flag — gate tính năng beta, rollout dần % user."""
from __future__ import annotations

import hashlib
import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FeatureFlag

logger = logging.getLogger(__name__)


def _user_in_bucket(user_id: int, flag_name: str, percent: int) -> bool:
    """Stable hash → cùng user luôn in hay luôn out (không flicker).

    Rải đều 0-99, trả True nếu bucket < percent.
    """
    if percent <= 0:
        return False
    if percent >= 100:
        return True
    key = f"{user_id}:{flag_name}".encode()
    bucket = int(hashlib.md5(key).hexdigest()[:8], 16) % 100
    return bucket < percent


async def is_enabled(db: AsyncSession, user_id: int, flag_name: str) -> bool:
    """Kiểm tra 1 flag có bật cho user không.

    Logic:
      1. Không có trong DB → False
      2. user ∈ whitelist → True (override enabled/rollout)
      3. enabled=False → False
      4. rollout_percent=100 → True
      5. rollout_percent=0 → False
      6. Stable hash → True nếu bucket < rollout_percent
    """
    flag = await db.get(FeatureFlag, flag_name)
    if not flag:
        return False
    # Whitelist force-on
    if flag.whitelist_user_ids:
        try:
            wl = json.loads(flag.whitelist_user_ids)
            if user_id in wl:
                return True
        except Exception:
            pass
    if not flag.enabled:
        return False
    return _user_in_bucket(user_id, flag_name, flag.rollout_percent)


async def list_enabled_for_user(db: AsyncSession, user_id: int) -> list[str]:
    """Danh sách flag đang bật cho user — cho FE consume qua /me."""
    res = await db.execute(select(FeatureFlag))
    out = []
    for flag in res.scalars().all():
        if await is_enabled(db, user_id, flag.name):
            out.append(flag.name)
    return out


async def list_all(db: AsyncSession) -> list[FeatureFlag]:
    res = await db.execute(select(FeatureFlag).order_by(FeatureFlag.name.asc()))
    return list(res.scalars().all())
