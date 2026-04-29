"""Presigned upload URL endpoint — FE/desktop upload file lớn (audio, video)
TRỰC TIẾP lên R2 private bucket, không proxy qua VPS.

Flow:
  1. Client gọi POST /uploads/presign?kind=audio&filename=ref.wav
  2. API trả {url, key, expires_at} — url là presigned PUT URL có TTL 1h.
  3. Client PUT file lên url đó với Content-Type khớp.
  4. Client gửi `key` về API (vd /tts, /voices/clone) để tạo job; worker
     download file từ R2 bằng key.

So với upload qua VPS: tiết kiệm bandwidth VPS (audio dub có thể 100MB+),
giảm latency, tránh timeout proxy nginx.

Local mode: endpoint trả error 501 — caller phải dùng multipart upload truyền
thống vào endpoint cũ.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.deps import get_current_user
from app.config import STORAGE_BACKEND
from app.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/uploads", tags=["Uploads"])

# Whitelist content type theo kind — block client tự ý upload binary lạ vào
# bucket (rủi ro abuse storage).
_ALLOWED_KIND_CT = {
    "audio": {
        "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
        "audio/ogg", "audio/flac", "audio/webm", "audio/mp4", "audio/m4a",
        "audio/x-m4a", "application/octet-stream",
    },
    "video": {
        "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
        "application/octet-stream",
    },
}

# Max upload size limits (bytes) — server không enforce trực tiếp (presigned
# URL không kẹp size), nhưng FE nên check trước. Đặt ở đây để FE đọc qua
# /uploads/limits nếu cần.
_KIND_MAX_BYTES = {
    "audio": 200 * 1024 * 1024,    # 200 MB
    "video": 1024 * 1024 * 1024,   # 1 GB
}

_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]")


def _safe_basename(filename: str) -> str:
    """Chuẩn hoá filename về dạng an toàn cho R2 key. Cắt path traversal, ký
    tự đặc biệt. Giữ extension."""
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = _SAFE_FILENAME.sub("_", base)[:120]
    return base or "file"


class PresignReq(BaseModel):
    kind: Literal["audio", "video"]
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: Optional[str] = Field(None, max_length=100)


class PresignResp(BaseModel):
    url: str
    key: str
    method: str = "PUT"
    headers: dict
    expires_at: str


@router.post("/presign", response_model=PresignResp)
async def presign_upload(
    req: PresignReq,
    user: User = Depends(get_current_user),
):
    """Cấp presigned PUT URL cho client upload trực tiếp R2 private bucket.

    Key format: `uploads/<user_id>/<yyyymmdd>/<uuid>-<safe-filename>`
    — phân tán theo ngày để dễ apply lifecycle rule (TTL 7 ngày cho prefix).
    """
    if STORAGE_BACKEND != "r2":
        raise HTTPException(
            status_code=501,
            detail="Server đang chạy ở local storage mode. "
                   "Dùng endpoint multipart truyền thống.",
        )

    ct = (req.content_type or "application/octet-stream").lower()
    allowed = _ALLOWED_KIND_CT.get(req.kind, set())
    if ct not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"Content-Type '{ct}' không hợp lệ cho kind={req.kind}",
        )

    safe_name = _safe_basename(req.filename)
    today = datetime.utcnow().strftime("%Y%m%d")
    key = f"uploads/{user.id}/{today}/{uuid.uuid4().hex[:12]}-{safe_name}"

    try:
        from app.core import storage_r2
        url = storage_r2.presigned_put_url(
            key, expires=3600, content_type=ct,
        )
    except Exception as e:
        logger.exception("presign upload failed: %s", e)
        raise HTTPException(500, "Không tạo được upload URL")

    expires_at = (datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z"
    return PresignResp(
        url=url,
        key=key,
        headers={"Content-Type": ct},
        expires_at=expires_at,
    )


@router.get("/limits")
async def upload_limits(user: User = Depends(get_current_user)):
    """FE đọc để hiển thị giới hạn upload trong UI."""
    return {
        "max_bytes": _KIND_MAX_BYTES,
        "allowed_content_types": {k: sorted(v) for k, v in _ALLOWED_KIND_CT.items()},
        "backend": STORAGE_BACKEND,
    }
