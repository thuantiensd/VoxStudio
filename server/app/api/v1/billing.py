"""Billing API — manual bank transfer payments.

Endpoints:
  POST /billing/checkout       — User tạo payment intent, nhận bank info + QR
  GET  /billing/payments       — User xem lịch sử
  POST /billing/payments/{id}/cancel — User huỷ pending
  GET  /billing/bank           — Public bank info (không yêu cầu auth)

Admin:
  GET  /admin/payments              — list all (filter status)
  POST /admin/payments/{id}/confirm — confirm payment (kích hoạt plan)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_verified
from app.db.models import User
from app.db.session import get_session
from app.services import billing_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["Billing"])


class CheckoutRequest(BaseModel):
    plan_id: str
    is_ltd: bool = False


@router.get("/bank")
async def get_bank_info():
    """Public bank info — frontend show trên payment modal."""
    info = billing_svc.bank_info()
    return {
        "configured": billing_svc.is_configured(),
        "name": info["name"],
        "bin": info["bin"],
        "account_no": info["account_no"],
        "account_name": info["account_name"],
    }


@router.post("/checkout")
async def checkout(
    body: CheckoutRequest,
    user: User = Depends(require_verified),
    db: AsyncSession = Depends(get_session),
):
    """Tạo payment intent. Trả về ref_code + bank info + QR URL."""
    if not billing_svc.is_configured():
        raise HTTPException(
            503,
            "Hệ thống thanh toán chưa được cấu hình. Vui lòng liên hệ hỗ trợ.",
        )
    try:
        payment = await billing_svc.create_payment(
            db, user=user, plan_id=body.plan_id, is_ltd=body.is_ltd,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "payment": payment,
        "bank": billing_svc.bank_info(),
        "qr_url": billing_svc._qr_url(payment["amount_vnd"], payment["ref_code"]),
    }


@router.get("/payments")
async def list_my_payments(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    return {"payments": await billing_svc.list_payments(db, user.id)}


@router.get("/payments/{ref_code}")
async def get_my_payment(
    ref_code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Xem lại 1 payment cụ thể của user — không tạo mới, không huỷ pending khác.
    Dùng khi user click 'Xem QR' trên trang account để mở lại VietQR mà không
    trigger create_payment (sẽ auto-huỷ pending cũ)."""
    from app.db.models import Payment
    p = await db.get(Payment, ref_code)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Không tìm thấy giao dịch.")
    payment_dict = billing_svc._to_dict(p)
    return {
        "payment": payment_dict,
        "bank": billing_svc.bank_info(),
        "qr_url": billing_svc._qr_url(p.amount_vnd, p.id),
    }


@router.post("/payments/{ref_code}/cancel")
async def cancel_my_payment(
    ref_code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    try:
        await billing_svc.cancel_payment(db, ref_code, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}
