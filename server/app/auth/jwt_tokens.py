"""JWT issue + verify."""

import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt

# Load từ env; nếu thiếu → tạo random dev-only secret (warning: reset mỗi restart)
_DEFAULT_SECRET = "dev-only-" + secrets.token_urlsafe(24)
JWT_SECRET = os.environ.get("JWT_SECRET") or _DEFAULT_SECRET
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7


def create_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict | None:
    """Return decoded payload hoặc None nếu invalid/expired."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
