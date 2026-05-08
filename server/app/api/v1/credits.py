"""Credits API — credit balance, packs catalog, topup, history."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_verified
from app.db.models import User
from app.db.session import get_session
from app.services import billing_svc, credit_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/credits", tags=["Credits"])


@router.get("/packs")
async def list_packs(db: AsyncSession = Depends(get_session)):
    """Public list of credit packs cho pricing page."""
    return {"packs": await credit_svc.list_packs(db)}


@router.get("/balance")
async def get_balance(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    return {"balance": await credit_svc.get_balance(db, user.id)}


@router.get("/transactions")
async def list_transactions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    return {"transactions": await credit_svc.list_transactions(db, user.id)}


class TopupRequest(BaseModel):
    pack_id: str


@router.post("/topup")
async def topup(
    body: TopupRequest,
    user: User = Depends(require_verified),
    db: AsyncSession = Depends(get_session),
):
    """Tạo payment intent kind=credits cho 1 pack. Trả ref_code + bank info + QR."""
    if not billing_svc.is_configured():
        raise HTTPException(
            503,
            "Hệ thống thanh toán chưa được cấu hình. Vui lòng liên hệ hỗ trợ.",
        )
    try:
        payment = await billing_svc.create_credit_topup(
            db, user=user, pack_id=body.pack_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "payment": payment,
        "bank": billing_svc.bank_info(),
        "qr_url": billing_svc._qr_url(payment["amount_vnd"], payment["ref_code"]),
    }
