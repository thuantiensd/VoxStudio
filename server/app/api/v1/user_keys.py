"""User API keys endpoints — BYOK per-user, encrypted server-side.

Endpoints:
  GET    /user/api-keys                     — list providers + status
  PUT    /user/api-keys/:provider           — save/update key
  POST   /user/api-keys/:provider/test      — test key valid không
  DELETE /user/api-keys/:provider           — xoá key
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db.models import User
from app.db.session import get_session
from app.services import api_key_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user/api-keys", tags=["User API Keys"])


class SetKeyBody(BaseModel):
    api_key: str


@router.get("")
async def list_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List tất cả providers user đã setup + test status."""
    keys = await api_key_svc.list_user_keys(db, user.id)
    return {
        "supported_providers": sorted(api_key_svc.SUPPORTED_PROVIDERS),
        "keys": keys,
    }


@router.put("/{provider}")
async def set_key(
    provider: str,
    body: SetKeyBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Save/update API key cho provider."""
    if provider not in api_key_svc.SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"Provider không support: {provider}")
    if not body.api_key or len(body.api_key.strip()) < 8:
        raise HTTPException(400, "API key quá ngắn / rỗng")
    try:
        row = await api_key_svc.set_user_key(db, user.id, provider, body.api_key)
        return {"ok": True, "key": row.public_dict()}
    except Exception as e:
        logger.exception("set_key failed")
        raise HTTPException(500, f"Lưu key fail: {e}")


@router.post("/{provider}/test")
async def test_key(
    provider: str,
    body: SetKeyBody | None = Body(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Test key cho provider. Nếu body.api_key truyền → test key đó (UI chưa
    save). Nếu không → test key đã lưu trong DB.
    """
    if provider not in api_key_svc.SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"Provider không support: {provider}")

    # Pick key: body trước, fallback DB
    key_to_test: str | None = None
    if body and body.api_key:
        key_to_test = body.api_key.strip()
    else:
        key_to_test = await api_key_svc.get_user_key(db, user.id, provider)

    if not key_to_test:
        raise HTTPException(400, "Chưa có key để test")

    # Test trong thread (network I/O)
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(
        None, api_key_svc.test_provider_key, provider, key_to_test,
    )

    # Update DB status nếu test key đã lưu (không phải key body mới)
    if not (body and body.api_key):
        status = "ok" if ok else "invalid"
        await api_key_svc.update_test_status(db, user.id, provider, status, msg)

    return {"ok": ok, "message": msg}


@router.delete("/{provider}")
async def delete_key(
    provider: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Xoá key của provider."""
    if provider not in api_key_svc.SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"Provider không support: {provider}")
    deleted = await api_key_svc.delete_user_key(db, user.id, provider)
    return {"ok": True, "deleted": deleted}
