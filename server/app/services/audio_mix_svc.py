"""Professional audio mix chain — replaces the DIY envelope-follower ducking.

Architecture (signal flow):

    Voice (dubbed TTS)         BGM (accompaniment from Demucs)
           │                          │
    ┌──────▼──────────┐        ┌──────▼──────────┐
    │ Voice Chain     │        │ BGM Chain       │
    │ - HPF 80Hz      │        │ - HPF 150Hz     │
    │ - De-ess shelf  │        │ - Pre-duck EQ   │
    │ - Presence +    │        │ - Compressor    │
    │ - Compressor    │        │                 │
    │ - Make-up gain  │        │                 │
    └──────┬──────────┘        └──────┬──────────┘
           │                          │
           │           ┌──────────────┤
           │           │
           │    ┌──────▼──────────┐
           │    │ Sidechain duck  │ ← driven by voice envelope
           │    │ (apply gain env │
           │    │  to BGM)        │
           │    └──────┬──────────┘
           │           │
           └─────┬─────┘
                 ▼
    ┌────────────────────────┐
    │ Master Bus             │
    │ - Glue compressor      │
    │ - Limiter -1 dBTP      │
    │ - LUFS normalize -16   │
    └────────────────────────┘
                 ▼
           Final mix

Tools: pedalboard (Spotify OSS) + pyloudnorm. Both pip-installable, no GPU.
"""

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


def _voice_chain(sr: int):
    """Build voice processing chain: clean, present, leveled."""
    from pedalboard import (
        Pedalboard, HighpassFilter, HighShelfFilter, PeakFilter,
        Compressor, Gain,
    )
    return Pedalboard([
        # 1. Remove mic rumble / HVAC noise below speech range
        HighpassFilter(cutoff_frequency_hz=80),
        # 2. De-esser (approximation): tame harsh sibilance 6-8kHz
        HighShelfFilter(cutoff_frequency_hz=7000, gain_db=-2.5),
        # 3. Presence boost for intelligibility (consonant clarity)
        PeakFilter(cutoff_frequency_hz=3000, gain_db=1.5, q=1.0),
        # 4. Compression to even out loud/quiet parts
        Compressor(threshold_db=-18, ratio=3.0, attack_ms=5, release_ms=80),
        # 5. Make-up gain
        Gain(gain_db=2.0),
    ])


def _bgm_chain(sr: int):
    """Build BGM processing chain: clean low-mud + leave space for voice."""
    from pedalboard import (
        Pedalboard, HighpassFilter, LowShelfFilter, PeakFilter, Compressor,
    )
    return Pedalboard([
        # Remove sub rumble from BGM too
        HighpassFilter(cutoff_frequency_hz=60),
        # Gentle dip in 300-500 Hz (vocal fundamentals) to reduce mud
        PeakFilter(cutoff_frequency_hz=400, gain_db=-1.5, q=0.8),
        # Light compression for consistency
        Compressor(threshold_db=-20, ratio=2.0, attack_ms=10, release_ms=150),
    ])


def _master_glue(sr: int):
    """Master bus pre-LUFS: glue compression only (no limiter yet)."""
    from pedalboard import Pedalboard, Compressor
    return Pedalboard([
        Compressor(threshold_db=-12, ratio=2.0, attack_ms=20, release_ms=250),
    ])


def _final_limiter(sr: int):
    """True-peak limiter applied AFTER LUFS normalize to prevent clipping."""
    from pedalboard import Pedalboard, Limiter
    return Pedalboard([
        Limiter(threshold_db=-1.0, release_ms=100),
    ])


