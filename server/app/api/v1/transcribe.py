"""STT (Whisper) API endpoints."""

import shutil
import tempfile

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schemas import TranscribeResponse
from app.services import whisper_svc

router = APIRouter(prefix="/stt", tags=["STT"])


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
):
    """Transcribe audio to text with timestamps."""
    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        tmp_path = tmp.name

    try:
        result = whisper_svc.transcribe(tmp_path, return_timestamps=True)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
