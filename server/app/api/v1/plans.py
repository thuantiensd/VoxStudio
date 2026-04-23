"""Public pricing endpoint — frontend hiển thị gói + LTD promotions."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.services import plan_svc

router = APIRouter(prefix="/plans", tags=["Plans"])


@router.get("")
async def list_plans(db: AsyncSession = Depends(get_session)):
    """Trả về tất cả plan active — không cần auth, hiện ở landing + billing tab."""
    plans = await plan_svc.get_all_plans(db, only_active=True)
    return {"plans": [p.to_dict() for p in plans]}
