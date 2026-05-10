"""WhisperX wrapper — opt-in pipeline cho transcribe quality cao.

Pipeline: faster-whisper transcribe → wav2vec2 word alignment →
optional pyannote diarization. Word-level timestamps ~20ms accuracy
(vs Whisper ~1s, Silero VAD snap ~50ms).

Bật qua ENV `USE_WHISPERX=true`. Nếu whisperx chưa cài hoặc model load
fail → caller phải fallback sang pipeline cũ (whisper_svc + Resemblyzer).

Cost trên Mac M1 Pro CPU:
  - Transcribe: ~30-45s/min audio (như faster-whisper hiện tại)
  - Align: +5-10s/min audio
  - Diarize (pyannote): +30-60s/min audio (chậm CPU, fast trên CUDA)

Memory peak: ~2GB (Whisper turbo + wav2vec2 + pyannote).
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

logger = logging.getLogger(__name__)


def is_available() -> bool:
    """Check whisperx pip-installed. Không thử load model — chỉ check import."""
    try:
        import whisperx  # noqa: F401
        return True
    except ImportError:
        return False


def is_diarize_available() -> bool:
    """Check pyannote diarize có thể chạy được — cần HF_TOKEN env."""
    return bool(os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN"))


# ── Lazy-loaded models (singleton, thread-safe) ─────────────────
_lock = threading.Lock()
_model = None              # WhisperX (faster-whisper wrapper)
_align_models: dict = {}   # cache wav2vec2 align model per language code
_diarize_pipeline = None   # pyannote pipeline


def _device_compute_type() -> tuple[str, str]:
    """Pick device/compute_type cho faster-whisper.

    CUDA → float16 (fast), MPS → float32 (whisperx hiện chưa support MPS hoàn
    toàn → fallback CPU), CPU → int8 (fast quantize).
    """
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
        # MPS chưa stable cho whisperx — pyannote+wav2vec2 cần fallback CPU
        return "cpu", "int8"
    except Exception:
        return "cpu", "int8"


def _load_model():
    """Load WhisperX transcribe model (faster-whisper backbone)."""
    global _model
    if _model is not None:
        return _model
    import whisperx
    device, compute_type = _device_compute_type()
    model_size = os.getenv("FASTER_WHISPER_MODEL", "large-v3-turbo")
    logger.info("[whisperx] loading %s on %s (%s)", model_size, device, compute_type)
    _model = whisperx.load_model(model_size, device, compute_type=compute_type)
    return _model


def _load_align(language_code: str):
    """Load wav2vec2 alignment model cho 1 ngôn ngữ. Cache để khỏi reload."""
    if language_code in _align_models:
        return _align_models[language_code]
    import whisperx
    device, _ = _device_compute_type()
    logger.info("[whisperx] loading align model for lang=%s", language_code)
    align_model, metadata = whisperx.load_align_model(
        language_code=language_code, device=device,
    )
    _align_models[language_code] = (align_model, metadata)
    return _align_models[language_code]


def _load_diarize_pipeline():
    """Load pyannote diarize pipeline. Cần HF_TOKEN."""
    global _diarize_pipeline
    if _diarize_pipeline is not None:
        return _diarize_pipeline
    import whisperx
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN không set — pyannote diarize không chạy được")
    device, _ = _device_compute_type()
    logger.info("[whisperx] loading pyannote diarize pipeline on %s", device)
    _diarize_pipeline = whisperx.DiarizationPipeline(
        use_auth_token=token, device=device,
    )
    return _diarize_pipeline


def transcribe(
    audio_path: str,
    language: Optional[str] = None,
    batch_size: int = 16,
    do_align: bool = True,
    do_diarize: bool = False,
    min_speakers: int = 1,
    max_speakers: int = 6,
) -> dict:
    """Transcribe audio với WhisperX — output tương thích shape cũ.

    Returns:
      {
        "segments": [{"start", "end", "text", "words"?, "speaker"?}, ...],
        "language": "vi"|"en"|...,
        "speakers": ["SPK_00", "SPK_01"]?,         # only when do_diarize
        "speaker_genders": {}                       # WhisperX không detect gender →
                                                    # caller fallback Resemblyzer pitch
      }
    """
    if not is_available():
        raise RuntimeError("whisperx chưa cài đặt (pip install whisperx)")

    import whisperx

    with _lock:
        device, _ = _device_compute_type()

        # IMPORTANT: dùng faster-whisper từ whisper_svc cũ cho transcribe,
        # KHÔNG dùng whisperx.load_model().transcribe() — nó dùng pyannote VAD
        # gom speech thành 2-3 segment khổng lồ (đặc biệt tệ cho Chinese không
        # có dấu cách + dấu câu). faster-whisper output 20+ segments tự nhiên.
        # WhisperX chỉ cần dùng cho:
        #   1. align (word-level timestamps qua wav2vec2)
        #   2. diarize (pyannote speaker labels)
        from app.services import whisper_svc
        logger.info("[whisperx] transcribe %s via faster-whisper (lang=%s)",
                    audio_path, language or "auto")
        fw_result = whisper_svc.transcribe(audio_path, language=language)
        # Convert faster-whisper output → whisperx-compatible shape.
        # Whisperx align expects: {"segments": [{"start","end","text"}], ...}
        result = {
            "segments": [
                {"start": s["start"], "end": s["end"], "text": s.get("text", "")}
                for s in fw_result.get("segments", [])
            ],
            "language": fw_result.get("language") or language or "auto",
        }
        detected_lang = result["language"]
        logger.info("[whisperx] faster-whisper gave %d segments, lang=%s",
                    len(result["segments"]), detected_lang)
        # Load audio cho align/diarize
        audio = whisperx.load_audio(audio_path)

        # ── Phase 2: Word alignment (wav2vec2) ──
        if do_align and result.get("segments"):
            try:
                align_model, metadata = _load_align(detected_lang)
                result = whisperx.align(
                    result["segments"], align_model, metadata, audio, device,
                    return_char_alignments=False,
                )
                logger.info("[whisperx] aligned word-level timestamps")
            except Exception as e:
                # Một số ngôn ngữ chưa có wav2vec2 model → skip align gracefully
                logger.warning("[whisperx] align failed for lang=%s, skip: %s",
                               detected_lang, e)

        # ── Phase 3: Diarization (pyannote) ──
        speakers: list[str] = []
        if do_diarize and is_diarize_available():
            try:
                diarize_pipeline = _load_diarize_pipeline()
                diar_kwargs = {}
                if min_speakers and min_speakers >= 1:
                    diar_kwargs["min_speakers"] = min_speakers
                if max_speakers and max_speakers >= 1:
                    diar_kwargs["max_speakers"] = max_speakers
                diarize_segments = diarize_pipeline(audio, **diar_kwargs)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                # Collect unique speaker labels
                for seg in result.get("segments", []):
                    spk = seg.get("speaker")
                    if spk and spk not in speakers:
                        speakers.append(spk)
                logger.info("[whisperx] diarized: %d speakers %s", len(speakers), speakers)
            except Exception as e:
                logger.warning("[whisperx] diarize failed, skip: %s", e)

        # Normalize segment shape — đảm bảo có start/end/text bắt buộc.
        out_segs = []
        for seg in result.get("segments", []):
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            cleaned = {
                "start": float(seg.get("start", 0.0)),
                "end": float(seg.get("end", 0.0)),
                "text": text,
            }
            if seg.get("speaker"):
                cleaned["speaker"] = seg["speaker"]
            # Words array (start/end/score per word) — downstream có thể dùng
            # cho alignment chính xác.
            if seg.get("words"):
                cleaned["words"] = [
                    {
                        "word": w.get("word") or w.get("text") or "",
                        "start": float(w.get("start", 0.0)) if w.get("start") is not None else None,
                        "end": float(w.get("end", 0.0)) if w.get("end") is not None else None,
                        "score": float(w.get("score", 0.0)) if w.get("score") is not None else None,
                    }
                    for w in seg["words"]
                ]
            out_segs.append(cleaned)

        return {
            "segments": out_segs,
            "language": detected_lang,
            "speakers": speakers,
            "speaker_genders": {},  # caller dùng Resemblyzer pitch để detect
        }


def unload():
    """Free memory — gọi khi pipeline xong (đặc biệt CUDA)."""
    global _model, _diarize_pipeline
    _model = None
    _diarize_pipeline = None
    _align_models.clear()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
