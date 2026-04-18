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
        # HuggingFace Whisper fallback — request word-level timestamps so
        # downstream pipeline can split/snap segments accurately.
        result = gpu.transcribe(audio_path, return_timestamps="word", language=language)
        text = result.get("text", "").strip()
        segments = []

        # HF returns chunks at word level when return_timestamps="word".
        # Group consecutive words into sentence-like segments using punctuation.
        word_chunks = []
        if "chunks" in result:
            for chunk in result["chunks"]:
                ts = chunk.get("timestamp", (None, None))
                if ts[0] is None or ts[1] is None:
                    continue
                word_chunks.append({
                    "start": float(ts[0]),
                    "end": float(ts[1]),
                    "word": chunk.get("text", ""),
                })

        # Group words into segments by sentence punctuation
        if word_chunks:
            current_words = [word_chunks[0]]
            for w in word_chunks[1:]:
                current_words.append(w)
                last_word = w["word"].strip()
                # End segment on sentence punctuation
                if last_word and last_word[-1] in ".!?。！？":
                    segments.append(_words_to_segment(current_words))
                    current_words = []
            if current_words:
                segments.append(_words_to_segment(current_words))

        logger.info("Transcribed: %d segments (%d words). Sample: %s",
                    len(segments), len(word_chunks), text[:80])
        return {"text": text, "segments": segments,
                "language": result.get("language")}


def _words_to_segment(words: list) -> dict:
    """Combine list of word-chunks into a single segment dict."""
    return {
        "start": words[0]["start"],
        "end": words[-1]["end"],
        "text": "".join(w["word"] for w in words).strip(),
        "words": words,
    }


def detect_language(audio_path: str) -> str:
    """Detect language of audio. Returns language code."""
    logger.info("Detecting language: %s", audio_path)
    if gpu._use_faster_whisper:
        result = gpu.transcribe_faster(audio_path)
        return result.get("language", "")
    else:
        result = gpu.transcribe(audio_path, return_timestamps=False)
        return result.get("text", "")
