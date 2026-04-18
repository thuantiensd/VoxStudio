"""TTS API endpoints."""

import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import AUDIO_OUTPUT_DIR
from app.core.storage import get_audio_path
from app.models.schemas import TTSRequest, TTSResponse
from app.services import tts_svc, edge_tts_svc

router = APIRouter(prefix="/tts", tags=["TTS"])


@router.post("/generate", response_model=TTSResponse)
async def generate(req: TTSRequest):
    """Generate speech from text."""
    try:
        result = tts_svc.generate(
            text=req.text,
            voice_id=req.voice_id,
            language=req.language,
            speed=req.speed,
            num_step=req.num_step,
            guidance_scale=req.guidance_scale,
            t_shift=req.t_shift,
            layer_penalty_factor=req.layer_penalty_factor,
            position_temperature=req.position_temperature,
            class_temperature=req.class_temperature,
            denoise=req.denoise,
            preprocess_prompt=req.preprocess_prompt,
            postprocess_output=req.postprocess_output,
            audio_chunk_duration=req.audio_chunk_duration,
            duration=req.duration,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    """Download generated audio file."""
    path = get_audio_path(file_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(str(path), media_type="audio/wav", filename=f"{file_id}.wav")
