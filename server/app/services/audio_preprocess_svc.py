"""Audio preprocessing for voice clone reference inputs.

Mục tiêu: làm sạch ref audio TRƯỚC khi đưa vào OmniVoice
create_voice_clone_prompt. Embedding học từ audio sạch sẽ → giọng clone
sinh ra không kế thừa pattern "im → nói" từ ref audio bẩn, tránh ảnh
hưởng tới timing lip-sync khi lồng tiếng vào video gốc.

Pipeline:
  1. Load audio (mọi format ffmpeg đọc được) → numpy mono 16kHz
  2. Trim leading/trailing silence (RMS-based, threshold -40dB)
  3. (optional) Loudness normalize tới -23 LUFS để clone không bị quá nhỏ
  4. Save WAV tạm → trả path
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


def _ensure_mono_array(audio: np.ndarray) -> np.ndarray:
    """Convert multi-channel → mono bằng mean. Giữ nguyên nếu đã 1D."""
    if audio.ndim == 1:
        return audio
    return audio.mean(axis=1)


def _trim_silence_np(audio: np.ndarray, sample_rate: int,
                     threshold_db: float = -40.0,
                     pad_ms: int = 50,
                     frame_ms: int = 20) -> np.ndarray:
    """Trim leading/trailing silence dựa trên RMS frame-by-frame.

    Khác với trim_silence trong tts_svc (làm trên tensor đầu ra),
    cái này làm trên ref audio đầu vào — pad lớn hơn (50ms) để giữ
    đệm an toàn cho phụ âm/khẩu hình ban đầu.
    """
    if audio.size == 0:
        return audio
    frame_len = max(1, int(sample_rate * frame_ms / 1000))
    n_frames = audio.size // frame_len
    if n_frames == 0:
        return audio
    # RMS per frame
    trimmed = audio[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(trimmed.astype(np.float64) ** 2, axis=1) + 1e-12)
    peak = float(rms.max())
    if peak <= 0:
        return audio
    thresh = peak * (10 ** (threshold_db / 20.0))
    voiced = np.where(rms > thresh)[0]
    if voiced.size == 0:
        return audio
    pad_frames = max(1, int(pad_ms / frame_ms))
    start_f = max(0, int(voiced[0]) - pad_frames)
    end_f = min(n_frames, int(voiced[-1]) + pad_frames + 1)
    start = start_f * frame_len
    end = end_f * frame_len
    return audio[start:end].copy()


def _peak_normalize(audio: np.ndarray, target_peak: float = 0.95) -> np.ndarray:
    """Đẩy peak gần full-scale (-0.45dB). Đơn giản hơn LUFS, đủ cho voice
    clone embedding (model không quá nhạy với absolute level)."""
    p = float(np.max(np.abs(audio))) if audio.size else 0.0
    if p <= 0:
        return audio
    return (audio * (target_peak / p)).astype(np.float32)


def preprocess_ref_audio(input_path: str | Path,
                         target_sr: int = 16000,
                         normalize: bool = True) -> str:
    """Đọc → trim silence → (optional) normalize → ghi WAV tạm. Trả về
    path string để caller đưa thẳng vào create_voice_clone_prompt.

    Caller chịu trách nhiệm xoá file tạm sau khi dùng xong (dùng tempfile
    với delete=False bên dưới — caller os.remove khi done).

    Nếu lỗi (file hỏng v.v.) → log warn + trả về input_path nguyên gốc.
    """
    input_path = str(input_path)
    try:
        audio, sr = sf.read(input_path, dtype="float32")
        audio = _ensure_mono_array(audio)
        # Resample nếu cần — soundfile không resample, dùng numpy linear interp
        if sr != target_sr:
            ratio = target_sr / sr
            new_len = int(round(audio.size * ratio))
            xp = np.linspace(0, audio.size - 1, audio.size)
            x = np.linspace(0, audio.size - 1, new_len)
            audio = np.interp(x, xp, audio).astype(np.float32)
            sr = target_sr

        before = audio.size / sr
        audio = _trim_silence_np(audio, sr, threshold_db=-40.0, pad_ms=50)
        after = audio.size / sr
        if before - after > 0.05:
            logger.info("ref audio trimmed: %.2fs → %.2fs", before, after)

        if normalize and audio.size:
            audio = _peak_normalize(audio, target_peak=0.95)

        # Hard cap 30s — quá dài làm prompt OOM/slow
        max_samples = 30 * sr
        if audio.size > max_samples:
            logger.info("ref audio capped 30s (was %.1fs)", audio.size / sr)
            audio = audio[:max_samples]

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp_path = tmp.name
        sf.write(tmp_path, audio, sr, subtype="PCM_16")
        return tmp_path
    except Exception as e:
        logger.warning("preprocess_ref_audio failed (%s), using original: %s",
                       input_path, e)
        return input_path
