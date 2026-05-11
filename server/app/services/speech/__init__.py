"""WhisperX-first speech processing.

Unified STT + word alignment + diarization trong 1 module.
Thay thế speaker_pipeline/ (12 module custom buggy).

Public API:
    from app.services.speech import whisperx_engine
    result = whisperx_engine.transcribe_unified(audio_path, ...)

    from app.services.speech import post_process
    segs = post_process.dedup_repeated_text(segs)
"""
from . import whisperx_engine
from . import post_process
from . import punctuation

__all__ = ["whisperx_engine", "post_process", "punctuation"]
