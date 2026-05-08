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
    """Lấy danh sách cột — hoạt động trên cả SQLite (PRAGMA) và Postgres (information_schema)."""
    dialect = db.bind.dialect.name if db.bind else "sqlite"
    if dialect == "sqlite":
        res = await db.execute(text(f"PRAGMA table_info({table})"))
        return {row[1] for row in res.all()}
    # Postgres / others
    res = await db.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = :tbl AND table_schema = 'public'"
    ), {"tbl": table})
    return {row[0] for row in res.all()}


async def _ensure_user_columns(db: AsyncSession):
    """Thêm các cột mới vào bảng users nếu chưa có."""
    existing = await _columns_of(db, "users")
    additions = {
        "role":             "VARCHAR(16) NOT NULL DEFAULT 'user'",
        "is_banned":        "BOOLEAN NOT NULL DEFAULT 0",
        "last_active_at":   "DATETIME",
        "email_verified":   "BOOLEAN NOT NULL DEFAULT 0",
        "verify_token":     "VARCHAR(64)",
        "verify_sent_at":   "DATETIME",
        "reset_token":      "VARCHAR(64)",
        "reset_sent_at":    "DATETIME",
        "plan_expires_at":  "DATETIME",
        "credit_balance":   "INTEGER NOT NULL DEFAULT 0",
    }
    for col, ddl in additions.items():
        if col not in existing:
            try:
                await db.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))
                logger.info("Added column users.%s", col)
            except Exception as e:
                logger.warning("Could not add column users.%s: %s", col, e)
    await db.commit()


async def _ensure_payment_columns(db: AsyncSession):
    """Thêm các cột mới cho payments (kind, credits_amount)."""
    existing = await _columns_of(db, "payments")
    additions = {
        "kind":            "VARCHAR(16) NOT NULL DEFAULT 'subscription'",
        "credits_amount":  "INTEGER NOT NULL DEFAULT 0",
    }
    for col, ddl in additions.items():
        if col not in existing:
            try:
                await db.execute(text(f"ALTER TABLE payments ADD COLUMN {col} {ddl}"))
                logger.info("Added column payments.%s", col)
            except Exception as e:
                logger.warning("Could not add column payments.%s: %s", col, e)
    await db.commit()


async def _ensure_voice_columns(db: AsyncSession):
    """Thêm cột consent vào voices nếu chưa có."""
    existing = await _columns_of(db, "voices")
    additions = {
        "consent_at": "DATETIME",
        "consent_ip": "VARCHAR(45)",
    }
    for col, ddl in additions.items():
        if col not in existing:
            try:
                await db.execute(text(f"ALTER TABLE voices ADD COLUMN {col} {ddl}"))
                logger.info("Added column voices.%s", col)
            except Exception as e:
                logger.warning("Could not add column voices.%s: %s", col, e)
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
            "video_download": True,
            "batch": False, "api": False, "priority_queue": False,
            "export_4k": False, "watermark_free": False,
        },
        "limits": {
            "concurrent_jobs": 1,
            "daily_jobs": 10,
            "daily_downloads": 15,
            "dubbing_min_month": 10,
            "stt_min_month": 30,
            "tts_chars_month": 5_000,
            "tts_max_chars_request": 1_000,    # 1k/lần — free user thử
            "voice_clone_max": 1,
            "project_max": 5,
        },
    },
    {
        "id": "pro", "name": "Pro",
        # Hybrid Option A: 199k VND/tháng (~$8 USD).
        # 1M chars TTS (~1.250 phút) + 30 phút dubbing + 5 voice clones
        "price_vnd": 199_000, "price_usd": 800,  # $8 in cents
        "ltd_price_vnd": 3_999_000, "ltd_price_usd": 16_000,  # $160 LTD = 20 tháng
        "ltd_slots_total": 100,
        "sort_order": 2,
        "features": {
            "dubbing": True, "stt": True, "tts": True,
            "translate": True, "download": True, "voice_clone": True,
            "video_download": True,
            "batch": True, "api": False, "priority_queue": True,
            "export_4k": True, "watermark_free": True,
        },
        "limits": {
            "concurrent_jobs": 2,
            "daily_jobs": 100,
            "daily_downloads": -1,  # unlimited
            "dubbing_min_month": 30,
            "stt_min_month": 1_000,
            "tts_chars_month": 1_000_000,        # 1M chars/tháng (~1.250 phút)
            "tts_max_chars_request": 25_000,
            "voice_clone_max": 5,
            "project_max": 50,
        },
    },
    {
        "id": "studio", "name": "Studio",
        # Hybrid Option A: 499k VND/tháng (~$20 USD).
        # 5M chars TTS (~6.250 phút) + 200 phút dubbing + unlimited clones
        "price_vnd": 499_000, "price_usd": 2_000,  # $20 in cents
        "ltd_price_vnd": 9_999_000, "ltd_price_usd": 40_000,  # $400 LTD = 20 tháng
        "ltd_slots_total": 100,
        "sort_order": 3,
        "features": {
            "dubbing": True, "stt": True, "tts": True,
            "translate": True, "download": True, "voice_clone": True,
            "video_download": True,
            "batch": True, "api": True, "priority_queue": True,
            "export_4k": True, "watermark_free": True,
        },
        "limits": {
            "concurrent_jobs": 5,
            "daily_jobs": -1,
            "daily_downloads": -1,
            "dubbing_min_month": 200,
            "stt_min_month": -1,
            "tts_chars_month": 5_000_000,       # 5M chars/tháng fair-use
            "tts_max_chars_request": -1,
            "voice_clone_max": -1,              # unlimited
            "project_max": -1,
        },
    },
]


