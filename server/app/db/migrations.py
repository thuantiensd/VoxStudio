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
    }
    for col, ddl in additions.items():
        if col not in existing:
            try:
                await db.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))
                logger.info("Added column users.%s", col)
            except Exception as e:
                logger.warning("Could not add column users.%s: %s", col, e)
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
            "voice_clone_max": 1,
            "project_max": 5,
        },
    },
    {
        "id": "pro", "name": "Pro",
        # Giá USD chuẩn ($20). VND tính live theo tỷ giá USD→VND
        # (cache 24h). Stored price_vnd là fallback khi API rate fail.
        "price_vnd": 520_000, "price_usd": 2_000,  # $20 in cents
        "ltd_price_vnd": 5_200_000, "ltd_price_usd": 20_000,  # $200 LTD
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
            "dubbing_min_month": 300,
            "stt_min_month": 1_000,
            "tts_chars_month": 200_000,
            "voice_clone_max": 10,
            "project_max": 50,
        },
    },
    {
        "id": "studio", "name": "Studio",
        "price_vnd": 1_794_000, "price_usd": 6_900,  # $69 in cents
        "ltd_price_vnd": 17_940_000, "ltd_price_usd": 69_000,  # $690 LTD
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
            "dubbing_min_month": 1_500,
            "stt_min_month": -1,
            "tts_chars_month": -1,
            "voice_clone_max": 50,
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
        "pro":    [600, 100],     # $6 (legacy) / $1 (very early)
        "studio": [1_400, 200],   # $14 / $2
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
                # Nếu key mới (daily_downloads, video_download) chưa có
                # trong existing → bổ sung
                changed = False
                if "daily_downloads" not in cur_limits:
                    merged_limits["daily_downloads"] = spec["limits"]["daily_downloads"]
                    changed = True
                if "video_download" not in cur_features:
                    merged_features["video_download"] = spec["features"]["video_download"]
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
        await _seed_plans(db)
        await _promote_admins(db)
        await _backfill_voices(db)
        # Migrate phải chạy SAU _backfill_voices vì cần DB rows để lookup owner
        await _migrate_voices_to_user_folders(db)
