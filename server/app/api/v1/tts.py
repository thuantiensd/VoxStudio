"""TTS API endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rate_limit import require_quota
from app.config import AUDIO_OUTPUT_DIR, STORAGE_BACKEND
from app.core.storage import get_audio_path, get_audio_url
from app.db.models import User
from app.models.schemas import TTSRequest, TTSResponse
from app.services import tts_svc, edge_tts_svc, job_svc

router = APIRouter(prefix="/tts", tags=["TTS"])


@router.post("/generate", response_model=TTSResponse)
async def generate(
    req: TTSRequest,
    ctx: dict = Depends(require_quota("tts")),
):
    """Generate speech from text — qua GPU job queue để chống OOM."""
    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]
    payload = {
        "_owner_user_id": user.id,  # để handler check voice ownership
        "text": req.text,
        "voice_id": req.voice_id,
        "language": req.language,
        "speed": req.speed,
        "num_step": req.num_step,
        "guidance_scale": req.guidance_scale,
        "t_shift": req.t_shift,
        "layer_penalty_factor": req.layer_penalty_factor,
        "position_temperature": req.position_temperature,
        "class_temperature": req.class_temperature,
        "denoise": req.denoise,
        "preprocess_prompt": req.preprocess_prompt,
        "postprocess_output": req.postprocess_output,
        "audio_chunk_duration": req.audio_chunk_duration,
    }
    try:
        result = await job_svc.enqueue_and_wait(
            db, user_id=user.id, kind="tts", payload=payload,
            timeout=600.0,  # TTS nhanh hơn, 10 phút đủ
        )
        # Strip usage info trước khi trả FE (FE không cần)
        result.pop("usage", None)
        return result
    except ValueError as e:
        # Chứa các message quota/timeout — user-friendly, không phải 500
        raise HTTPException(status_code=400, detail=str(e))


class EdgeTTSRequest(BaseModel):
    text: str
    voice: str | None = None
    language: str | None = None
    speed: float = 1.0


@router.post("/edge-generate")
async def edge_generate(req: EdgeTTSRequest):
    """Generate speech using VoxCloud (Edge TTS) — free, no GPU."""
    try:
        file_id = uuid.uuid4().hex[:12]
        mp3_path = AUDIO_OUTPUT_DIR / f"{file_id}.mp3"
        wav_path = AUDIO_OUTPUT_DIR / f"{file_id}.wav"

        await edge_tts_svc.generate(
            req.text, str(mp3_path),
            language=req.language or "vietnamese",
            voice=req.voice, speed=req.speed,
        )

        # Convert mp3 → wav
        import ffmpeg
        (
            ffmpeg.input(str(mp3_path))
            .output(str(wav_path), acodec="pcm_s16le", ac=1, ar=24000)
            .overwrite_output()
            .run(quiet=True)
        )
        mp3_path.unlink(missing_ok=True)

        import soundfile as sf
        data, sr = sf.read(str(wav_path))
        duration = len(data) / sr

        return {
            "audio_url": f"/api/v1/tts/audio/{file_id}",
            "duration": round(duration, 2),
            "sample_rate": sr,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audio/{file_id}")
async def get_audio(file_id: str):
    """Trả file audio output.

    R2 mode: redirect 302 sang URL public R2 (CDN, không qua VPS bandwidth).
    Local mode: stream file từ filesystem.
    """
    if STORAGE_BACKEND == "r2":
        url = get_audio_url(file_id)
        if url:
            return RedirectResponse(url=url, status_code=302)
        # Fallback: nếu R2 build URL fail, thử serve local (file vừa generate
        # có thể chưa kịp upload xong).
    path = get_audio_path(file_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(str(path), media_type="audio/wav", filename=f"{file_id}.wav")
