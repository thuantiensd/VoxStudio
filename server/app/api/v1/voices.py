"""Voice management API — per-user isolation."""

import os as _os
import shutil
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_verified
from app.auth.rate_limit import require_quota
from app.config import STORAGE_BACKEND, TTS_DEFAULT_GUIDANCE, TTS_DEFAULT_STEPS
from app.db.models import User
from app.db.session import get_session
from app.models.schemas import VoiceInfo, VoiceListResponse
from app.services import job_svc, plan_svc, voice_svc

router = APIRouter(prefix="/voices", tags=["Voices"])


def _stage_ref_audio(audio: UploadFile, user_id: int) -> tuple[dict, str | None]:
    """Save reference audio cho job payload.

    R2 mode: stream upload → R2 private bucket, trả ({audio_key: ...}, None).
    Local mode: write tmp file, trả ({audio_path: ...}, tmp_path) — caller
    cleanup tmp_path sau khi job xong.
    """
    suffix = "." + (audio.filename.split(".")[-1] if audio.filename else "wav")
    if STORAGE_BACKEND == "r2":
        from app.core import storage_r2
        key = f"uploads/{user_id}/voice-{uuid.uuid4().hex}{suffix}"
        try:
            storage_r2.upload_fileobj(
                audio.file, key,
                content_type=audio.content_type or "application/octet-stream",
            )
        except Exception as e:
            raise HTTPException(500, f"Upload R2 thất bại: {e}")
        return {"audio_key": key}, None

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        tmp_path = tmp.name
    return {"audio_path": tmp_path}, tmp_path


@router.post("/preview")
async def preview_voice(
    audio: UploadFile = File(..., description="Reference audio file (3-10s)"),
    text: str = Form(..., description="Text to synthesize for preview"),
    ref_text: str = Form(None, description="Audio transcript (auto-detected if empty)"),
    language: str = Form(None, description="Target language"),
    speed: float = Form(1.0, description="Speed multiplier"),
    num_step: int = Form(None, description="Inference steps"),
    guidance_scale: float = Form(None, description="CFG guidance scale"),
    t_shift: float = Form(None, description="Time shift"),
    layer_penalty_factor: float = Form(None, description="Layer penalty"),
    position_temperature: float = Form(None, description="Position temperature"),
    class_temperature: float = Form(None, description="Class temperature"),
    denoise: bool = Form(None, description="Apply denoising"),
    preprocess_prompt: bool = Form(None, description="Preprocess prompt"),
    postprocess_output: bool = Form(None, description="Postprocess output"),
    audio_chunk_duration: float = Form(None, description="Audio chunk duration"),
    ctx: dict = Depends(require_quota("tts")),
):
    """Preview TTS với reference audio (không lưu voice). Require auth + quota.

    GPU work is routed through the DB job queue so API-only VPS deployments do
    not try to load OmniVoice locally.
    """
    user: User = ctx["user"]
    db: AsyncSession = ctx["db"]
    audio_payload, tmp_path = _stage_ref_audio(audio, user.id)

    try:
        result = await job_svc.enqueue_and_wait(
            db,
            user_id=user.id,
            kind="voice_preview",
            timeout=900.0,
            payload={
                **audio_payload,
                "text": text,
                "ref_text": ref_text,
                "language": language,
                "speed": speed,
                "config": {
                    "num_step": num_step or TTS_DEFAULT_STEPS,
                    "guidance_scale": (
                        guidance_scale
                        if guidance_scale is not None
                        else TTS_DEFAULT_GUIDANCE
                    ),
                    "t_shift": t_shift,
                    "layer_penalty_factor": layer_penalty_factor,
                    "position_temperature": position_temperature,
                    "class_temperature": class_temperature,
                    "denoise": denoise,
                    "preprocess_prompt": preprocess_prompt,
                    "postprocess_output": postprocess_output,
                    "audio_chunk_duration": audio_chunk_duration,
                },
            },
        )
        result.pop("usage", None)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try: _os.remove(tmp_path)
            except Exception: pass


@router.post("/clone", response_model=VoiceInfo)
async def clone_voice(
    request: Request,
    audio: UploadFile = File(..., description="Reference audio file (3-10s)"),
    name: str = Form(..., description="Voice name"),
    ref_text: str = Form(None, description="Audio transcript (auto-detected if empty)"),
    tags: str = Form("", description="Comma-separated tags"),
    consent: bool = Form(False, description="User attests right to use the voice"),
    user: User = Depends(require_verified),
    db: AsyncSession = Depends(get_session),
):
    """Clone voice — gắn với user đã verify email + check plan limit voice_clone_max."""
    # Consent là BẮT BUỘC — bảo vệ pháp lý + chống deepfake fraud
    if not consent:
        raise HTTPException(
            400,
            "Vui lòng tick xác nhận có quyền sử dụng giọng nói trong audio.",
        )
    # Check quota voice_clone_max
    plan = await plan_svc.get_plan(db, user.plan or "free")
    max_voices = plan_svc.get_limit(plan, "voice_clone_max", 1)
    if max_voices != -1:
        current = await voice_svc.get_all(db, user.id)
        if len(current) >= max_voices:
            raise HTTPException(
                429,
                f"Bạn đã đạt giới hạn {max_voices} giọng clone trong gói "
                f"{plan.name if plan else 'hiện tại'}. Xoá giọng cũ hoặc nâng cấp gói.",
            )

    audio_payload, tmp_path = _stage_ref_audio(audio, user.id)

    try:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        client_ip = (request.client.host if request.client else None)
        meta = await job_svc.enqueue_and_wait(
            db,
            user_id=user.id,
            kind="voice_clone",
            timeout=900.0,
            payload={
                **audio_payload,
                "_owner_user_id": user.id,
                "name": name,
                "ref_text": ref_text or None,
                "tags": tag_list,
                "consent_ip": client_ip,
            },
        )
        return meta
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try: _os.remove(tmp_path)
            except Exception: pass


@router.get("", response_model=VoiceListResponse)
async def list_voices(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List giọng của user hiện tại (admin thấy hết)."""
    voices = await voice_svc.get_all(db, user.id, is_admin=(user.role == "admin"))
    return {"voices": voices, "total": len(voices)}


@router.get("/{voice_id}", response_model=VoiceInfo)
async def get_voice(
    voice_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Lấy detail 1 voice — check owner."""
    try:
        return await voice_svc.get_one(
            db, voice_id, user.id, is_admin=(user.role == "admin")
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{voice_id}")
async def delete_voice(
    voice_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Xoá voice — chỉ owner hoặc admin."""
    try:
        deleted = await voice_svc.remove(
            db, voice_id, user.id, is_admin=(user.role == "admin")
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Giọng không tồn tại")
    return {"status": "deleted", "id": voice_id}
