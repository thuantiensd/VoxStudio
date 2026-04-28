"""STT (Whisper) API endpoint — route qua GPU job queue để chống OOM."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rate_limit import require_quota
from app.config import AUDIO_OUTPUT_DIR
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

    Endpoint vẫn sync — enqueue + await kết quả để giữ tương thích FE.
    File lưu vào AUDIO_OUTPUT_DIR/uploads/ để worker (Pod) đọc qua rclone mount.
    """
    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]

    # Save upload vào AUDIO_OUTPUT_DIR/uploads/ — worker đọc qua mount cùng path
    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    tmp_path = str(UPLOAD_DIR / f"stt-{uuid.uuid4().hex}{suffix}")
    with open(tmp_path, "wb") as fp:
        shutil.copyfileobj(audio.file, fp)

    lang = (language or "").strip().lower()
    if lang in ("", "auto"):
        lang = None

    try:
        result = await job_svc.enqueue_and_wait(
            db,
            user_id=user.id,
            kind="stt",
            payload={"audio_path": tmp_path, "language": lang},
        )
        return {
            "text": result.get("text", ""),
            "segments": result.get("segments", []),
            "language": result.get("language"),
        }
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
