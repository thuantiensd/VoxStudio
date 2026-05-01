"""HMAC signed URLs for audio outputs.

Mục đích: file_id audio được sinh random nhưng nếu URL bị chia sẻ/log thì
ai cũng có thể tải. Signed URL gắn HMAC + expiry + user_id → ngăn share + leak.

Signature scheme:
  sig = HMAC-SHA256(key=JWT_SECRET, msg=f"{file_id}|{user_id}|{exp}")[:24]
  URL: /api/v1/tts/audio/{file_id}?u={user_id}&exp={timestamp}&sig={hex24}

Verify:
  - exp > now (URL chưa hết hạn)
  - user_id khớp với user request (hoặc admin)
  - sig khớp HMAC computed → URL chưa bị tampered

TTL mặc định 1 giờ — đủ cho UI play, không đủ để phát tán dài hạn.
"""

from __future__ import annotations

import hmac
import hashlib
import time
from typing import Optional

from fastapi import HTTPException

from app.auth.jwt_tokens import JWT_SECRET  # tận dụng key sẵn có


SIG_LEN = 24  # 24 hex chars = 96 bits, đủ chống brute force


def _compute(file_id: str, user_id: int, exp: int) -> str:
    msg = f"{file_id}|{user_id}|{exp}".encode("utf-8")
    digest = hmac.new(JWT_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return digest[:SIG_LEN]


def sign(file_id: str, user_id: int, ttl_seconds: int = 3600) -> dict:
    """Sinh signature cho audio URL. Trả dict các query param."""
    exp = int(time.time()) + ttl_seconds
    sig = _compute(file_id, user_id, exp)
    return {"u": str(user_id), "exp": str(exp), "sig": sig}


def signed_url(file_id: str, user_id: int, ttl_seconds: int = 3600) -> str:
    """Build full signed URL path (relative)."""
    p = sign(file_id, user_id, ttl_seconds)
    qs = "&".join(f"{k}={v}" for k, v in p.items())
    return f"/api/v1/tts/audio/{file_id}?{qs}"


def verify(
    file_id: str,
    user_id_request: int,
    *,
    sig: Optional[str] = None,
    u: Optional[str] = None,
    exp: Optional[str] = None,
    is_admin: bool = False,
) -> None:
    """Raise HTTPException 403 nếu sig không hợp lệ.

    user_id_request: id của user đang gọi (lấy từ JWT).
    is_admin: True → bypass user_id check (admin xem mọi audio để debug).
    """
    if not sig or not u or not exp:
        raise HTTPException(status_code=403, detail="Missing signature")
    try:
        u_int = int(u)
        exp_int = int(exp)
    except (ValueError, TypeError):
        raise HTTPException(status_code=403, detail="Invalid signature")
    # Expired?
    if exp_int < int(time.time()):
        raise HTTPException(status_code=403, detail="Signature expired")
    # User mismatch (admin bypass)
    if u_int != user_id_request and not is_admin:
        raise HTTPException(status_code=403, detail="Signature user mismatch")
    # Compute expected
    expected = _compute(file_id, u_int, exp_int)
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=403, detail="Invalid signature")
