"""FastAPI dependencies: current user, optional auth."""

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_session
from app.db.models import User
from .jwt_tokens import verify_token


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> User:
    """Require valid JWT. 401 nếu thiếu/invalid."""
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    token = auth[7:]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user_id = int(payload.get("sub", 0))
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


async def get_current_user_optional(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> User | None:
    """Optional — trả None nếu không có token, không raise."""
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    payload = verify_token(auth[7:])
    if not payload:
        return None
    return await db.get(User, int(payload.get("sub", 0)))
