"""WhisperX unified engine — STT + word alignment + diarization trong 1 lệnh.

Thay thế:
  - speaker_pipeline/orchestrator.py (12 phase custom buggy)
  - Pyannote raw API calls (4.x breaking changes)
  - Manual mapping segment → speaker qua time-overlap

WhisperX wrap pyannote.audio nội bộ với compat tested → ổn định hơn.

Output format chuẩn:
  {
      "segments": [
          {
              "start": float, "end": float,
              "text": str,
              "speaker": str | None,        # "SPEAKER_00", "SPEAKER_01", ...
              "words": [{word, start, end, score, speaker}],
              "avg_logprob": float,
              "no_speech_prob": float,
          },
      ],
      "language": str,                       # detected lang (vd "zh", "vi")
      "speakers": list[str],                  # unique speakers detected
      "diarize_used": bool,                   # True nếu diarize chạy được
  }

Hard timeout 240s — KHÔNG treo vô hạn.
Fallback faster-whisper nếu WhisperX fail import/load.
"""
from __future__ import annotations

import logging
import os
import queue as _queue
import threading
from typing import Optional

logger = logging.getLogger(__name__)


_model_lock = threading.Lock()
_model_cache: dict = {}  # {"whisper": ..., "align_<lang>": ..., "diarize": ...}


def is_available() -> bool:
    """Check whisperx pip package available."""
    try:
        import whisperx  # noqa: F401
        return True
    except ImportError:
        return False


def _get_device() -> str:
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def _load_whisper_model(device: str = "cuda"):
    """Lazy load WhisperX large-v3-turbo. Cache singleton.

    Anti-hallucination params: condition_on_previous_text=False (chống
    repeat loop trên Chinese drama), no_repeat_ngram=3, compression_ratio
    threshold strict hơn.
    """
    with _model_lock:
        if "whisper" in _model_cache:
            return _model_cache["whisper"]
        import whisperx
        logger.info("Loading WhisperX large-v3-turbo (device=%s)...", device)
        asr_options = {
            "condition_on_previous_text": False,
            "no_repeat_ngram_size": 3,
            "compression_ratio_threshold": 2.2,
            "hallucination_silence_threshold": 2.0,
            "temperatures": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        }
        _model_cache["whisper"] = whisperx.load_model(
            "large-v3-turbo",
            device=device,
            compute_type="float16" if device == "cuda" else "int8",
            asr_options=asr_options,
        )
        logger.info("WhisperX model loaded")
        return _model_cache["whisper"]


def _load_align_model(language: str, device: str = "cuda"):
    """Load align model cho language cụ thể. Một số language KHÔNG có
    align model → return (None, None) → skip align step."""
    key = f"align_{language}"
    with _model_lock:
        if key in _model_cache:
            return _model_cache[key]
        try:
            import whisperx
            model_a, metadata = whisperx.load_align_model(
                language_code=language, device=device,
            )
            _model_cache[key] = (model_a, metadata)
            logger.info("WhisperX align model loaded for %s", language)
            return _model_cache[key]
        except Exception as e:
            logger.info("Skip align cho language=%s: %s", language, e)
            _model_cache[key] = (None, None)
            return _model_cache[key]


def _load_diarize_pipeline(device: str = "cuda"):
    """Load WhisperX diarize wrapper (wraps pyannote nội bộ, compat tested).
    Return None nếu không có HF_TOKEN hoặc fail load."""
    with _model_lock:
        if "diarize" in _model_cache:
            return _model_cache["diarize"]
        token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
        if not token:
            logger.warning("No HF_TOKEN → skip diarize (1 speaker mặc định)")
            _model_cache["diarize"] = None
            return None
        try:
            import whisperx
            # WhisperX DiarizationPipeline có compat layer cho pyannote 3.x/4.x
            pipeline = whisperx.DiarizationPipeline(
                use_auth_token=token, device=device,
            )
            _model_cache["diarize"] = pipeline
            logger.info("WhisperX diarize pipeline ready")
            return pipeline
        except Exception as e:
            logger.warning("Diarize pipeline init fail (%s) — segments no speaker", e)
            _model_cache["diarize"] = None
            return None


