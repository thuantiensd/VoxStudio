"""Voice clone — quản lý theo user.

Mỗi Voice có owner (user_id) trong DB. File artifacts (.pt, .wav, .json)
vẫn ở filesystem `server/voices/` nhưng metadata authoritative là DB.

Logic:
  - clone(user_id, audio, name, ref_text, tags) → tạo file + insert DB row
  - get_all(user_id) → chỉ voices của user (+ public sau này)
  - get_one(user_id, voice_id) → check owner match hoặc admin
  - remove(user_id, voice_id) → delete DB row + file
"""
from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import VOICES_DIR
from app.core.gpu_manager import gpu
from app.core.storage import save_voice as _save_voice_files
from app.core.storage import delete_voice as _delete_voice_files
from app.db.models import Voice, User

logger = logging.getLogger(__name__)


def _copy_as_wav(src_path: str, dst_path: str):
    """Copy/convert reference audio to WAV."""
    if src_path.lower().endswith(".wav"):
        shutil.copy(src_path, dst_path)
        return
    import ffmpeg
    (
        ffmpeg.input(src_path)
        .output(dst_path, acodec="pcm_s16le", ar=24000)
        .overwrite_output()
        .run(quiet=True)
    )


def _voice_to_dict(v: Voice) -> dict:
    """Serialize Voice row về format API expect (tương thích schema cũ)."""
    return {
        "id": v.id,
        "name": v.name,
        "ref_text": v.ref_text,
        "tags": json.loads(v.tags_json) if v.tags_json else [],
        "has_prompt": bool(v.has_prompt),
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


async def clone(
    db: AsyncSession,
    *,
    user_id: int,
    audio_path: str,
    name: str,
    ref_text: str | None = None,
    tags: list | None = None,
) -> dict:
    """Clone voice, gắn với user_id."""
    voice_id = uuid.uuid4().hex[:12]
    logger.info("Cloning voice '%s' (id=%s, user=%d) from %s",
                name, voice_id, user_id, audio_path)

    # 1) Save raw WAV (cho XTTS fallback)
    ref_wav_path = VOICES_DIR / f"{voice_id}.wav"
    try:
        _copy_as_wav(audio_path, str(ref_wav_path))
    except Exception as e:
        logger.error("Failed to save raw ref WAV: %s", e)
        raise

    # 2) Auto-transcribe nếu thiếu
    if not ref_text:
        try:
            if gpu.whisper_pipe is not None:
                ref_text = gpu.whisper_pipe(audio_path)["text"].strip()
            elif gpu._fw_model is not None:
                result = gpu.transcribe_faster(audio_path)
                ref_text = result.get("text", "").strip()
            logger.info("Auto-transcribed ref_text: %s", (ref_text or "")[:80])
        except Exception as e:
            logger.warning("Auto-transcribe failed: %s", e)
            ref_text = ""

    # 3) OmniVoice prompt (optional)
    prompt = None
    try:
        prompt = gpu.create_voice_prompt(ref_audio=audio_path, ref_text=ref_text or None)
    except Exception as e:
        logger.warning("OmniVoice create_voice_prompt failed for %s: %s", voice_id, e)

    # 4) Save files (giữ .json + .pt để tương thích code cũ đọc file)
    _save_voice_files(
        voice_id=voice_id, name=name,
        prompt=prompt,
        ref_text=ref_text or (prompt.ref_text if prompt and hasattr(prompt, "ref_text") else None),
        tags=tags,
    )

    # 5) Insert DB row
    v = Voice(
        id=voice_id,
        user_id=user_id,
        name=name,
        ref_text=ref_text,
        tags_json=json.dumps(tags or [], ensure_ascii=False),
        has_prompt=prompt is not None,
    )
    db.add(v)
    await db.commit()
    await db.refresh(v)
    logger.info("Voice saved: %s owner=user:%d", voice_id, user_id)
    return _voice_to_dict(v)


async def get_all(db: AsyncSession, user_id: int, is_admin: bool = False) -> list:
    """List voices. Admin thấy hết. User thường chỉ thấy của mình."""
    q = select(Voice).order_by(Voice.created_at.desc())
    if not is_admin:
        q = q.where(Voice.user_id == user_id)
    rows = (await db.execute(q)).scalars().all()
    return [_voice_to_dict(v) for v in rows]


async def get_one(db: AsyncSession, voice_id: str, user_id: int,
                   is_admin: bool = False) -> dict:
    """Lấy 1 voice. Raise ValueError nếu không tồn tại hoặc không phải owner."""
    v = await db.get(Voice, voice_id)
    if not v:
        raise ValueError(f"Voice '{voice_id}' không tồn tại.")
    if not is_admin and v.user_id != user_id:
        raise ValueError("Bạn không có quyền truy cập giọng này.")
    return _voice_to_dict(v)


async def remove(db: AsyncSession, voice_id: str, user_id: int,
                  is_admin: bool = False) -> bool:
    """Xoá voice — file + DB row. Check owner."""
    v = await db.get(Voice, voice_id)
    if not v:
        return False
    if not is_admin and v.user_id != user_id:
        raise ValueError("Bạn không có quyền xoá giọng này.")
    # Xoá file (không raise nếu file không tồn tại)
    try:
        _delete_voice_files(voice_id)
        # Xoá thêm .wav (storage.delete_voice chỉ xoá .pt + .json)
        wav_path = VOICES_DIR / f"{voice_id}.wav"
        if wav_path.exists():
            wav_path.unlink()
    except Exception as e:
        logger.warning("Delete files failed for %s: %s", voice_id, e)
    # Xoá DB row
    await db.delete(v)
    await db.commit()
    return True


async def check_ownership(db: AsyncSession, voice_id: str, user_id: int,
                          is_admin: bool = False) -> Voice | None:
    """Helper cho các endpoint khác cần dùng voice (VD TTS generate):
    trả Voice row nếu user có quyền xài, None nếu không."""
    v = await db.get(Voice, voice_id)
    if not v:
        return None
    if is_admin or v.user_id == user_id or v.is_public:
        return v
    return None