async def _seed_plans(db: AsyncSession):
    """Upsert default plans. Insert nếu chưa có; nếu plan đã tồn tại với
    giá CŨ (legacy mặc định) thì auto force-update sang spec hiện tại.
    Admin đã chỉnh giá thủ công thì giữ nguyên — phát hiện qua so sánh
    price_usd với các giá legacy known."""
    # Giá USD legacy của lần seed trước — nếu match → force update
    LEGACY_USD = {
        "free":   [0],
        # Force-update plans created before Hybrid Option A pricing
        "pro":    [600, 100, 2_000],     # $6 / $1 / $20 (pre-hybrid)
        "studio": [1_400, 200, 6_900],   # $14 / $2 / $69 (pre-hybrid)
    }
    for spec in DEFAULT_PLANS:
        existing = await db.get(Plan, spec["id"])
        force_update = False
        if existing:
            legacy_usds = LEGACY_USD.get(spec["id"], [])
            if existing.price_usd in legacy_usds:
                force_update = True
            else:
                # Admin đã đổi giá → giữ nguyên, chỉ merge features/limits
                # mới (vd thêm daily_downloads cho gói cũ).
                try:
                    cur_limits = json.loads(existing.limits_json or "{}")
                    cur_features = json.loads(existing.features_json or "{}")
                except Exception:
                    cur_limits, cur_features = {}, {}
                merged_limits = {**spec["limits"], **cur_limits}
                merged_features = {**spec["features"], **cur_features}
                # Nếu key mới (daily_downloads, video_download,
                # tts_max_chars_request) chưa có trong existing → bổ sung.
                # Pattern này cho phép thêm field mới vào plan limits mà
                # không phá pricing admin đã chỉnh tay.
                changed = False
                if "daily_downloads" not in cur_limits:
                    merged_limits["daily_downloads"] = spec["limits"]["daily_downloads"]
                    changed = True
                if "video_download" not in cur_features:
                    merged_features["video_download"] = spec["features"]["video_download"]
                    changed = True
                if "tts_max_chars_request" not in cur_limits:
                    merged_limits["tts_max_chars_request"] = spec["limits"]["tts_max_chars_request"]
                    changed = True
                if changed:
                    existing.limits_json = json.dumps(merged_limits, ensure_ascii=False)
                    existing.features_json = json.dumps(merged_features, ensure_ascii=False)
                    logger.info("Patched %s plan with new fields", spec["id"])
                continue

        if force_update and existing:
            existing.name = spec["name"]
            existing.price_vnd = spec["price_vnd"]
            existing.price_usd = spec["price_usd"]
            existing.ltd_price_vnd = spec["ltd_price_vnd"]
            existing.ltd_price_usd = spec["ltd_price_usd"]
            existing.ltd_slots_total = spec["ltd_slots_total"]
            existing.features_json = json.dumps(spec["features"], ensure_ascii=False)
            existing.limits_json = json.dumps(spec["limits"], ensure_ascii=False)
            existing.sort_order = spec["sort_order"]
            existing.is_active = True
            logger.info("Force-updated plan %s to new pricing/limits", spec["id"])
            continue

        # Insert mới
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


# ── Seed credit packs ─────────────────────────────────────────

DEFAULT_CREDIT_PACKS = [
    {
        "id": "mini", "name": "Mini",
        "base_credits": 200_000, "bonus_credits": 0, "bonus_percent": 0,
        "price_vnd": 49_000, "price_usd": 200,    # $2
        "sort_order": 1, "is_popular": False,
    },
    {
        "id": "starter", "name": "Starter",
        "base_credits": 700_000, "bonus_credits": 0, "bonus_percent": 0,
        "price_vnd": 119_000, "price_usd": 500,   # $5
        "sort_order": 2, "is_popular": True,
    },
    {
        "id": "credits_pro", "name": "Pro",
        "base_credits": 2_000_000, "bonus_credits": 200_000, "bonus_percent": 10,
        "price_vnd": 349_000, "price_usd": 1_400,   # $14
        "sort_order": 3, "is_popular": False,
    },
    {
        "id": "bulk", "name": "Bulk",
        "base_credits": 6_000_000, "bonus_credits": 1_500_000, "bonus_percent": 25,
        "price_vnd": 999_000, "price_usd": 4_000,   # $40
        "sort_order": 4, "is_popular": False,
    },
    {
        "id": "max", "name": "Max",
        "base_credits": 16_000_000, "bonus_credits": 6_400_000, "bonus_percent": 40,
        "price_vnd": 2_499_000, "price_usd": 9_999,  # $100
        "sort_order": 5, "is_popular": False,
    },
]


