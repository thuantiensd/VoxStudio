"""Auth routes — register, login, me, logout."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.db.session import get_session
from app.db.models import User
from app.auth.passwords import hash_password, verify_password
from app.auth.jwt_tokens import create_token
from app.auth.deps import get_current_user
from app.services import audit_svc, plan_svc, usage_svc, feature_flag_svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Auth"])


# ── Schemas ────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email:    EmailStr
    password: str = Field(min_length=8, max_length=128)
    name:     str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email:    EmailStr
    password: str


class AuthResponse(BaseModel):
    token: str
    user:  dict


def _client_ip(req: Request) -> str | None:
    # Hỗ trợ reverse-proxy forward header
    for h in ("x-forwarded-for", "x-real-ip"):
        v = req.headers.get(h)
        if v:
            return v.split(",")[0].strip()
    return req.client.host if req.client else None


# ── Routes ─────────────────────────────────────────────────────
@router.post("/register", response_model=AuthResponse)
async def register(
    body: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Email đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.")

    # First user ever → auto-admin (trường hợp chưa set ADMIN_EMAILS env)
    total_users = await db.scalar(select(User.id).limit(1))
    role = "admin" if total_users is None else "user"

    user = User(
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        plan="free",
        role=role,
        last_active_at=datetime.utcnow(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_token(user.id, user.email)
    logger.info("User registered: %s (id=%d, role=%s)", user.email, user.id, role)
    await audit_svc.log(
        db, user_id=user.id, action="register",
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        metadata={"initial_role": role},
    )
    return {"token": token, "user": user.public_dict()}


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    user = await db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if not user or not user.password_hash:
        await audit_svc.log(
            db, action="login_failed",
            metadata={"email": body.email, "reason": "no_user"},
            ip=_client_ip(request),
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email hoặc mật khẩu không đúng.")
    if not verify_password(body.password, user.password_hash):
        await audit_svc.log(
            db, user_id=user.id, action="login_failed",
            metadata={"reason": "wrong_password"},
            ip=_client_ip(request),
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email hoặc mật khẩu không đúng.")
    if user.is_banned:
        await audit_svc.log(
            db, user_id=user.id, action="login_blocked_banned",
            ip=_client_ip(request),
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Tài khoản đã bị khoá. Vui lòng liên hệ hỗ trợ.",
        )
    # Update last_active_at
    user.last_active_at = datetime.utcnow()
    await db.commit()
    token = create_token(user.id, user.email)
    await audit_svc.log(
        db, user_id=user.id, action="login_success",
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    logger.info("User login: %s", user.email)
    return {"token": token, "user": user.public_dict()}


@router.get("/me")
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Trả user profile + plan info + usage tháng này + feature flags đang bật."""
    # Update last_active_at (không raise nếu fail)
    try:
        user.last_active_at = datetime.utcnow()
        await db.commit()
    except Exception:
        await db.rollback()

    plan = await plan_svc.get_plan(db, user.plan or "free")
    usage = await usage_svc.get_month_summary(db, user.id)
    flags = await feature_flag_svc.list_enabled_for_user(db, user.id)

    return {
        "user": user.public_dict(),
        "plan": plan.to_dict() if plan else None,
        "usage_month": usage,
        "feature_flags": flags,
    }


@router.post("/logout")
async def logout(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    await audit_svc.log(
        db, user_id=user.id, action="logout",
        ip=_client_ip(request),
    )
    return {"ok": True}
