"""API key storage service — encrypt + store per-user keys cho cloud engines.

Mục đích: user chỉ nhập key 1 lần, server lưu encrypted, reuse cho mọi job.
Encrypt: Fernet (cryptography), key derive từ JWT_SECRET (SHA256 → 32 bytes).

Providers support: gemini / openai / claude / deepl / google_cloud
"""
from __future__ import annotations

import base64
import hashlib
import logging
from datetime import datetime
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt_tokens import JWT_SECRET
from app.db.models import UserApiKey

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = {"gemini", "openai", "claude", "deepl", "google_cloud"}


def _fernet() -> Fernet:
    """Derive Fernet key từ JWT_SECRET (đảm bảo restart server vẫn decrypt được)."""
    digest = hashlib.sha256(JWT_SECRET.encode("utf-8")).digest()  # 32 bytes
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_key(plaintext: str) -> str:
    """Encrypt API key → base64 string lưu DB."""
    if not plaintext:
        raise ValueError("API key rỗng")
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_key(ciphertext: str) -> str:
    """Decrypt — raise InvalidToken nếu corrupt/wrong key."""
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.error("API key decrypt failed — JWT_SECRET có thể đã đổi?")
        return ""


async def get_user_key(db: AsyncSession, user_id: int, provider: str) -> Optional[str]:
    """Lấy key (decrypted) cho user + provider. None nếu chưa có."""
    if provider not in SUPPORTED_PROVIDERS:
        return None
    stmt = select(UserApiKey).where(
        UserApiKey.user_id == user_id, UserApiKey.provider == provider,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row or not row.encrypted_key:
        return None
    return decrypt_key(row.encrypted_key) or None


async def set_user_key(db: AsyncSession, user_id: int, provider: str,
                        plaintext_key: str) -> UserApiKey:
    """Save/update key. Reset test_status về "untested"."""
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Provider không support: {provider}")

    stmt = select(UserApiKey).where(
        UserApiKey.user_id == user_id, UserApiKey.provider == provider,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    encrypted = encrypt_key(plaintext_key.strip())

    if row:
        row.encrypted_key = encrypted
        row.test_status = "untested"
        row.test_message = ""
        row.updated_at = datetime.utcnow()
    else:
        row = UserApiKey(
            user_id=user_id, provider=provider,
            encrypted_key=encrypted, test_status="untested",
        )
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_user_key(db: AsyncSession, user_id: int, provider: str) -> bool:
    """Xoá key. Trả True nếu có key, False nếu chưa có."""
    stmt = select(UserApiKey).where(
        UserApiKey.user_id == user_id, UserApiKey.provider == provider,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def list_user_keys(db: AsyncSession, user_id: int) -> list[dict]:
    """List tất cả providers user đã setup. KHÔNG trả key plaintext."""
    stmt = select(UserApiKey).where(UserApiKey.user_id == user_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [r.public_dict() for r in rows]


async def update_test_status(db: AsyncSession, user_id: int, provider: str,
                              status: str, message: str = "") -> None:
    """Update test result (ok/invalid/error) sau khi test."""
    stmt = select(UserApiKey).where(
        UserApiKey.user_id == user_id, UserApiKey.provider == provider,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        return
    row.test_status = status[:20]
    row.test_message = message[:300]
    row.last_tested_at = datetime.utcnow()
    await db.commit()


# ═══════════════════════════════════════════════════════════════
# Test key endpoint — gọi từng provider 1 request nhỏ để verify
# ═══════════════════════════════════════════════════════════════

def test_provider_key(provider: str, api_key: str) -> tuple[bool, str]:
    """Test key có valid không. Trả (ok, message).

    Mỗi provider gọi endpoint test riêng (cheap call):
    - gemini: list models
    - openai: list models
    - claude: short messages API call
    - deepl: usage endpoint
    - google_cloud: detect language
    """
    if not api_key or len(api_key) < 8:
        return False, "Key quá ngắn"

    import httpx
    api_key = api_key.strip()

    try:
        if provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            with httpx.Client(timeout=10) as c:
                r = c.get(url)
            if r.status_code == 200:
                return True, "Key Gemini hợp lệ"
            if r.status_code in (401, 403):
                return False, "Key Gemini không hợp lệ"
            return False, f"Gemini trả {r.status_code}"

        if provider == "openai":
            with httpx.Client(timeout=10) as c:
                r = c.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
            if r.status_code == 200:
                return True, "Key OpenAI hợp lệ"
            if r.status_code == 401:
                return False, "Key OpenAI không hợp lệ"
            return False, f"OpenAI trả {r.status_code}"

        if provider == "claude":
            # Claude không có list models endpoint — gọi messages với 1 token
            with httpx.Client(timeout=15) as c:
                r = c.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "claude-3-5-haiku-20241022",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
            if r.status_code == 200:
                return True, "Key Claude hợp lệ"
            if r.status_code == 401:
                return False, "Key Claude không hợp lệ"
            if r.status_code == 402:
                return False, "Claude hết credit"
            return False, f"Claude trả {r.status_code}"

        if provider == "deepl":
            base = "https://api-free.deepl.com" if api_key.endswith(":fx") \
                else "https://api.deepl.com"
            with httpx.Client(timeout=10) as c:
                r = c.get(
                    f"{base}/v2/usage",
                    headers={"Authorization": f"DeepL-Auth-Key {api_key}"},
                )
            if r.status_code == 200:
                return True, "Key DeepL hợp lệ"
            if r.status_code in (401, 403):
                return False, "Key DeepL không hợp lệ"
            return False, f"DeepL trả {r.status_code}"

        if provider == "google_cloud":
            url = "https://translation.googleapis.com/language/translate/v2/languages"
            with httpx.Client(timeout=10) as c:
                r = c.get(url, params={"key": api_key, "target": "en"})
            if r.status_code == 200:
                return True, "Key Google Cloud hợp lệ"
            if r.status_code in (400, 401, 403):
                return False, "Key Google Cloud không hợp lệ"
            return False, f"Google Cloud trả {r.status_code}"

        return False, f"Provider không support: {provider}"
    except httpx.TimeoutException:
        return False, "Timeout — kiểm tra mạng"
    except Exception as e:
        return False, f"Lỗi: {type(e).__name__}: {e}"
