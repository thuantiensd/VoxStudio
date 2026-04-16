"""Voice clone / management logic."""

import logging
import uuid

from app.core.gpu_manager import gpu
from app.core.storage import (
    delete_voice,
    get_voice_meta,
    list_voices,
    save_voice,
)

logger = logging.getLogger(__name__)


def clone(audio_path: str, name: str, ref_text: str = None, tags: list = None) -> dict:
    """Clone voice from audio file. Returns voice metadata."""
    voice_id = uuid.uuid4().hex[:12]
    logger.info("Cloning voice '%s' (id=%s) from %s", name, voice_id, audio_path)

    prompt = gpu.create_voice_prompt(ref_audio=audio_path, ref_text=ref_text)

    meta = save_voice(
        voice_id=voice_id,
        name=name,
        prompt=prompt,
        ref_text=ref_text or (prompt.ref_text if hasattr(prompt, "ref_text") else None),
        tags=tags,
    )
    logger.info("Voice saved: %s", voice_id)
    return meta


def get_all() -> list:
    return list_voices()


def get_one(voice_id: str) -> dict:
    meta = get_voice_meta(voice_id)
    if meta is None:
        raise ValueError(f"Voice '{voice_id}' not found")
    return meta


def remove(voice_id: str) -> bool:
    return delete_voice(voice_id)
