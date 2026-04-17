"""TTS API endpoints."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import AUDIO_OUTPUT_DIR, VOICES_DIR
from app.core.storage import get_audio_path
from app.models.schemas import TTSRequest, TTSResponse
from app.services import tts_svc, edge_tts_svc

router = APIRouter(prefix="/tts", tags=["TTS"])


@router.post("/vieneu-test")
async def vieneu_test(
    voice_id: str = Form(None),
    text: str = Form("Xin chào, đây là giọng nói tiếng Việt được sinh bởi VieNeu-TTS."),
):
    """Generate a single VieNeu-TTS utterance — for sanity testing.

    If voice_id provided, clones the voice from that voice's raw WAV.
    Otherwise uses VieNeu's default voice.
    """
    from app.services import vieneu_svc

    ref_wav = None
    ref_text = None
    if voice_id:
        ref_wav_path = VOICES_DIR / f"{voice_id}.wav"
        if not ref_wav_path.exists():
            raise HTTPException(status_code=404, detail=f"Voice WAV not found: {voice_id}")
        ref_wav = str(ref_wav_path)
        import json as _json
        meta_path = VOICES_DIR / f"{voice_id}.json"
        if meta_path.exists():
            try:
                ref_text = _json.loads(meta_path.read_text(encoding="utf-8")).get("ref_text")
            except Exception:
                pass

    out_id = uuid.uuid4().hex[:12]
    out_path = AUDIO_OUTPUT_DIR / f"{out_id}.wav"

    try:
        vieneu_svc.vieneu.generate(
            text=text,
            ref_wav_path=ref_wav,
            ref_text=ref_text,
            out_wav_path=str(out_path),
        )
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        )

    return {
        "audio_url": f"/api/v1/tts/audio/{out_id}",
        "file_id": out_id,
        "size_bytes": out_path.stat().st_size,
    }


@router.post("/xtts-test")
async def xtts_test(
    voice_id: str = Form(...),
    text: str = Form("Xin chào, đây là giọng nói tiếng Việt được sinh bởi XTTS v2."),
    language: str = Form("vi"),
):
    """Generate a single XTTS utterance using an already-cloned voice — for sanity testing.

    Reuses the server's loaded XTTS model (no extra VRAM).
    """
    from app.services import xtts_svc

    ref_wav = VOICES_DIR / f"{voice_id}.wav"
    if not ref_wav.exists():
        raise HTTPException(status_code=404, detail=f"Voice WAV not found: {voice_id}")

    out_id = uuid.uuid4().hex[:12]
    out_path = AUDIO_OUTPUT_DIR / f"{out_id}.wav"

    try:
        xtts_svc.xtts.generate(
            text=text,
            ref_wav_path=str(ref_wav),
            out_wav_path=str(out_path),
            language=language,
        )
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
        )

    return {
        "audio_url": f"/api/v1/tts/audio/{out_id}",
        "file_id": out_id,
        "size_bytes": out_path.stat().st_size,
    }


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
