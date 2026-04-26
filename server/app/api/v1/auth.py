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
from app.services import audit_svc, plan_svc, usage_svc, feature_flag_svc, email_svc
import os
import secrets

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

    # OTP 6 chữ số (admin auto-verified, không cần OTP)
    otp = None if role == "admin" else f"{secrets.randbelow(1000000):06d}"
    user = User(
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        name=body.name.strip(),
        plan="free",
        role=role,
        last_active_at=datetime.utcnow(),
        email_verified=(role == "admin"),
        verify_token=otp,
        verify_sent_at=datetime.utcnow() if otp else None,
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

    # Gửi OTP qua email (non-blocking — không fail register nếu SMTP down)
    if otp:
        subject, html, txt = email_svc.verification_email(user.name, otp)
        try:
            await email_svc.send_email(user.email, subject, html, txt)
        except Exception as e:
            logger.warning("Send verification email failed: %s", e)

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


def _new_otp() -> str:
    """6 chữ số ngẫu nhiên, không bias. Trả str đã pad zero."""
    return f"{secrets.randbelow(1000000):06d}"


class VerifyOtpRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


@router.post("/verify-otp")
async def verify_otp(
    body: VerifyOtpRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """User submit OTP 6 chữ số từ app. Trả {ok: true} + user (đã verified)."""
    if user.email_verified:
        return {"ok": True, "user": user.public_dict()}

    code = (body.code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "Mã OTP phải là 6 chữ số.")

    if not user.verify_token or user.verify_token != code:
        raise HTTPException(400, "Mã OTP không đúng. Hãy thử lại hoặc yêu cầu mã mới.")

    # OTP có hiệu lực 10 phút
    if user.verify_sent_at:
        age = (datetime.utcnow() - user.verify_sent_at).total_seconds()
        if age > 10 * 60:
            raise HTTPException(400, "Mã OTP đã hết hạn (>10 phút). Hãy yêu cầu mã mới.")

    user.email_verified = True
    user.verify_token = None
    user.verify_sent_at = None
    await db.commit()
    await audit_svc.log(
        db, user_id=user.id, action="email_verified",
        ip=_client_ip(request),
    )
    logger.info("Email verified via OTP: %s", user.email)
    return {"ok": True, "user": user.public_dict()}


@router.post("/resend-verification")
async def resend_verification(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """User chưa verify → gửi lại email. Rate limit: 1 lần / 60 giây."""
    if user.email_verified:
        return {"ok": True, "already_verified": True}
    if user.verify_sent_at:
        age = (datetime.utcnow() - user.verify_sent_at).total_seconds()
        if age < 60:
            wait = int(60 - age)
            raise HTTPException(429, f"Vui lòng đợi {wait}s rồi thử lại.")

    user.verify_token = _new_otp()
    user.verify_sent_at = datetime.utcnow()
    await db.commit()

    subject, html, txt = email_svc.verification_email(user.name, user.verify_token)
    sent = await email_svc.send_email(user.email, subject, html, txt)
    if not sent:
        raise HTTPException(503, "Không gửi được email lúc này. Vui lòng thử lại sau.")
    return {"ok": True}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """Gửi email reset password. KHÔNG báo email tồn tại hay không (để
    chống enumeration). Luôn trả {ok: true}."""
    user = await db.scalar(
        select(User).where(User.email == body.email.lower().strip())
    )
    if user and not user.is_banned:
        # Rate limit: 60s/email
        if user.reset_sent_at:
            age = (datetime.utcnow() - user.reset_sent_at).total_seconds()
            if age < 60:
                # Vẫn trả ok nhưng không gửi email lại
                return {"ok": True}

        user.reset_token = _new_otp()
        user.reset_sent_at = datetime.utcnow()
        await db.commit()

        subject, html, txt = email_svc.password_reset_email(user.name, user.reset_token)
        try:
            await email_svc.send_email(user.email, subject, html, txt)
            await audit_svc.log(
                db, user_id=user.id, action="forgot_password_requested",
                ip=_client_ip(request),
            )
        except Exception as e:
            logger.warning("Send reset email failed: %s", e)
    else:
        # Email không tồn tại → vẫn trả ok (chống user enumeration)
        logger.info("forgot-password for unknown email: %s", body.email)

    return {"ok": True}


class ResetPasswordOtpRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/reset-password")
async def reset_password_submit(
    body: ResetPasswordOtpRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """Verify OTP + email match → update password_hash. Tránh leak nên
    cùng error message cho mọi trường hợp invalid."""
    user = await db.scalar(
        select(User).where(User.email == body.email.lower().strip())
    )
    bad_msg = "Mã không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới."
    if not user or not user.reset_token:
        raise HTTPException(400, bad_msg)

    code = (body.code or "").strip()
    if not code.isdigit() or len(code) != 6 or user.reset_token != code:
        raise HTTPException(400, bad_msg)

    if user.reset_sent_at:
        age = (datetime.utcnow() - user.reset_sent_at).total_seconds()
        if age > 10 * 60:
            raise HTTPException(400, bad_msg)

    user.password_hash = hash_password(body.new_password)
    user.reset_token = None
    user.reset_sent_at = None
    await db.commit()
    await audit_svc.log(
        db, user_id=user.id, action="password_reset",
        ip=_client_ip(request),
    )
    logger.info("Password reset for user %d", user.id)
    return {"ok": True}


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


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128,
                          description="Mật khẩu hiện tại để xác nhận")


@router.delete("/me")
async def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Hard-delete tài khoản user hiện tại + dữ liệu liên quan.

    Cảnh báo: KHÔNG có grace period — xoá ngay lập tức + không recover.
    Frontend phải confirm 2 lớp + nhập lại password.

    Wipe:
    - File embedding voice (`voices/<user_id>/`)
    - DB rows: User, Voice, UsageEvent, Job (cascade qua FK)
    - AuditLog: user_id → NULL (giữ history nhưng anonymize)
    """
    # Xác minh password trước khi xoá (chống CSRF + lỡ tay)
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(403, "Mật khẩu không đúng. Hãy thử lại.")

    user_id = user.id
    await audit_svc.log(
        db, user_id=user_id, action="delete_account",
        ip=_client_ip(request),
    )

    # Wipe voice files trên disk TRƯỚC khi xoá DB row (vì sau khi xoá
    # user, ta vẫn cần biết folder nào để xoá — folder name là user_id).
    try:
        from app.core.storage import delete_user_voices
        n = delete_user_voices(user_id)
        logger.info("delete_account user=%d wiped %d voice files", user_id, n)
    except Exception as e:
        logger.warning("delete_account: voice file cleanup failed: %s", e)

    # Cascade DELETE qua FK: Voice/UsageEvent/Job sẽ tự xoá. AuditLog SET NULL.
    await db.delete(user)
    await db.commit()
    logger.info("delete_account: user %d deleted", user_id)
    return {"ok": True}
