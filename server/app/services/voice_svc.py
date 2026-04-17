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

    Saves up to three artifacts per voice:
      - {voice_id}.wav  (raw reference — always saved; used by XTTS v2)
      - {voice_id}.pt   (OmniVoice prompt — best-effort, may fail if OmniVoice TTS
                          can't load or Whisper auto-transcribe unavailable)
      - {voice_id}.json (metadata)

    Even if OmniVoice prompt creation fails, the voice is still usable by XTTS.
    """
    voice_id = uuid.uuid4().hex[:12]
    logger.info("Cloning voice '%s' (id=%s) from %s", name, voice_id, audio_path)

    # 1) ALWAYS save raw WAV first — required for XTTS, doesn't depend on any model
    ref_wav_path = VOICES_DIR / f"{voice_id}.wav"
    try:
        _copy_as_wav(audio_path, str(ref_wav_path))
    except Exception as e:
        logger.error("Failed to save raw ref WAV: %s", e)
        raise

    # 2) Auto-transcribe ref_text if missing — use faster-whisper fallback when
    #    HF whisper_pipe isn't available (USE_FASTER_WHISPER=true setup)
    if not ref_text:
        try:
            if gpu.whisper_pipe is not None:
                ref_text = gpu.whisper_pipe(audio_path)["text"].strip()
            elif gpu._fw_model is not None:
                result = gpu.transcribe_faster(audio_path)
                ref_text = result.get("text", "").strip()
            logger.info("Auto-transcribed ref_text: %s", (ref_text or "")[:80])
        except Exception as e:
            logger.warning("Auto-transcribe failed: %s (continuing without ref_text)", e)
            ref_text = ""

    # 3) Try to create OmniVoice prompt — optional (needed only if engine=omnivoice)
    prompt = None
    try:
        prompt = gpu.create_voice_prompt(ref_audio=audio_path, ref_text=ref_text or None)
    except Exception as e:
        logger.warning("OmniVoice create_voice_prompt failed for %s: %s "
                       "(voice still usable for XTTS via raw WAV)", voice_id, e)

    # 4) Save metadata (+ .pt file if prompt was created)
    meta = save_voice(
        voice_id=voice_id,
        name=name,
        prompt=prompt,
        ref_text=ref_text or (prompt.ref_text if prompt and hasattr(prompt, "ref_text") else None),
        tags=tags,
    )
    logger.info("Voice saved: %s (omnivoice_prompt=%s, raw_wav=yes)",
                voice_id, bool(prompt))
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
