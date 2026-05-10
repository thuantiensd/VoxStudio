"""Phase 4b — Gender detection per speaker (4-feature classifier).

Đầu vào: clean vocals audio + diarization turns đã reID stable speaker IDs.
Đầu ra: {speaker_id: {"gender": "male"|"female"|"unknown", "confidence": 0-1}}.

Vì sao 4-feature thay vì F0-only:
  Trước chỉ dùng F0 → 2 nữ cùng pitch → cluster nhầm. F1 formant + spectral
  centroid + voicing quality bổ sung → distinguish được.

4 feature extracted per speaker (4-6s audio quality cao):
  1. f0_median (Hz)        — librosa.pyin (đã có)
  2. f0_std (Hz)           — variance F0, loại false positive
  3. spectral_centroid (Hz) — mean spectral center, nam thường <2200, nữ >2500
  4. formant_f1 (Hz)        — LPC analysis, nam ~500, nữ ~700

Decision tree (rule-based, no ML model — đủ 90%+ cho audio sạch):
  if f0 < 140 and centroid < 2200: male, conf 0.95
  if f0 > 200 and centroid > 2500: female, conf 0.95
  if 140 ≤ f0 ≤ 200 (borderline):
      if f1 < 600: male, conf 0.7
      else: female, conf 0.7
  if f0 < 70 hoặc > 400: unknown (audio noise)

Confidence < 0.7 → set "unknown" để voice mapping fall back cycle thay vì
guess sai.
"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from .types import DiarizationTurn

logger = logging.getLogger(__name__)


F0_MIN = 70.0
F0_MAX = 400.0


def _read_audio_mono(audio_path: str) -> tuple[np.ndarray, int]:
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


def _extract_4_features(audio: np.ndarray, sr: int) -> Optional[dict]:
    """Extract f0_median, f0_std, spectral_centroid, formant_f1.

    Returns None nếu không đủ dữ liệu (audio quá ngắn / im lặng).
    """
    try:
        import librosa
    except ImportError:
        logger.warning("librosa not installed — skip gender features")
        return None

    if len(audio) < sr * 0.5:
        return None

    # Normalize
    peak = np.max(np.abs(audio))
    if peak < 1e-4:
        return None
    audio = audio / peak

    # 1+2. F0 median + std từ librosa.pyin
    try:
        f0, _voiced_flag, voiced_prob = librosa.pyin(
            audio, fmin=F0_MIN, fmax=F0_MAX, sr=sr, frame_length=2048,
        )
    except Exception as e:
        logger.warning("pyin failed: %s", e)
        return None
    if f0 is None:
        return None
    mask = (~np.isnan(f0))
    if voiced_prob is not None:
        mask &= voiced_prob > 0.5
    valid_f0 = f0[mask]
    if len(valid_f0) < 5:
        return None
    f0_median = float(np.median(valid_f0))
    f0_std = float(np.std(valid_f0))

    # 3. Spectral centroid mean (Hz)
    try:
        sc = librosa.feature.spectral_centroid(y=audio, sr=sr).flatten()
        # Loại frame im lặng (low energy)
        rms = librosa.feature.rms(y=audio).flatten()
        energy_mask = rms > rms.mean() * 0.3
        if energy_mask.sum() > 5:
            sc_clean = sc[: len(energy_mask)][energy_mask[: len(sc)]]
            spectral_centroid = float(np.mean(sc_clean))
        else:
            spectral_centroid = float(np.mean(sc))
    except Exception as e:
        logger.warning("spectral_centroid failed: %s", e)
        spectral_centroid = 0.0

    # 4. Formant F1 via LPC analysis
    formant_f1 = _estimate_formant_f1(audio, sr)

    return {
        "f0_median": f0_median,
        "f0_std": f0_std,
        "spectral_centroid": spectral_centroid,
        "formant_f1": formant_f1,
    }


def _estimate_formant_f1(audio: np.ndarray, sr: int) -> float:
    """Estimate F1 formant qua LPC analysis. Returns Hz (0 if fail).

    Algorithm: pre-emphasize → window → LPC order 2+sr/1000 → roots → angle → Hz.
    Lấy formant thấp nhất voiced range (90-1500 Hz) làm F1.
    """
    try:
        from scipy.signal import lfilter
    except ImportError:
        return 0.0

    if len(audio) < sr * 0.3:
        return 0.0

    # Trung bình segment giữa 1s để tránh edge artifact
    mid = len(audio) // 2
    half = min(sr, mid)
    seg = audio[mid - half : mid + half]
    if seg.size < 1024:
        return 0.0

    # Pre-emphasize
    seg = lfilter([1.0, -0.97], [1.0], seg)
    # Hamming window
    seg = seg * np.hamming(len(seg))

    # LPC order ~ 2 + sr/1000
    order = 2 + int(sr / 1000)
    try:
        # autocorrelation method
        r = np.correlate(seg, seg, mode="full")[len(seg) - 1:]
        if r[0] <= 1e-9:
            return 0.0
        # Levinson-Durbin (manual, avoid librosa.lpc which has version issues)
        a = _levinson(r[: order + 1])
        if a is None:
            return 0.0
        roots = np.roots(a)
        roots = roots[np.imag(roots) >= 0]
        if len(roots) == 0:
            return 0.0
        angles = np.angle(roots)
        freqs = angles * sr / (2 * np.pi)
        # F1 = thấp nhất trong 90-1500 Hz
        candidates = [f for f in freqs if 90 < f < 1500]
        if not candidates:
            return 0.0
        return float(min(candidates))
    except Exception as e:
        logger.warning("formant LPC failed: %s", e)
        return 0.0


def _levinson(r: np.ndarray) -> Optional[np.ndarray]:
    """Levinson-Durbin recursion → LPC coefficients."""
    n = len(r) - 1
    if n < 1 or r[0] <= 0:
        return None
    a = np.zeros(n + 1)
    a[0] = 1.0
    e = r[0]
    for i in range(1, n + 1):
        k = -np.sum(a[:i] * r[i:0:-1]) / e
        a_new = a.copy()
        a_new[i] = k
        a_new[1:i] = a[1:i] + k * a[i - 1 : 0 : -1]
        a = a_new
        e *= 1 - k * k
        if e <= 0:
            return None
    return a


def _classify_gender(features: dict) -> tuple[str, float]:
    """Decision tree → (gender, confidence).

    confidence < 0.7 → caller treat as "unknown".
    """
    f0 = features.get("f0_median", 0)
    f0_std = features.get("f0_std", 0)
    centroid = features.get("spectral_centroid", 0)
    f1 = features.get("formant_f1", 0)

    # Out of range — unusable
    if f0 < F0_MIN or f0 > F0_MAX:
        return "unknown", 0.0

    # F0 std rất cao → có thể đang noise/music chen, not voice
    if f0_std > 50:
        return "unknown", 0.3

    # Clear male (low pitch + low centroid)
    if f0 < 140 and centroid < 2200:
        return "male", 0.95

    # Clear female (high pitch + high centroid)
    if f0 > 200 and centroid > 2500:
        return "female", 0.95

    # Borderline F0 — dùng F1 formant + centroid để quyết
    if 140 <= f0 <= 200:
        # F1 nam thường ~500, nữ ~700
        if f1 > 0:  # F1 estimate được
            if f1 < 600 and centroid < 2400:
                return "male", 0.75
            elif f1 > 650:
                return "female", 0.75
            else:
                # F1 ambiguous, fallback to F0+centroid
                if f0 < 170 and centroid < 2400:
                    return "male", 0.65
                else:
                    return "female", 0.65
        else:
            # No F1 → fallback F0 only borderline
            if f0 < 170:
                return "male", 0.55
            else:
                return "female", 0.55

    # F0 cao mà centroid thấp → unusual, give low confidence
    if f0 > 200 and centroid <= 2500:
        return "female", 0.6

    # F0 thấp mà centroid cao → unusual
    if f0 < 140 and centroid >= 2200:
        return "male", 0.6

    return "unknown", 0.4


def _gather_speaker_audio(
    audio: np.ndarray, sr: int, turns: list[DiarizationTurn], speaker_id: str,
    target_seconds: float = 5.0,
) -> Optional[np.ndarray]:
    """Concatenate audio chunks của 1 speaker, ưu tiên turn dài nhất."""
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
    """Backward-compat API — return {speaker_id: gender_string}.

    Gender confidence stored separately (caller có thể truy cập qua
    detect_speaker_genders_with_confidence).
    """
    full = detect_speaker_genders_with_confidence(audio_path, turns, speakers)
    return {spk: info["gender"] for spk, info in full.items()}


def detect_speaker_genders_with_confidence(
    audio_path: str,
    turns: list[DiarizationTurn],
    speakers: list[str],
) -> dict[str, dict]:
    """Detect gender + confidence per speaker.

    Returns: {speaker_id: {"gender": "male"|"female"|"unknown",
                           "confidence": float, "features": dict}}.
    Confidence < 0.7 → gender forced về "unknown" để voice mapping cycle
    thay vì guess sai.
    """
    if not speakers:
        return {}

    try:
        audio, sr = _read_audio_mono(audio_path)
    except Exception as e:
        logger.warning("Cannot read audio for gender: %s", e)
        return {spk: {"gender": "unknown", "confidence": 0.0, "features": {}}
                for spk in speakers}

    audio16, sr16 = _resample_16k(audio, sr)

    out: dict[str, dict] = {}
    for spk in speakers:
        seg_audio = _gather_speaker_audio(audio16, sr16, turns, spk)
        if seg_audio is None:
            out[spk] = {"gender": "unknown", "confidence": 0.0, "features": {}}
            continue
        features = _extract_4_features(seg_audio, sr16)
        if features is None:
            out[spk] = {"gender": "unknown", "confidence": 0.0, "features": {}}
            continue
        gender, conf = _classify_gender(features)
        # Force "unknown" nếu confidence quá thấp — voice mapping cycle slot
        if conf < 0.7:
            display_gender = "unknown"
        else:
            display_gender = gender
        out[spk] = {
            "gender": display_gender,
            "raw_gender": gender,  # giữ raw cho debug
            "confidence": round(conf, 2),
            "features": {k: round(v, 1) for k, v in features.items()},
        }
        logger.info(
            "Gender %s: F0=%.0fHz±%.0f centroid=%.0f F1=%.0f → %s (conf=%.2f)",
            spk, features["f0_median"], features["f0_std"],
            features["spectral_centroid"], features["formant_f1"],
            display_gender, conf,
        )
    return out
