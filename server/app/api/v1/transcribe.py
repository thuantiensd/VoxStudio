"""STT (Whisper) API endpoints."""

import shutil
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.models.schemas import TranscribeResponse
from app.services import whisper_svc

router = APIRouter(prefix="/stt", tags=["STT"])


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
    language: str | None = Form(None, description="ISO code (en/vi/ja…) or omit for auto"),
):
    """Transcribe audio to text with timestamps.

    `language` là hint cho Whisper. "auto" / rỗng = tự detect.
    Trả segments với start/end/text (+ words nếu có).
    """
    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        tmp_path = tmp.name

    lang = (language or "").strip().lower()
    if lang in ("", "auto"):
        lang = None

    try:
        result = whisper_svc.transcribe(tmp_path, return_timestamps=True, language=lang)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
