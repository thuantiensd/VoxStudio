"""Migration helpers — chạy 1 lần khi startup, idempotent.

SQLAlchemy `create_all` chỉ tạo bảng MỚI, không sửa bảng cũ. Script này
dùng pragma để check cột tồn tại rồi ALTER nếu thiếu.

Mỗi migration function trả về bool — True nếu đã chạy/skip thành công.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .session import AsyncSessionLocal
from .models import Plan, User

logger = logging.getLogger(__name__)


async def _columns_of(db: AsyncSession, table: str) -> set[str]:
    res = await db.execute(text(f"PRAGMA table_info({table})"))
    return {row[1] for row in res.all()}


async def _ensure_user_columns(db: AsyncSession):
    """Thêm các cột mới vào bảng users nếu chưa có."""
    existing = await _columns_of(db, "users")
    additions = {
        "role":           "VARCHAR(16) NOT NULL DEFAULT 'user'",
        "is_banned":      "BOOLEAN NOT NULL DEFAULT 0",
        "last_active_at": "DATETIME",
    }
    for col, ddl in additions.items():
        if col not in existing:
            try:
                await db.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))
                logger.info("Added column users.%s", col)
            except Exception as e:
                logger.warning("Could not add column users.%s: %s", col, e)
    await db.commit()


# ── Seed pricing plans ────────────────────────────────────────

DEFAULT_PLANS = [
    {
        "id": "free", "name": "Miễn phí",
        "price_vnd": 0, "price_usd": 0,
        "ltd_price_vnd": 0, "ltd_price_usd": 0,
        "ltd_slots_total": 0,
        "sort_order": 1,
        "features": {
            "dubbing": True, "stt": True, "tts": True,
            "translate": True, "download": True, "voice_clone": True,
            "batch": False, "api": False, "priority_queue": False,
            "export_4k": False, "watermark_free": False,
        },
        "limits": {
            "concurrent_jobs": 1,
            "daily_jobs": 10,
            "dubbing_min_month": 10,
            "stt_min_month": 30,
            "tts_chars_month": 5_000,
            "voice_clone_max": 1,
            "project_max": 5,
        },
    },
    {
        "id": "pro", "name": "Pro",
        "price_vnd": 149_000, "price_usd": 600,  # $6 in cents
        "ltd_price_vnd": 1_990_000, "ltd_price_usd": 8_500,
        "ltd_slots_total": 100,
        "sort_order": 2,
        "features": {
            "dubbing": True, "stt": True, "tts": True,
            "translate": True, "download": True, "voice_clone": True,
            "batch": True, "api": False, "priority_queue": True,
            "export_4k": True, "watermark_free": True,
        },
        "limits": {
            "concurrent_jobs": 2,
            "daily_jobs": 100,
            "dubbing_min_month": 300,
            "stt_min_month": 1_000,
            "tts_chars_month": 200_000,
            "voice_clone_max": 10,
            "project_max": 50,
        },
    },
    {
        "id": "studio", "name": "Studio",
        "price_vnd": 349_000, "price_usd": 1_400,
        "ltd_price_vnd": 4_990_000, "ltd_price_usd": 20_000,
        "ltd_slots_total": 100,
        "sort_order": 3,
        "features": {
            "dubbing": True, "stt": True, "tts": True,
            "translate": True, "download": True, "voice_clone": True,
            "batch": True, "api": True, "priority_queue": True,
            "export_4k": True, "watermark_free": True,
        },
        "limits": {
            "concurrent_jobs": 5,
            "daily_jobs": -1,
            "dubbing_min_month": 1_500,
            "stt_min_month": -1,
            "tts_chars_month": -1,
            "voice_clone_max": 50,
            "project_max": -1,
        },
    },
]


async def _seed_plans(db: AsyncSession):
    """Upsert default plans (chỉ insert nếu chưa có, không override giá
    nếu admin đã edit)."""
    for spec in DEFAULT_PLANS:
        existing = await db.get(Plan, spec["id"])
        if existing:
            continue
        plan = Plan(
            id=spec["id"],
            name=spec["name"],
            price_vnd=spec["price_vnd"],
            price_usd=spec["price_usd"],
            ltd_price_vnd=spec["ltd_price_vnd"],
            ltd_price_usd=spec["ltd_price_usd"],
            ltd_slots_total=spec["ltd_slots_total"],
            ltd_slots_taken=0,
            features_json=json.dumps(spec["features"], ensure_ascii=False),
            limits_json=json.dumps(spec["limits"], ensure_ascii=False),
            sort_order=spec["sort_order"],
            is_active=True,
        )
        db.add(plan)
        logger.info("Seeded plan: %s", spec["id"])
    await db.commit()


# ── Promote admin via ENV ─────────────────────────────────────

async def _promote_admins(db: AsyncSession):
    """ENV ADMIN_EMAILS=a@x.com,b@y.com → upsert role=admin.
    Chạy mỗi startup, idempotent."""
    raw = os.environ.get("ADMIN_EMAILS", "").strip()
    if not raw:
        return
    emails = [e.strip().lower() for e in raw.split(",") if e.strip()]
    if not emails:
        return
    from sqlalchemy import select, update
    res = await db.execute(select(User).where(User.email.in_(emails)))
    users = res.scalars().all()
    for u in users:
        if u.role != "admin":
            u.role = "admin"
            logger.info("Promoted to admin: %s", u.email)
    await db.commit()


# ── Public entrypoint ─────────────────────────────────────────

async def run_migrations():
    """Gọi từ app.main startup sau init_db()."""
    async with AsyncSessionLocal() as db:
        await _ensure_user_columns(db)
        await _seed_plans(db)
        await _promote_admins(db)