def _build_sidechain_envelope(
    voice: np.ndarray, sr: int,
    attack_ms: float = 15.0, release_ms: float = 200.0,
    threshold_db: float = -30.0, ratio: float = 4.0,
    window_ms: float = 20.0,
) -> np.ndarray:
    """Compute per-sample ducking gain driven by voice RMS envelope.

    Returns gain array in [~0.2, 1.0] — multiply BGM by this to duck under voice.
    """
    # 1. RMS envelope (short window)
    win = max(1, int(sr * window_ms / 1000))
    hop = max(1, win // 4)

    # Pad voice to ensure we can compute envelope over full length
    v = voice.astype(np.float32)
    if v.ndim > 1:
        v = v.mean(axis=1)

    # Compute RMS over sliding windows
    n_frames = (len(v) - win) // hop + 1
    if n_frames < 2:
        return np.ones(len(v), dtype=np.float32)

    rms = np.zeros(n_frames, dtype=np.float32)
    for i in range(n_frames):
        frame = v[i * hop : i * hop + win]
        rms[i] = np.sqrt(np.mean(frame * frame) + 1e-12)

    # 2. Convert RMS to dB
    rms_db = 20.0 * np.log10(rms + 1e-12)

    # 3. Soft-knee gain reduction (classic compressor math)
    over = np.maximum(0.0, rms_db - threshold_db)
    reduction_db = over * (1.0 - 1.0 / ratio)

    # 4. Smooth with attack/release coefficients (exponential)
    frame_period_ms = 1000.0 * hop / sr
    attack_coef = np.exp(-frame_period_ms / max(attack_ms, 1))
    release_coef = np.exp(-frame_period_ms / max(release_ms, 1))

    smoothed_db = np.zeros_like(reduction_db)
    for i in range(1, len(reduction_db)):
        target = reduction_db[i]
        prev = smoothed_db[i - 1]
        if target > prev:  # attacking (more reduction)
            smoothed_db[i] = attack_coef * prev + (1 - attack_coef) * target
        else:  # releasing (less reduction)
            smoothed_db[i] = release_coef * prev + (1 - release_coef) * target

    # 5. Convert back to linear gain
    gain_frames = 10.0 ** (-smoothed_db / 20.0)

    # 6. Upsample to per-sample via linear interpolation
    frame_positions = np.arange(n_frames) * hop + win // 2
    sample_positions = np.arange(len(v))
    gain_samples = np.interp(sample_positions, frame_positions, gain_frames)

    # Clamp to sensible range (don't duck below -20dB)
    return np.clip(gain_samples, 0.1, 1.0).astype(np.float32)


def _pad_to_length(x: np.ndarray, length: int) -> np.ndarray:
    if len(x) >= length:
        return x[:length]
    return np.pad(x, (0, length - len(x)), mode="constant")


def pro_mix(
    voice: np.ndarray,
    bgm: np.ndarray,
    sr: int,
    voice_gain_db: float = 0.0,
    bgm_gain_db: float = -3.0,
    duck_threshold_db: float = -30.0,
    duck_ratio: float = 4.0,
    target_lufs: float = -16.0,
) -> np.ndarray:
    """Run voice + BGM through the professional mix chain.

    Args:
      voice: dubbed voice track, float32 mono @ sr
      bgm: accompaniment track, float32 mono @ sr
      sr: sample rate
      voice_gain_db: static gain on voice bus (default 0)
      bgm_gain_db: static gain on BGM bus (default -3, voice hotter)
      duck_threshold_db: voice level above which BGM starts ducking
      duck_ratio: compression ratio for sidechain
      target_lufs: final loudness target (YouTube = -14, most platforms -16)

    Returns:
      float32 mixed audio @ sr, LUFS normalized, limited to -1 dBTP.
    """
    import pyloudnorm as pyln

    if voice.ndim > 1:
        voice = voice.mean(axis=1)
    if bgm.ndim > 1:
        bgm = bgm.mean(axis=1)
    voice = voice.astype(np.float32)
    bgm = bgm.astype(np.float32)

    # Align lengths (pad shorter to longer)
    target_len = max(len(voice), len(bgm))
    voice = _pad_to_length(voice, target_len)
    bgm = _pad_to_length(bgm, target_len)

    logger.info("pro_mix: %.1fs @ %dHz (voice peak=%.3f, bgm peak=%.3f)",
                target_len / sr, sr, np.abs(voice).max(), np.abs(bgm).max())

    # ── Voice bus ──
    voice_processed = _voice_chain(sr)(voice, sr)
    if voice_gain_db != 0.0:
        voice_processed = voice_processed * (10.0 ** (voice_gain_db / 20.0))

    # ── BGM bus ──
    bgm_processed = _bgm_chain(sr)(bgm, sr)
    if bgm_gain_db != 0.0:
        bgm_processed = bgm_processed * (10.0 ** (bgm_gain_db / 20.0))

    # ── Sidechain ducking (BGM ducks under voice) ──
    duck_gain = _build_sidechain_envelope(
        voice_processed, sr,
        threshold_db=duck_threshold_db,
        ratio=duck_ratio,
    )
    # Ensure same length
    duck_gain = _pad_to_length(duck_gain, len(bgm_processed))
    bgm_ducked = bgm_processed * duck_gain
    logger.info("pro_mix: sidechain gain min=%.2f mean=%.2f",
                float(duck_gain.min()), float(duck_gain.mean()))

    # ── Sum ──
    mixed = voice_processed + bgm_ducked

    # ── Master glue (compressor only, no limiter yet) ──
    mastered = _master_glue(sr)(mixed, sr)

    # ── LUFS normalize BEFORE final limiter ──
    try:
        meter = pyln.Meter(sr)
        current_lufs = meter.integrated_loudness(mastered)
        if np.isfinite(current_lufs) and current_lufs > -70:
            mastered = pyln.normalize.loudness(mastered, current_lufs, target_lufs)
            logger.info("pro_mix: LUFS %.1f → %.1f", current_lufs, target_lufs)
        else:
            logger.warning("pro_mix: LUFS measure unstable (%.1f) — skip normalize",
                           current_lufs)
    except Exception as e:
        logger.warning("pro_mix: LUFS normalize failed (%s)", e)

    # ── Final true-peak limiter (catches LUFS-boosted peaks) ──
    mastered = _final_limiter(sr)(mastered.astype(np.float32), sr)

    # Headroom belt: cap at -1 dBFS (0.891) to survive lossy encoding (MP3/AAC)
    # Inter-sample peaks can clip at 0dBFS in codecs → always leave ≥1dB headroom.
    HEADROOM_PEAK = 0.891  # ≈ -1 dBFS
    peak = float(np.abs(mastered).max())
    if peak > HEADROOM_PEAK:
        mastered = mastered * (HEADROOM_PEAK / peak)

    logger.info("pro_mix: done, final peak=%.3f", float(np.abs(mastered).max()))
    return mastered.astype(np.float32)
