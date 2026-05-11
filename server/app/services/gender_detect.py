"""Per-speaker gender detection sau WhisperX diarize.

Port từ speaker_pipeline/gender.py (4-feature ensemble + cross-compare).
Đầu vào: audio path + WhisperX segments (đã có speaker labels).
Đầu ra: {speaker_id: {"gender": str, "confidence": float, "features": dict}}.

4 features:
  1. f0_median       (librosa.pyin)
  2. f0_std           (variance)
  3. spectral_centroid (mean Hz)
  4. formant_F1       (LPC autocorrelation + Levinson-Durbin)

Decision tree ensemble vote, weighted, + cross-speaker compare.
Confidence < 0.55 → "unknown" (caller có thể bỏ qua hoặc treat khác).
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


F0_MIN = 70.0
F0_MAX = 400.0


# ── Audio I/O helpers ────────────────────────────────────────

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


# ── 4 features extract ───────────────────────────────────────

def _extract_4_features(audio: np.ndarray, sr: int) -> Optional[dict]:
    """Extract f0_median, f0_std, spectral_centroid, formant_f1.
    Return None nếu audio quá ngắn / im lặng."""
    try:
        import librosa
    except ImportError:
        return None

    if len(audio) < sr * 0.5:
        return None
    peak = float(np.max(np.abs(audio))) if audio.size else 0
    if peak < 1e-4:
        return None
    audio = audio / peak

    # F0 (median + std)
    try:
        f0, _, voiced_prob = librosa.pyin(
            audio, fmin=F0_MIN, fmax=F0_MAX, sr=sr, frame_length=2048,
        )
    except Exception:
        return None
    if f0 is None:
        return None
    mask = ~np.isnan(f0)
    if voiced_prob is not None:
        mask &= voiced_prob > 0.5
    valid = f0[mask]
    if len(valid) < 5:
        return None
    f0_median = float(np.median(valid))
    f0_std = float(np.std(valid))

    # Spectral centroid (loại frame im lặng)
    try:
        sc = librosa.feature.spectral_centroid(y=audio, sr=sr).flatten()
        rms = librosa.feature.rms(y=audio).flatten()
        energy_mask = rms > rms.mean() * 0.3
        if energy_mask.sum() > 5:
            sc_clean = sc[: len(energy_mask)][energy_mask[: len(sc)]]
            centroid = float(np.mean(sc_clean))
        else:
            centroid = float(np.mean(sc))
    except Exception:
        centroid = 0.0

    # Formant F1 via LPC
    f1 = _estimate_formant_f1(audio, sr)

    return {
        "f0_median": f0_median,
        "f0_std": f0_std,
        "spectral_centroid": centroid,
        "formant_f1": f1,
    }


def _estimate_formant_f1(audio: np.ndarray, sr: int) -> float:
    """LPC analysis → F1 formant (250-900 Hz range).
    Lấy MEDIAN candidates để robust với noise."""
    try:
        from scipy.signal import lfilter
    except ImportError:
        return 0.0
    if len(audio) < sr * 0.3:
        return 0.0

    mid = len(audio) // 2
    half = min(sr, mid)
    seg = audio[mid - half : mid + half]
    if seg.size < 1024:
        return 0.0
    seg = lfilter([1.0, -0.97], [1.0], seg)
    seg = seg * np.hamming(len(seg))

    order = 2 + int(sr / 1000)
    try:
        r = np.correlate(seg, seg, mode="full")[len(seg) - 1:]
        if r[0] <= 1e-9:
            return 0.0
        a = _levinson(r[: order + 1])
        if a is None:
            return 0.0
        roots = np.roots(a)
        roots = roots[np.imag(roots) >= 0]
        if len(roots) == 0:
            return 0.0
        angles = np.angle(roots)
        freqs = angles * sr / (2 * np.pi)
        # F1 typical 250-900 Hz, lấy median tránh F0 confusion
        candidates = [f for f in freqs if 250 < f < 900]
        if not candidates:
            return 0.0
        return float(np.median(candidates))
    except Exception:
        return 0.0


def _levinson(r: np.ndarray) -> Optional[np.ndarray]:
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


# ── Ensemble classifier ──────────────────────────────────────

def _classify_ensemble(features: dict) -> tuple[str, float]:
    """Ensemble vote 3 features. Return (gender, confidence)."""
    f0 = features.get("f0_median", 0)
    f0_std = features.get("f0_std", 0)
    centroid = features.get("spectral_centroid", 0)
    f1 = features.get("formant_f1", 0)

    if f0 < F0_MIN or f0 > F0_MAX:
        return "unknown", 0.0
    if f0_std > 50:
        return "unknown", 0.3

    male_score = 0.0
    female_score = 0.0

    # F0 vote (weight 0.4)
    if f0 < 145:
        male_score += 0.4
    elif f0 > 195:
        female_score += 0.4
    elif f0 < 170:
        male_score += 0.2; female_score += 0.05
    else:
        female_score += 0.2; male_score += 0.05

    # Spectral centroid (weight 0.3)
    if centroid > 0:
        if centroid < 2100:
            male_score += 0.3
        elif centroid > 2600:
            female_score += 0.3
        elif centroid < 2350:
            male_score += 0.15
        else:
            female_score += 0.15

    # Formant F1 (weight 0.3)
    if f1 > 0:
        if f1 < 550:
            male_score += 0.3
        elif f1 > 700:
            female_score += 0.3
        elif f1 < 625:
            male_score += 0.15
        else:
            female_score += 0.15

    total = male_score + female_score
    if total < 0.4:
        return "unknown", 0.3

    if male_score > female_score:
        return "male", male_score / max(total, 1.0)
    if female_score > male_score:
        return "female", female_score / max(total, 1.0)
    return "unknown", 0.5


# ── Speaker audio extraction ─────────────────────────────────

def _gather_speaker_audio(
    audio: np.ndarray, sr: int,
    speaker_turns: list[tuple[float, float]],
    target_seconds: float = 5.0,
) -> Optional[np.ndarray]:
    """Concatenate audio chunks, ưu tiên turn dài nhất."""
    if not speaker_turns:
        return None
    sorted_turns = sorted(speaker_turns, key=lambda t: t[1] - t[0], reverse=True)
    chunks = []
    total = 0.0
    for start, end in sorted_turns:
        if total >= target_seconds:
            break
        s_idx = max(0, int(start * sr))
        e_idx = min(len(audio), int(end * sr))
        if e_idx <= s_idx:
            continue
        chunks.append(audio[s_idx:e_idx])
        total += (e_idx - s_idx) / sr
    if total < 0.5:
        return None
    return np.concatenate(chunks) if chunks else None


# ── Public API ───────────────────────────────────────────────

def detect_gender_per_speaker(
    audio_path: str,
    segments: list[dict],
) -> dict[str, dict]:
    """Detect gender + confidence per speaker_id từ WhisperX segments.

    Args:
      audio_path: vocals.wav hoặc audio path
      segments: WhisperX output — mỗi seg có "start", "end", "speaker"

    Returns: {speaker_id: {"gender", "confidence", "features"}}
       gender ∈ {"male", "female", "unknown"}
       confidence ∈ [0, 1]
       confidence < 0.55 → gender forced "unknown" (caller cycle slot)
    """
    # Group turns by speaker
    speaker_turns: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for seg in segments:
        spk = seg.get("speaker")
        if spk:
            speaker_turns[spk].append((float(seg["start"]), float(seg["end"])))

    speakers = list(speaker_turns.keys())
    if not speakers:
        logger.info("No speakers in segments — skip gender detect")
        return {}

    # Load audio
    try:
        audio, sr = _read_audio_mono(audio_path)
    except Exception as e:
        logger.warning("Cannot read audio: %s", e)
        return {spk: {"gender": "unknown", "confidence": 0.0, "features": {}}
                for spk in speakers}
    audio16, sr16 = _resample_16k(audio, sr)

    # Extract features per speaker
    features_per_spk: dict[str, dict] = {}
    for spk in speakers:
        seg_audio = _gather_speaker_audio(audio16, sr16, speaker_turns[spk])
        if seg_audio is None:
            continue
        feat = _extract_4_features(seg_audio, sr16)
        if feat:
            features_per_spk[spk] = feat

    # Cross-speaker F0 compare (chỉ kick khi rõ ràng)
    cross_decisions: dict[str, tuple[str, float]] = {}
    if len(features_per_spk) >= 2:
        sorted_spk = sorted(
            features_per_spk.items(),
            key=lambda kv: kv[1].get("f0_median", 0),
        )
        low_spk, low_feat = sorted_spk[0]
        high_spk, high_feat = sorted_spk[-1]
        low_f0 = low_feat.get("f0_median", 0)
        high_f0 = high_feat.get("f0_median", 0)
        f0_diff = high_f0 - low_f0
        if f0_diff > 25 and low_f0 < 185 and high_f0 > 185:
            cross_decisions = {low_spk: ("male", 0.80), high_spk: ("female", 0.80)}
            logger.info(
                "Gender cross-compare: low=%s %.0fHz, high=%s %.0fHz → confident",
                low_spk, low_f0, high_spk, high_f0,
            )

    # Classify each speaker
    out: dict[str, dict] = {}
    for spk in speakers:
        feat = features_per_spk.get(spk)
        if not feat:
            out[spk] = {"gender": "unknown", "confidence": 0.0, "features": {}}
            continue
        if spk in cross_decisions:
            gender, conf = cross_decisions[spk]
        else:
            gender, conf = _classify_ensemble(feat)
        display = gender if conf >= 0.55 else "unknown"
        out[spk] = {
            "gender": display,
            "raw_gender": gender,
            "confidence": round(conf, 2),
            "features": {k: round(v, 1) for k, v in feat.items()},
        }
        logger.info(
            "Gender %s: F0=%.0f±%.0f centroid=%.0f F1=%.0f → %s (conf=%.2f)",
            spk, feat["f0_median"], feat["f0_std"],
            feat["spectral_centroid"], feat["formant_f1"],
            display, conf,
        )
    return out
