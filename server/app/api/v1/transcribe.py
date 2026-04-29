"""STT (Whisper) API endpoint — route qua GPU job queue để chống OOM."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rate_limit import require_quota
from app.config import AUDIO_OUTPUT_DIR, STORAGE_BACKEND
from app.db.models import User
from app.services import job_svc

router = APIRouter(prefix="/stt", tags=["STT"])

UPLOAD_DIR = Path(AUDIO_OUTPUT_DIR) / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
    language: str | None = Form(None, description="ISO code (en/vi/ja…) hoặc 'auto'"),
    ctx: dict = Depends(require_quota("stt")),
):
    """Transcribe audio qua job queue (single-GPU serialize).

    Multipart upload — phù hợp file nhỏ (<25MB). Cho file lớn nên dùng
    /uploads/presign + /stt/transcribe-key (R2 mode).

    Local mode: file lưu AUDIO_OUTPUT_DIR/uploads/ để worker đọc cùng path.
    R2 mode: stream upload → R2 private bucket, payload chứa key.
    """
    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]

    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    payload: dict = {}

    if STORAGE_BACKEND == "r2":
        # Stream upload thẳng lên R2 private bucket
        from app.core import storage_r2
        key = f"uploads/{user.id}/stt-{uuid.uuid4().hex}{suffix}"
        try:
            storage_r2.upload_fileobj(
                audio.file, key,
                content_type=audio.content_type or "application/octet-stream",
            )
        except Exception as e:
            raise HTTPException(500, f"Upload R2 thất bại: {e}")
        payload["audio_key"] = key
    else:
        tmp_path = str(UPLOAD_DIR / f"stt-{uuid.uuid4().hex}{suffix}")
        with open(tmp_path, "wb") as fp:
            shutil.copyfileobj(audio.file, fp)
        payload["audio_path"] = tmp_path

    lang = (language or "").strip().lower()
    if lang in ("", "auto"):
        lang = None
    payload["language"] = lang

    try:
        result = await job_svc.enqueue_and_wait(
            db, user_id=user.id, kind="stt", payload=payload,
        )
        return {
            "text": result.get("text", ""),
            "segments": result.get("segments", []),
            "language": result.get("language"),
        }
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


class TranscribeKeyReq(BaseModel):
    audio_key: str
    language: str | None = None


@router.post("/transcribe-key")
async def transcribe_by_key(
    req: TranscribeKeyReq,
    ctx: dict = Depends(require_quota("stt")),
):
    """STT cho file đã upload sẵn lên R2 (qua /uploads/presign).

    Tránh re-upload qua VPS — chỉ gửi reference key. Phù hợp file lớn 100MB+
    từ desktop hoặc dub flow.
    """
    if STORAGE_BACKEND != "r2":
        raise HTTPException(501, "Endpoint này chỉ khả dụng khi backend=r2")

    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]

    if not req.audio_key.startswith(f"uploads/{user.id}/"):
        # Chống tham chiếu key của user khác
        raise HTTPException(403, "audio_key không thuộc về bạn")

    lang = (req.language or "").strip().lower()
    if lang in ("", "auto"):
        lang = None

    try:
        result = await job_svc.enqueue_and_wait(
            db, user_id=user.id, kind="stt",
            payload={"audio_key": req.audio_key, "language": lang},
        )
        return {
            "text": result.get("text", ""),
            "segments": result.get("segments", []),
            "language": result.get("language"),
        }
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
