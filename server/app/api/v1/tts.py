"""TTS API endpoints — signed URL + auth bảo vệ audio output."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.audio_sig import signed_url, verify as verify_sig
from app.auth.deps import get_current_user
from app.auth.rate_limit import require_quota
from app.config import AUDIO_OUTPUT_DIR, STORAGE_BACKEND
from app.core.storage import get_audio_path, get_audio_url, delete_audio
from app.db.models import User
from app.db.session import get_session
from app.models.schemas import TTSRequest, TTSResponse
from app.services import tts_svc, edge_tts_svc, job_svc

router = APIRouter(prefix="/tts", tags=["TTS"])


def _signed_audio_url(file_id: str, user_id: int) -> str:
    """Helper trả URL có HMAC sig — dán vào response 'audio_url'."""
    return signed_url(file_id, user_id, ttl_seconds=3600)


@router.post("/generate", response_model=TTSResponse)
async def generate(
    req: TTSRequest,
    ctx: dict = Depends(require_quota("tts")),
):
    """Generate speech from text — qua GPU job queue."""
    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]
    payload = {
        "_owner_user_id": user.id,
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
            timeout=600.0,
        )
        result.pop("usage", None)
        # Override audio_url với signed URL (handler trả raw /audio/{file_id})
        file_id = (result.get("audio_url") or "").rsplit("/", 1)[-1]
        if file_id:
            result["audio_url"] = _signed_audio_url(file_id, user.id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class EdgeTTSRequest(BaseModel):
    text: str
    voice: str | None = None
    language: str | None = None
    speed: float = 1.0


@router.post("/edge-generate")
async def edge_generate(
    req: EdgeTTSRequest,
    user: User = Depends(get_current_user),
):
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
            "audio_url": _signed_audio_url(file_id, user.id),
            "duration": round(duration, 2),
            "sample_rate": sr,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/audio/{file_id}/confirm-received")
async def confirm_audio_received(
    file_id: str,
    request: Request,
    sig: Optional[str] = Query(None),
    u: Optional[str] = Query(None),
    exp: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
):
    """Client gọi sau khi đã download file về máy thành công.

    Server xoá file audio_output ngay → tiết kiệm storage + tăng privacy
    (file không nằm trên server lâu).

    Verify HMAC signature như endpoint GET /audio để chỉ owner gọi được.
    """
    # Path traversal + signature verify
    if not file_id.replace("-", "").replace("_", "").isalnum() or len(file_id) > 32:
        raise HTTPException(status_code=400, detail="Invalid file_id")
    verify_sig(
        file_id,
        user_id_request=user.id,
        sig=sig, u=u, exp=exp,
        is_admin=(user.role == "admin"),
    )
    deleted = delete_audio(file_id)
    return {"ok": True, "deleted": deleted}


@router.get("/audio/{file_id}")
async def get_audio(
    file_id: str,
    request: Request,
    sig: Optional[str] = Query(None),
    u: Optional[str] = Query(None),
    exp: Optional[str] = Query(None),
):
    """Trả file audio output. Auth qua signed URL (sig+u+exp) — HMAC SHA-256
    với JWT_SECRET. KHÔNG yêu cầu Bearer token vì:
      • <audio> HTML element không thể add custom headers (CORS limitation).
      • Signed URL đã contain user_id + expiry + HMAC-tampered-proof —
        đủ strong để chống share/leak. TTL 1h ngắn hơn JWT (7d).

    R2 mode: redirect 302 sang R2 public URL (sau khi verify sig).
    Local mode: stream file từ filesystem.
    """
    # Path traversal protection — file_id phải hex/alnum, không slash/dot
    if not file_id.isalnum() or len(file_id) > 32:
        raise HTTPException(status_code=400, detail="Invalid file_id")

    # Verify signed URL — sig contains user_id binding + expiry. Truyền
    # u_int (từ URL) làm user_id_request để skip user-mismatch check
    # (signed URL itself proves ownership intent).
    if not sig or not u or not exp:
        raise HTTPException(status_code=403, detail="Missing signature")
    try:
        u_int = int(u)
    except (ValueError, TypeError):
        raise HTTPException(status_code=403, detail="Invalid signature")
    verify_sig(
        file_id,
        user_id_request=u_int,
        sig=sig, u=u, exp=exp,
        is_admin=False,
    )

    if STORAGE_BACKEND == "r2":
        url = get_audio_url(file_id)
        if url:
            return RedirectResponse(url=url, status_code=302)
    path = get_audio_path(file_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(str(path), media_type="audio/wav", filename=f"{file_id}.wav")
