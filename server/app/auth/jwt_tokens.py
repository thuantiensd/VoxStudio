"""JWT issue + verify."""

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt

logger = logging.getLogger(__name__)

# Load từ env; nếu thiếu → tạo random dev-only secret (warning: reset mỗi restart)
_DEFAULT_SECRET = "dev-only-" + secrets.token_urlsafe(24)
_env_secret = os.environ.get("JWT_SECRET")
JWT_SECRET = _env_secret or _DEFAULT_SECRET
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

# Debug log để nhận biết .env có load đúng lúc import không
if _env_secret:
    logger.warning("[jwt_tokens] JWT_SECRET loaded from env (prefix=%s..., len=%d)",
                   _env_secret[:8], len(_env_secret))
else:
    logger.error("[jwt_tokens] WARNING: JWT_SECRET not in env, using random fallback "
                 "(prefix=%s...) — tokens invalidate on every restart!",
                 _DEFAULT_SECRET[:12])


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
    except jwt.PyJWTError as e:
        logger.warning("[jwt_tokens] verify FAILED — secret_prefix=%s err=%s token_prefix=%s",
                       JWT_SECRET[:8], type(e).__name__, token[:30] if token else "")
        return None


def create_token_debug_secret() -> str:
    """Helper expose secret prefix cho /auth/login log — dev only."""
    return JWT_SECRET[:8]
