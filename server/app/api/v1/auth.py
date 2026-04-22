"""Auth routes — register, login, me, logout."""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_session
from app.db.models import User
from app.auth.passwords import hash_password, verify_password
from app.auth.jwt_tokens import create_token
from app.auth.deps import get_current_user

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


# ── Routes ─────────────────────────────────────────────────────
@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_session)):
    # Check email đã tồn tại
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Email đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.")
    user = User(
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        plan="free",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_token(user.id, user.email)
    logger.info("User registered: %s (id=%d)", user.email, user.id)
    return {"token": token, "user": user.public_dict()}


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_session)):
    user = await db.scalar(select(User).where(User.email == body.email.lower().strip()))
    if not user or not user.password_hash:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email hoặc mật khẩu không đúng.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email hoặc mật khẩu không đúng.")
    token = create_token(user.id, user.email)
    logger.info("User login: %s", user.email)
    return {"token": token, "user": user.public_dict()}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"user": user.public_dict()}


@router.post("/logout")
async def logout():
    # Stateless JWT — client chỉ cần xoá token. Endpoint ở đây để ghi log + API consistency.
    return {"ok": True}
