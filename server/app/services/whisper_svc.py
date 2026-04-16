"""Whisper STT logic — supports Faster-Whisper (default) and HuggingFace fallback."""

import logging

from app.core.gpu_manager import gpu

logger = logging.getLogger(__name__)


def transcribe(audio_path: str, return_timestamps: bool = True, language: str = None) -> dict:
    """Transcribe audio file. Returns {"text", "segments", "language"}."""
    logger.info("Transcribing: %s (lang=%s, engine=%s)",
                audio_path, language or "auto",
                "faster-whisper" if gpu._use_faster_whisper else "hf-whisper")

    if gpu._use_faster_whisper:
        # Faster-Whisper — already returns {"text", "segments", "language"}
        result = gpu.transcribe_faster(audio_path, language=language)
        logger.info("Transcribed (%d segments, lang=%s): %s",
                     len(result["segments"]), result.get("language", "?"), result["text"][:80])
        return result
    else:
        # HuggingFace Whisper fallback
        result = gpu.transcribe(audio_path, return_timestamps=return_timestamps, language=language)
        text = result.get("text", "").strip()
        segments = []

        if return_timestamps and "chunks" in result:
            for chunk in result["chunks"]:
                ts = chunk.get("timestamp", (0, 0))
                segments.append({
                    "start": ts[0] if ts[0] is not None else 0,
                    "end": ts[1] if ts[1] is not None else 0,
                    "text": chunk.get("text", "").strip(),
                })

        logger.info("Transcribed: %s", text[:80])
        return {"text": text, "segments": segments}


def detect_language(audio_path: str) -> str:
    """Detect language of audio. Returns language code."""
    logger.info("Detecting language: %s", audio_path)
    if gpu._use_faster_whisper:
        result = gpu.transcribe_faster(audio_path)
        return result.get("language", "")
    else:
        result = gpu.transcribe(audio_path, return_timestamps=False)
        return result.get("text", "")
