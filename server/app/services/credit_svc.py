"""Credit service — quản lý credit balance, topup, consume.

Mỗi user có `credit_balance` (int chars). Topup cộng vào, consume trừ ra.
Mọi thay đổi đi qua `_record_transaction()` để có audit log đầy đủ.

Flow topup:
  1. User chọn pack → POST /credits/topup → tạo Payment(kind='credits') pending
  2. User chuyển khoản
  3. Admin confirm (qua billing.confirm_payment) → khi paid:
     - billing_svc detect kind=credits → call apply_topup() để cộng credits
     - record CreditTransaction kind='topup_paid'

Flow consume:
  1. TTS service tính chars → call try_consume(user, chars)
  2. Service trừ trước từ monthly quota, hết → trừ credit_balance
  3. Hết cả 2 → raise QuotaExceeded
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CreditPack, CreditTransaction, User

logger = logging.getLogger(__name__)


class QuotaExceeded(Exception):
    """Raised khi user không đủ credits để consume."""
    pass


# ── Catalog ────────────────────────────────────────────────────
async def list_packs(db: AsyncSession, only_active: bool = True) -> list[dict]:
    q = select(CreditPack)
    if only_active:
        q = q.where(CreditPack.is_active == True)  # noqa: E712
    q = q.order_by(CreditPack.sort_order.asc())
    rows = (await db.execute(q)).scalars().all()
    return [_pack_to_dict(p) for p in rows]


async def get_pack(db: AsyncSession, pack_id: str) -> CreditPack | None:
    return await db.get(CreditPack, pack_id)


def _pack_to_dict(p: CreditPack) -> dict:
    """VND tính LIVE từ USD theo tỷ giá thị trường (cache 24h)."""
    from app.services import fx_rate_svc
    live_vnd = (
        fx_rate_svc.usd_cents_to_vnd(p.price_usd)
        if p.price_usd > 0 else p.price_vnd
    ) or p.price_vnd
    total_credits = (p.base_credits or 0) + (p.bonus_credits or 0)
    return {
        "id": p.id,
        "name": p.name,
        "base_credits": p.base_credits,
        "bonus_credits": p.bonus_credits,
        "bonus_percent": p.bonus_percent,
        "total_credits": total_credits,
        "price_vnd": live_vnd,
        "price_usd": p.price_usd,
        "sort_order": p.sort_order,
        "is_active": p.is_active,
        "is_popular": bool(p.is_popular),
    }


# ── Balance + history ──────────────────────────────────────────
async def get_balance(db: AsyncSession, user_id: int) -> int:
    user = await db.get(User, user_id)
    return user.credit_balance if user else 0


async def list_transactions(
    db: AsyncSession, user_id: int, limit: int = 50,
) -> list[dict]:
    q = (
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(desc(CreditTransaction.created_at))
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [_tx_to_dict(t) for t in rows]


def _tx_to_dict(t: CreditTransaction) -> dict:
    return {
        "id": t.id,
        "kind": t.kind,
        "delta": t.delta,
        "balance_after": t.balance_after,
        "ref_id": t.ref_id,
        "note": t.note,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ── Mutations ──────────────────────────────────────────────────
async def _record_transaction(
    db: AsyncSession,
    *,
    user: User,
    kind: str,
    delta: int,
    ref_id: str | None = None,
    note: str | None = None,
) -> CreditTransaction:
    """Internal helper: cập nhật balance + ghi log atomically.

    Caller phải gọi await db.commit() sau.
    """
    new_balance = (user.credit_balance or 0) + delta
    if new_balance < 0:
        raise ValueError(f"Insufficient credits: balance={user.credit_balance}, delta={delta}")
    user.credit_balance = new_balance
    tx = CreditTransaction(
        user_id=user.id,
        kind=kind,
        delta=delta,
        balance_after=new_balance,
        ref_id=ref_id,
        note=note,
    )
    db.add(tx)
    return tx


async def apply_topup(
    db: AsyncSession,
    *,
    user: User,
    pack_id: str,
    payment_ref: str,
) -> dict:
    """Gọi từ billing.confirm_payment khi payment kind=credits paid.

    Cộng base + bonus credits vào balance, ghi log topup_paid.
    """
    pack = await get_pack(db, pack_id)
    if not pack:
        raise ValueError(f"Credit pack '{pack_id}' không tồn tại.")
    total = (pack.base_credits or 0) + (pack.bonus_credits or 0)
    tx = await _record_transaction(
        db,
        user=user,
        kind="topup_paid",
        delta=total,
        ref_id=payment_ref,
        note=f"Mua gói {pack.name}: +{pack.base_credits:,} credits"
             + (f" (+{pack.bonus_credits:,} bonus)" if pack.bonus_credits else ""),
    )
    logger.info("Topup applied: user=%d pack=%s +%d credits → balance=%d",
                user.id, pack_id, total, user.credit_balance)
    return _tx_to_dict(tx)


async def try_consume(
    db: AsyncSession,
    *,
    user: User,
    amount: int,
    kind: str = "consume_tts",
    ref_id: str | None = None,
    note: str | None = None,
) -> dict:
    """Trừ `amount` credits. Raise QuotaExceeded nếu không đủ.

    Caller phải đảm bảo monthly quota đã hết / không áp dụng. Service
    này CHỈ động vào credit_balance, không quan tâm subscription quota.
    """
    if amount <= 0:
        raise ValueError("amount phải > 0")
    if (user.credit_balance or 0) < amount:
        raise QuotaExceeded(
            f"Không đủ credits: cần {amount:,}, hiện {user.credit_balance:,}"
        )
    tx = await _record_transaction(
        db, user=user, kind=kind, delta=-amount, ref_id=ref_id, note=note,
    )
    return _tx_to_dict(tx)


async def admin_adjust(
    db: AsyncSession,
    *,
    user: User,
    delta: int,
    note: str,
    admin_id: int,
) -> dict:
    """Admin manual adjust (refund, bonus, debug, ...)."""
    tx = await _record_transaction(
        db,
        user=user,
        kind="admin_adjust",
        delta=delta,
        ref_id=f"admin:{admin_id}",
        note=note,
    )
    logger.info("Admin %d adjusted user=%d by %+d → balance=%d (%s)",
                admin_id, user.id, delta, user.credit_balance, note)
    return _tx_to_dict(tx)


async def signup_bonus(
    db: AsyncSession,
    *,
    user: User,
    amount: int = 5_000,
) -> None:
    """Tặng credits welcome khi user đăng ký. Idempotent: skip nếu user đã có balance."""
    if (user.credit_balance or 0) > 0:
        return
    await _record_transaction(
        db,
        user=user,
        kind="signup_bonus",
        delta=amount,
        note=f"Tặng {amount:,} credits chào mừng",
    )
    logger.info("Signup bonus: user=%d +%d credits", user.id, amount)
