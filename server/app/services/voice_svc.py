"""Voice clone / management logic."""

import logging
import shutil
import uuid

from app.config import VOICES_DIR
from app.core.gpu_manager import gpu
from app.core.storage import (
    delete_voice,
    get_voice_meta,
    list_voices,
    save_voice,
)

logger = logging.getLogger(__name__)


def clone(audio_path: str, name: str, ref_text: str = None, tags: list = None) -> dict:
    """Clone voice from audio file. Returns voice metadata.

    Saves two artifacts per voice:
      - {voice_id}.pt  (OmniVoice prompt tensor)
      - {voice_id}.wav (raw reference — used by XTTS v2 and other engines)
    """
    voice_id = uuid.uuid4().hex[:12]
    logger.info("Cloning voice '%s' (id=%s) from %s", name, voice_id, audio_path)

    prompt = gpu.create_voice_prompt(ref_audio=audio_path, ref_text=ref_text)

    # Save raw WAV ref for engines that need direct audio (e.g. XTTS v2)
    try:
        ref_wav_path = VOICES_DIR / f"{voice_id}.wav"
        _copy_as_wav(audio_path, str(ref_wav_path))
    except Exception as e:
        logger.warning("Could not save raw ref WAV for %s: %s", voice_id, e)

    meta = save_voice(
        voice_id=voice_id,
        name=name,
        prompt=prompt,
        ref_text=ref_text or (prompt.ref_text if hasattr(prompt, "ref_text") else None),
        tags=tags,
    )
    logger.info("Voice saved: %s", voice_id)
    return meta


def _copy_as_wav(src_path: str, dst_path: str):
    """Copy/convert reference audio to WAV (16-bit mono or native)."""
    if src_path.lower().endswith(".wav"):
        shutil.copy(src_path, dst_path)
        return
    # Convert any other format to WAV via ffmpeg
    import ffmpeg
    (
        ffmpeg.input(src_path)
        .output(dst_path, acodec="pcm_s16le", ar=24000)
        .overwrite_output()
        .run(quiet=True)
    )


def get_all() -> list:
    return list_voices()


def get_one(voice_id: str) -> dict:
    meta = get_voice_meta(voice_id)
    if meta is None:
        raise ValueError(f"Voice '{voice_id}' not found")
    return meta


def remove(voice_id: str) -> bool:
    return delete_voice(voice_id)
