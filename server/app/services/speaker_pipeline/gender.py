"""Phase 4b — Gender detection per speaker (F0 từ voiced frames).

Đầu vào: clean vocals audio + diarization turns đã reID stable speaker IDs.
Đầu ra: {speaker_id: "male"|"female"|"unknown"}.

Tại sao đặt sau reID (không phải trên Whisper segment): Whisper segment
boundary không match speaker turn — 1 segment có thể chứa overlap 2 speaker.
Diarization turn = pure speaker → F0 chính xác hơn.

Algorithm:
  1. Per speaker, gom 3-4s audio quality cao (turn dài nhất đầu tiên).
  2. Resample 16kHz mono.
  3. librosa.pyin để estimate F0 — robust hơn yin với octave error.
  4. Lọc voiced frames (probability > 0.5 + F0 ∈ [70, 400]).
  5. Lấy MEDIAN F0 (không mean — tránh outlier).
  6. Threshold:
       median < 165 Hz → male
       median ≥ 165 Hz → female
       <70 hoặc >400 (rare) → unknown

Threshold 165 Hz là conservative (literature avg male ~120, female ~210).
"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from .types import DiarizationTurn

logger = logging.getLogger(__name__)


# F0 ranges (Hz)
F0_MIN = 70.0
F0_MAX = 400.0
GENDER_THRESHOLD = 165.0  # < male, >= female


def _read_audio_mono(audio_path: str) -> tuple[np.ndarray, int]:
    """Đọc audio file, convert mono. Return (audio float32, sr)."""
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio.astype(np.float32), int(sr)


def _resample_16k(audio: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    if sr == 16000:
        return audio, 16000
    try:
        import librosa
        return librosa.resample(audio, orig_sr=sr, target_sr=16000), 16000
    except Exception:
        return audio, sr


def _estimate_median_f0(audio: np.ndarray, sr: int) -> Optional[float]:
    """Median F0 from voiced frames using librosa.pyin.

    Returns None nếu không có voiced frame nào.
    """
    try:
        import librosa
    except ImportError:
        logger.warning("librosa not installed — skip gender detection")
        return None

    if len(audio) < sr * 0.5:  # cần ít nhất 0.5s
        return None

    # Normalize
    peak = np.max(np.abs(audio))
    if peak < 1e-4:
        return None
    audio = audio / peak

    try:
        f0, voiced_flag, voiced_prob = librosa.pyin(
            audio,
            fmin=F0_MIN,
            fmax=F0_MAX,
            sr=sr,
            frame_length=2048,
        )
    except Exception as e:
        logger.warning("pyin failed: %s", e)
        return None

    if f0 is None:
        return None
    valid = f0[~np.isnan(f0)]
    # Loại điểm không voiced (tránh f0 hallucination ở silence)
    if voiced_prob is not None:
        mask = (~np.isnan(f0)) & (voiced_prob > 0.5)
        if mask.sum() > 5:
            valid = f0[mask]
    if len(valid) < 5:
        return None
    return float(np.median(valid))


def _gather_speaker_audio(
    audio: np.ndarray, sr: int, turns: list[DiarizationTurn], speaker_id: str,
    target_seconds: float = 4.0,
) -> Optional[np.ndarray]:
    """Concatenate audio chunks của 1 speaker, ưu tiên turn dài nhất trước.

    Trả None nếu < 0.5s tổng cộng.
    """
    spk_turns = sorted(
        [t for t in turns if t.speaker == speaker_id],
        key=lambda t: t.end - t.start,
        reverse=True,
    )
    if not spk_turns:
        return None
    chunks: list[np.ndarray] = []
    total_sec = 0.0
    for t in spk_turns:
        if total_sec >= target_seconds:
            break
        s_idx = max(0, int(t.start * sr))
        e_idx = min(len(audio), int(t.end * sr))
        if e_idx <= s_idx:
            continue
        chunks.append(audio[s_idx:e_idx])
        total_sec += (e_idx - s_idx) / sr
    if total_sec < 0.5:
        return None
    return np.concatenate(chunks) if chunks else None


def detect_speaker_genders(
    audio_path: str,
    turns: list[DiarizationTurn],
    speakers: list[str],
) -> dict[str, str]:
    """Detect gender for each stable speaker_id.

    Returns: {speaker_id: "male"|"female"|"unknown"}.

    Note: chỉ là heuristic F0 → có thể nhầm với:
      - Speaker borderline (F0 ~155-175 Hz)
      - Trẻ em / giọng giả thanh / breathy voice
      - Audio noise/music chen vào turn
    Voice mapping nên fallback "any" slot khi unknown.
    """
    if not speakers:
        return {}

    try:
        audio, sr = _read_audio_mono(audio_path)
    except Exception as e:
        logger.warning("Cannot read audio for gender detection: %s", e)
        return {spk: "unknown" for spk in speakers}

    audio16, sr16 = _resample_16k(audio, sr)

    out: dict[str, str] = {}
    for spk in speakers:
        seg_audio = _gather_speaker_audio(audio16, sr16, turns, spk)
        if seg_audio is None:
            out[spk] = "unknown"
            continue
        f0 = _estimate_median_f0(seg_audio, sr16)
        if f0 is None or f0 < F0_MIN or f0 > F0_MAX:
            out[spk] = "unknown"
            continue
        gender = "male" if f0 < GENDER_THRESHOLD else "female"
        logger.info("Gender %s: median F0=%.0fHz → %s", spk, f0, gender)
        out[spk] = gender
    return out
