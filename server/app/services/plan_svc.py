"""Plan helper — đọc features + limits + giá từ bảng plans."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Plan


@dataclass
class PlanInfo:
    id: str
    name: str
    price_vnd: int
    price_usd: int
    ltd_price_vnd: int
    ltd_price_usd: int
    ltd_slots_available: int
    features: dict[str, Any]
    limits: dict[str, Any]
    is_active: bool
    sort_order: int

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "price_vnd": self.price_vnd,
            "price_usd": self.price_usd,
            "ltd": {
                "price_vnd": self.ltd_price_vnd,
                "price_usd": self.ltd_price_usd,
                "slots_available": self.ltd_slots_available,
            } if self.ltd_price_vnd > 0 else None,
            "features": self.features,
            "limits": self.limits,
            "is_active": self.is_active,
            "sort_order": self.sort_order,
        }


def _info_from(row: Plan) -> PlanInfo:
    features = json.loads(row.features_json) if row.features_json else {}
    limits = json.loads(row.limits_json) if row.limits_json else {}
    return PlanInfo(
        id=row.id,
        name=row.name,
        price_vnd=row.price_vnd,
        price_usd=row.price_usd,
        ltd_price_vnd=row.ltd_price_vnd,
        ltd_price_usd=row.ltd_price_usd,
        ltd_slots_available=max(0, (row.ltd_slots_total or 0) - (row.ltd_slots_taken or 0)),
        features=features,
        limits=limits,
        is_active=row.is_active,
        sort_order=row.sort_order,
    )


async def get_plan(db: AsyncSession, plan_id: str) -> PlanInfo | None:
    row = await db.get(Plan, plan_id)
    if not row:
        return None
    return _info_from(row)


async def get_all_plans(db: AsyncSession,
                         only_active: bool = True) -> list[PlanInfo]:
    q = select(Plan)
    if only_active:
        q = q.where(Plan.is_active == True)  # noqa: E712
    q = q.order_by(Plan.sort_order.asc())
    res = await db.execute(q)
    return [_info_from(r) for r in res.scalars().all()]


def has_feature(plan: PlanInfo | None, feature: str) -> bool:
    if not plan:
        return False
    return bool(plan.features.get(feature, False))


def get_limit(plan: PlanInfo | None, key: str, default: int = 0) -> int:
    """Return limit value. -1 means unlimited."""
    if not plan:
        return default
    return int(plan.limits.get(key, default))
