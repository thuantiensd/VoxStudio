"""Billing service — manual bank transfer payments.

Flow:
  1. User chọn gói → POST /billing/checkout → tạo Payment row status=pending,
     trả về ref_code + bank info.
  2. User chuyển khoản với memo = ref_code.
  3. Admin nhận tiền, vào /admin/payments/{id}/confirm → status=paid +
     update user.plan = plan_id (+ user.plan_expires_at = +30 days nếu
     subscription, None nếu LTD).
  4. User refresh app, /auth/me trả plan mới → có quyền dùng feature trả phí.

Không tự động hoá webhook ngân hàng (đợi scale lớn). Hiện admin manual
confirm — phù hợp launch nhỏ.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime
from typing import Any

from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import CreditPack, Payment, Plan, User
from app.services import email_svc, plan_svc

logger = logging.getLogger(__name__)


def bank_info() -> dict:
    """Đọc bank config từ env. Trả None values nếu chưa setup."""
    return {
        "name":         os.environ.get("BANK_NAME", "").strip(),
        "bin":          os.environ.get("BANK_BIN", "").strip(),
        "account_no":   os.environ.get("BANK_ACCOUNT_NO", "").strip(),
        "account_name": os.environ.get("BANK_ACCOUNT_NAME", "").strip(),
    }


def is_configured() -> bool:
    info = bank_info()
    return bool(info["name"] and info["account_no"])


def _new_ref_code() -> str:
    """8 ký tự alphanumeric upper — dễ gõ trong memo banking. VD VOXA1B2C3."""
    rand = secrets.token_urlsafe(6).replace("-", "").replace("_", "").upper()[:6]
    return f"VOX{rand}"


def _qr_url(amount_vnd: int, ref_code: str) -> str | None:
    """Build VietQR image URL — render QR đầy đủ amount + memo.
    Format: https://img.vietqr.io/image/<BIN>-<ACCOUNT>-compact2.png
            ?amount=N&addInfo=<memo>&accountName=<name>
    """
    info = bank_info()
    if not info["bin"] or not info["account_no"]:
        return None
    from urllib.parse import quote
    url = (
        f"https://img.vietqr.io/image/{info['bin']}-{info['account_no']}-compact2.png"
        f"?amount={amount_vnd}&addInfo={quote(ref_code)}"
    )
    if info["account_name"]:
        url += f"&accountName={quote(info['account_name'])}"
    return url


async def create_payment(
    db: AsyncSession,
    *,
    user: User,
    plan_id: str,
    is_ltd: bool = False,
) -> dict:
    """Tạo Payment row pending. Lock giá VND + USD tại thời điểm checkout."""
    plan = await plan_svc.get_plan(db, plan_id)
    if not plan:
        raise ValueError(f"Gói '{plan_id}' không tồn tại.")
    if plan_id == "free":
        raise ValueError("Gói miễn phí không cần thanh toán.")

    # Lock giá tại thời điểm checkout — VND tính live theo FX, USD từ DB
    if is_ltd:
        if not plan.ltd_price_vnd or plan.ltd_price_vnd <= 0:
            raise ValueError(f"Gói {plan.name} không có ưu đãi trọn đời.")
        if plan.ltd_slots_available <= 0:
            raise ValueError(f"Gói {plan.name} đã hết suất trọn đời.")
        # Compute live VND
        from app.services import fx_rate_svc
        amount_vnd = (
            fx_rate_svc.usd_cents_to_vnd(plan.ltd_price_usd)
            if plan.ltd_price_usd > 0 else plan.ltd_price_vnd
        ) or plan.ltd_price_vnd
        amount_usd = plan.ltd_price_usd
    else:
        from app.services import fx_rate_svc
        amount_vnd = (
            fx_rate_svc.usd_cents_to_vnd(plan.price_usd)
            if plan.price_usd > 0 else plan.price_vnd
        ) or plan.price_vnd
        amount_usd = plan.price_usd

    # Auto-cancel mọi pending cũ của user — tránh tình huống user
    # checkout 2 gói khác nhau, admin confirm cả 2 → ghi đè plan.
    # Lần checkout sau coi như intent thật sự của user.
    old_pending = (await db.execute(
        select(Payment).where(
            Payment.user_id == user.id,
            Payment.status == "pending",
        )
    )).scalars().all()
    for op in old_pending:
        op.status = "cancelled"
        op.note = (op.note or "") + " [auto-huỷ: user tạo giao dịch mới]"
        logger.info("Auto-cancel old pending: %s (user=%d)", op.id, user.id)

    # Sinh ref_code unique (retry nếu trùng — cực hiếm)
    for _ in range(5):
        ref_code = _new_ref_code()
        if not await db.get(Payment, ref_code):
            break
    else:
        raise RuntimeError("Không tạo được mã thanh toán, hãy thử lại.")

    payment = Payment(
        id=ref_code,
        user_id=user.id,
        plan_id=plan_id,
        amount_vnd=amount_vnd,
        amount_usd=amount_usd,
        is_ltd=is_ltd,
        status="pending",
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    logger.info("Payment created: %s user=%d plan=%s vnd=%d ltd=%s",
                ref_code, user.id, plan_id, amount_vnd, is_ltd)
    return _to_dict(payment)


def _to_dict(p: Payment) -> dict:
    return {
        "id": p.id,
        "ref_code": p.id,
        "kind": getattr(p, "kind", "subscription") or "subscription",
        "plan_id": p.plan_id,
        "credits_amount": getattr(p, "credits_amount", 0) or 0,
        "amount_vnd": p.amount_vnd,
        "amount_usd": p.amount_usd,
        "is_ltd": bool(p.is_ltd),
        "status": p.status,
        "note": p.note,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
    }


async def create_credit_topup(
    db: AsyncSession,
    *,
    user: User,
    pack_id: str,
) -> dict:
    """Tạo Payment row pending kind='credits' cho 1 credit pack."""
    pack = await db.get(CreditPack, pack_id)
    if not pack or not pack.is_active:
        raise ValueError(f"Gói credits '{pack_id}' không tồn tại.")

    # Lock giá tại thời điểm checkout
    from app.services import fx_rate_svc
    amount_vnd = (
        fx_rate_svc.usd_cents_to_vnd(pack.price_usd)
        if pack.price_usd > 0 else pack.price_vnd
    ) or pack.price_vnd
    amount_usd = pack.price_usd
    total_credits = (pack.base_credits or 0) + (pack.bonus_credits or 0)

    # Auto-cancel pending khác (chung policy với create_payment)
    old_pending = (await db.execute(
        select(Payment).where(
            Payment.user_id == user.id,
            Payment.status == "pending",
        )
    )).scalars().all()
    for op in old_pending:
        op.status = "cancelled"
        op.note = (op.note or "") + " [auto-huỷ: user tạo giao dịch mới]"

    for _ in range(5):
        ref_code = _new_ref_code()
        if not await db.get(Payment, ref_code):
            break
    else:
        raise RuntimeError("Không tạo được mã thanh toán, hãy thử lại.")

    payment = Payment(
        id=ref_code,
        user_id=user.id,
        kind="credits",
        plan_id=pack_id,
        credits_amount=total_credits,
        amount_vnd=amount_vnd,
        amount_usd=amount_usd,
        is_ltd=False,
        status="pending",
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    logger.info("Credit topup created: %s user=%d pack=%s vnd=%d credits=%d",
                ref_code, user.id, pack_id, amount_vnd, total_credits)
    return _to_dict(payment)


async def list_payments(db: AsyncSession, user_id: int, limit: int = 50) -> list[dict]:
    q = (
        select(Payment)
        .where(Payment.user_id == user_id)
        .order_by(desc(Payment.created_at))
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [_to_dict(p) for p in rows]


async def cancel_payment(db: AsyncSession, ref_code: str, user_id: int) -> bool:
    """User huỷ payment pending của chính mình."""
    p = await db.get(Payment, ref_code)
    if not p or p.user_id != user_id:
        raise ValueError("Không tìm thấy giao dịch.")
    if p.status != "pending":
        raise ValueError(f"Không thể huỷ giao dịch đã {p.status}.")
    p.status = "cancelled"
    await db.commit()
    return True


async def admin_reject_payment(
    db: AsyncSession, *, ref_code: str, note: str | None = None,
) -> dict:
    """Admin từ chối payment pending (sai số tiền, không tìm thấy giao dịch, ...)."""
    p = await db.get(Payment, ref_code)
    if not p:
        raise ValueError("Giao dịch không tồn tại.")
    if p.status != "pending":
        raise ValueError(f"Không thể từ chối giao dịch đã {p.status}.")
    p.status = "cancelled"
    if note:
        p.note = note
    await db.commit()
    return _to_dict(p)


async def confirm_payment(
    db: AsyncSession,
    *,
    ref_code: str,
    admin_id: int,
    note: str | None = None,
) -> dict:
    """Admin confirm payment → activate plan trên user."""
    p = await db.get(Payment, ref_code)
    if not p:
        raise ValueError("Giao dịch không tồn tại.")
    if p.status == "paid":
        raise ValueError("Giao dịch đã được xác nhận trước đó.")
    if p.status == "cancelled":
        raise ValueError("Giao dịch đã bị huỷ.")

    user = await db.get(User, p.user_id)
    if not user:
        raise ValueError("User không tồn tại (đã xoá tài khoản?).")

    p.status = "paid"
    p.paid_at = datetime.utcnow()
    p.confirmed_by = admin_id
    if note:
        p.note = note

    is_credits = (getattr(p, "kind", "subscription") or "subscription") == "credits"

    if is_credits:
        # Topup credits → cộng vào balance + ghi transaction
        from app.services import credit_svc
        await credit_svc.apply_topup(
            db, user=user, pack_id=p.plan_id, payment_ref=p.id,
        )
        plan_display_name = f"Credits {p.plan_id}"
    else:
        # Subscription/LTD → activate plan + set expiration
        from datetime import timedelta
        user.plan = p.plan_id
        if p.is_ltd:
            user.plan_expires_at = None  # lifetime
        else:
            # +30 ngày từ now (hoặc từ expires_at hiện tại nếu còn hạn)
            now = datetime.utcnow()
            base = user.plan_expires_at if (
                user.plan_expires_at and user.plan_expires_at > now
            ) else now
            user.plan_expires_at = base + timedelta(days=30)

        plan_row = await db.get(Plan, p.plan_id)
        if p.is_ltd and plan_row:
            plan_row.ltd_slots_taken = (plan_row.ltd_slots_taken or 0) + 1
        plan_display_name = (plan_row.name if plan_row else p.plan_id).strip() or p.plan_id

    # Safety net: auto-huỷ mọi pending KHÁC của cùng user.
    # (`create_payment` đã chặn ở khâu checkout, đây là phòng cho dữ liệu cũ.)
    cancelled_others = 0
    other_pendings = (await db.execute(
        select(Payment).where(
            Payment.user_id == user.id,
            Payment.status == "pending",
            Payment.id != p.id,
        )
    )).scalars().all()
    for op in other_pendings:
        op.status = "cancelled"
        op.note = (op.note or "") + f" [auto-huỷ: đã xác nhận giao dịch {p.id}]"
        cancelled_others += 1

    await db.commit()
    if cancelled_others:
        logger.info("Confirm %s → auto-cancelled %d other pending(s) of user=%d",
                    ref_code, cancelled_others, user.id)

    # Gửi email xác nhận — fire-and-forget, không block response.
    if user.email:
        try:
            import asyncio
            subject, html, text = email_svc.payment_confirmed_email(
                name=(user.name or user.email.split("@")[0]),
                plan_name=plan_display_name,
                ref_code=p.id,
                amount_vnd=p.amount_vnd,
                is_ltd=bool(p.is_ltd),
            )
            asyncio.create_task(
                email_svc.send_email(user.email, subject, html, text)
            )
        except Exception as e:
            logger.warning("Failed to dispatch payment-confirmed email: %s", e)
    logger.info("Payment confirmed: %s by admin=%d → user=%d plan=%s",
                ref_code, admin_id, user.id, user.plan)
    return _to_dict(p)


async def list_pending_for_admin(db: AsyncSession, limit: int = 100) -> list[dict]:
    """Admin xem tất cả payment pending."""
    q = (
        select(Payment, User)
        .join(User, User.id == Payment.user_id)
        .where(Payment.status == "pending")
        .order_by(desc(Payment.created_at))
        .limit(limit)
    )
    rows = (await db.execute(q)).all()
    out = []
    for payment, user in rows:
        d = _to_dict(payment)
        d["user_id"] = user.id
        d["user_email"] = user.email
        d["user_name"] = user.name
        out.append(d)
    return out