async def _seed_credit_packs(db: AsyncSession):
    """Upsert default credit packs. Idempotent."""
    from .models import CreditPack
    for spec in DEFAULT_CREDIT_PACKS:
        existing = await db.get(CreditPack, spec["id"])
        if existing:
            # Đã có — skip để admin có thể chỉnh giá
            continue
        pack = CreditPack(
            id=spec["id"],
            name=spec["name"],
            base_credits=spec["base_credits"],
            bonus_credits=spec["bonus_credits"],
            bonus_percent=spec["bonus_percent"],
            price_vnd=spec["price_vnd"],
            price_usd=spec["price_usd"],
            sort_order=spec["sort_order"],
            is_active=True,
            is_popular=spec.get("is_popular", False),
        )
        db.add(pack)
        logger.info("Seeded credit pack: %s", spec["id"])
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


# ── Backfill voices (existing filesystem → DB, gán admin user) ──

async def _backfill_voices(db: AsyncSession):
    """Idempotent: scan VOICES_DIR/*.json, tạo Voice row nếu chưa có.
    Owner = admin đầu tiên (hoặc user_id đầu tiên trong DB nếu không admin).
    Sau fix isolation, dev có thể re-assign qua admin UI."""
    from app.db.models import Voice
    from app.config import VOICES_DIR
    from sqlalchemy import select

    if not VOICES_DIR.exists():
        return

    # Tìm owner cho voice cũ chưa có user: ưu tiên admin đầu tiên
    owner = await db.scalar(
        select(User).where(User.role == "admin").order_by(User.id.asc()).limit(1)
    )
    if not owner:
        owner = await db.scalar(select(User).order_by(User.id.asc()).limit(1))
    if not owner:
        # Chưa có user nào → để migration chạy sau khi có register đầu tiên
        return

    existing_ids = {
        r[0] for r in (await db.execute(select(Voice.id))).all()
    }

    added = 0
    for jf in VOICES_DIR.glob("*.json"):
        try:
            import json as _json
            meta = _json.loads(jf.read_text(encoding="utf-8"))
            vid = meta.get("id") or jf.stem
            if vid in existing_ids:
                continue
            v = Voice(
                id=vid[:16],
                user_id=owner.id,
                name=meta.get("name", "Untitled"),
                ref_text=meta.get("ref_text"),
                tags_json=_json.dumps(meta.get("tags") or [], ensure_ascii=False),
                has_prompt=bool(meta.get("has_prompt")),
            )
            db.add(v)
            added += 1
        except Exception as e:
            logger.warning("Backfill voice %s failed: %s", jf, e)
            continue
    if added:
        await db.commit()
        logger.info("Backfilled %d voices to user id=%d", added, owner.id)


# ── Migrate voices từ flat layout sang per-user folder ─────────

async def _migrate_voices_to_user_folders(db: AsyncSession):
    """Idempotent: file `.pt/.json/.wav` ở `voices/` root → `voices/<user_id>/`.
    Look up user_id từ DB voices table. Voice không có DB row → để nguyên
    (sẽ được _backfill_voices tạo row sau, lần migration tới sẽ pick up).
    """
    from app.db.models import Voice
    from app.config import VOICES_DIR
    from sqlalchemy import select

    if not VOICES_DIR.exists():
        return

    # Map voice_id → user_id từ DB (1 query)
    rows = (await db.execute(select(Voice.id, Voice.user_id))).all()
    owner_map = {vid: uid for vid, uid in rows}
    if not owner_map:
        return

    moved = 0
    for f in list(VOICES_DIR.iterdir()):
        if not f.is_file():
            continue
        # Match <voice_id>.<ext>
        if "." not in f.name:
            continue
        voice_id, _, ext = f.name.partition(".")
        if ext not in ("pt", "json", "wav"):
            continue
        owner = owner_map.get(voice_id)
        if owner is None:
            continue  # voice không có owner → bỏ, _backfill_voices xử lý sau
        dest_dir = VOICES_DIR / str(owner)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f.name
        if dest.exists():
            # Đã có ở user folder → xoá flat (duplicate)
            try: f.unlink()
            except Exception: pass
            continue
        try:
            f.rename(dest)
            moved += 1
        except Exception as e:
            logger.warning("migrate voice file %s failed: %s", f.name, e)
    if moved:
        logger.info("Migrated %d voice file(s) to per-user folders", moved)


# ── Public entrypoint ─────────────────────────────────────────

async def run_migrations():
    """Gọi từ app.main startup sau init_db()."""
    async with AsyncSessionLocal() as db:
        await _ensure_user_columns(db)
        await _ensure_voice_columns(db)
        await _ensure_payment_columns(db)
        await _seed_plans(db)
        await _seed_credit_packs(db)
        await _promote_admins(db)
        await _backfill_voices(db)
        # Migrate phải chạy SAU _backfill_voices vì cần DB rows để lookup owner
        await _migrate_voices_to_user_folders(db)
