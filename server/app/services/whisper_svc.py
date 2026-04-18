"""Whisper STT logic — supports Faster-Whisper (default) and HuggingFace fallback."""

import logging

from app.core.gpu_manager import gpu

logger = logging.getLogger(__name__)


def transcribe(audio_path: str, return_timestamps: bool = True, language: str = None) -> dict:
    """Transcribe audio file. Returns {"text", "segments", "language"}.

    Faster-whisper provides reliable word-level timestamps (used downstream
    for accurate segment splitting). HF Whisper word-level mode drops words
    near 30s chunk boundaries — so we only request segment-level there and
    leave word data empty.
    """
    logger.info("Transcribing: %s (lang=%s, engine=%s)",
                audio_path, language or "auto",
                "faster-whisper" if gpu._use_faster_whisper else "hf-whisper")

    if gpu._use_faster_whisper:
        # Faster-Whisper — already returns {"text","segments","language"} with
        # per-segment "words" list (start/end/word/probability).
        result = gpu.transcribe_faster(audio_path, language=language)
        logger.info("Transcribed (%d segments, lang=%s): %s",
                     len(result["segments"]), result.get("language", "?"), result["text"][:80])
        return result
    else:
        # HF Whisper — segment-level only (word mode is unreliable).
        result = gpu.transcribe(audio_path, return_timestamps=True, language=language)
        text = result.get("text", "").strip()
        segments = []
        if "chunks" in result:
            for chunk in result["chunks"]:
                ts = chunk.get("timestamp", (0, 0))
                segments.append({
                    "start": ts[0] if ts[0] is not None else 0,
                    "end": ts[1] if ts[1] is not None else 0,
                    "text": chunk.get("text", "").strip(),
                    "words": [],   # HF segment-level has no word data
                })
        logger.info("Transcribed: %d segments. Sample: %s", len(segments), text[:80])
        return {"text": text, "segments": segments,
                "language": result.get("language")}


def detect_language(audio_path: str) -> str:
    """Detect language of audio. Returns language code."""
    logger.info("Detecting language: %s", audio_path)
    if gpu._use_faster_whisper:
        result = gpu.transcribe_faster(audio_path)
        return result.get("language", "")
    else:
        result = gpu.transcribe(audio_path, return_timestamps=False)
        return result.get("text", "")