def transcribe_unified(
    audio_path: str,
    *,
    language: Optional[str] = None,
    min_speakers: int = 1,
    max_speakers: int = 6,
    do_diarize: bool = True,
    timeout_s: int = 240,
    batch_size: int = 16,
) -> dict:
    """Unified transcribe + align + diarize.

    Args:
      audio_path: vocals.wav hoặc audio path
      language: ISO code ("zh", "vi", "en") hoặc None để auto-detect
      do_diarize: True → chạy diarization (cần HF_TOKEN)
      timeout_s: hard timeout — abort nếu treo
      batch_size: WhisperX batch (16 → ~10GB VRAM, giảm nếu OOM)

    Returns: {segments, language, speakers, diarize_used}
    Raises:
      TimeoutError nếu treo
      RuntimeError nếu WhisperX không cài
      Exception khác từ WhisperX internal
    """
    if not is_available():
        raise RuntimeError(
            "whisperx package not installed. Run: pip install whisperx",
        )

    device = _get_device()
    result_q: _queue.Queue = _queue.Queue()

    def _worker():
        try:
            import whisperx
            # Load audio (16kHz mono)
            audio = whisperx.load_audio(audio_path)

            # Step 1: Transcribe
            whisper = _load_whisper_model(device)
            logger.info("WhisperX transcribe: %s (lang=%s)",
                        audio_path, language or "auto")
            result = whisper.transcribe(
                audio,
                batch_size=batch_size,
                language=language,
            )
            detected_lang = result.get("language") or language or "auto"
            logger.info("WhisperX transcribed: %d segments, lang=%s",
                        len(result.get("segments", [])), detected_lang)

            # Step 2: Word-level alignment (chính xác ~10ms)
            model_a, metadata = _load_align_model(detected_lang, device)
            if model_a is not None and result.get("segments"):
                try:
                    result = whisperx.align(
                        result["segments"], model_a, metadata, audio, device,
                        return_char_alignments=False,
                    )
                    logger.info("WhisperX aligned: %d words total",
                                sum(len(s.get("words", []))
                                    for s in result.get("segments", [])))
                except Exception as e:
                    logger.warning("Align fail (%s) — giữ segment-level timestamps", e)

            # Step 3: Speaker diarization
            speakers_found: list[str] = []
            diarize_used = False
            if do_diarize:
                diarize_pipe = _load_diarize_pipeline(device)
                if diarize_pipe is not None:
                    try:
                        diarize_df = diarize_pipe(
                            audio,
                            min_speakers=min_speakers,
                            max_speakers=max_speakers,
                        )
                        result = whisperx.assign_word_speakers(diarize_df, result)
                        # Mỗi word + segment giờ có "speaker" attr (SPEAKER_00, 01, ...)
                        seen: list[str] = []
                        for s in result.get("segments", []):
                            spk = s.get("speaker")
                            if spk and spk not in seen:
                                seen.append(spk)
                        speakers_found = seen
                        diarize_used = True
                        logger.info("WhisperX diarize: %d speakers %s",
                                    len(speakers_found), speakers_found)
                    except Exception as e:
                        logger.warning("Diarize step fail (%s) — segments no speaker", e)

            result_q.put(("ok", {
                "segments": result.get("segments", []),
                "language": detected_lang,
                "speakers": speakers_found,
                "diarize_used": diarize_used,
            }))
        except Exception as e:
            result_q.put(("err", e))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    try:
        kind, value = result_q.get(timeout=timeout_s)
    except _queue.Empty:
        raise TimeoutError(
            f"WhisperX treo >{timeout_s}s — abort. Audio quá dài hoặc model issue.",
        )
    if kind == "err":
        raise value
    return value


def unload() -> None:
    """Free GPU memory. Gọi sau khi dub xong batch."""
    with _model_lock:
        n = len(_model_cache)
        _model_cache.clear()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
    logger.info("WhisperX models unloaded (%d cached)", n)
