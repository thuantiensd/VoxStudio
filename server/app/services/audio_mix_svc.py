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


def _voice_chain(sr: int, gender: str | None = None):
    """Build voice processing chain — neutral default + gender-tuned variants.

    Studio mixing per gender:
      - Male: warm low-mid boost (200-500Hz) + slight presence + soft de-ess
      - Female: bright air boost (8-12kHz) + cut mud (250Hz) + stronger de-ess
        (female sibilance higher, more prominent)
      - None/unknown: neutral
    """
    from pedalboard import (
        Pedalboard, HighpassFilter, HighShelfFilter, LowShelfFilter, PeakFilter,
        Compressor, Gain,
    )
    g = (gender or "").lower()

    # Soften values — feedback "rè rè chói chói" do quá nhiều high-shelf
    # cut + compression dồn dập. Giảm de-esser, presence boost, gain để
    # voice nghe tự nhiên hơn.
    if g == "male":
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=70),
            LowShelfFilter(cutoff_frequency_hz=250, gain_db=1.0),
            # Light de-esser, không cut mạnh
            HighShelfFilter(cutoff_frequency_hz=8000, gain_db=-1.0),
            # Soft presence
            PeakFilter(cutoff_frequency_hz=3000, gain_db=0.8, q=1.0),
            # Compression nhẹ hơn
            Compressor(threshold_db=-20, ratio=2.5, attack_ms=8, release_ms=120),
            Gain(gain_db=1.0),
        ])

    if g == "female":
        return Pedalboard([
            HighpassFilter(cutoff_frequency_hz=90),
            # Light mud cut
            PeakFilter(cutoff_frequency_hz=300, gain_db=-0.8, q=1.0),
            # De-esser nhẹ — không narrow cut nữa (đó là cause chói)
            HighShelfFilter(cutoff_frequency_hz=7500, gain_db=-1.5),
            # Soft presence
            PeakFilter(cutoff_frequency_hz=3500, gain_db=0.5, q=1.0),
            # Air boost giảm
            HighShelfFilter(cutoff_frequency_hz=11000, gain_db=0.8),
            # Compression nhẹ
            Compressor(threshold_db=-22, ratio=2.5, attack_ms=8, release_ms=100),
            Gain(gain_db=1.0),
        ])

    # Default neutral chain — gentle
    return Pedalboard([
        HighpassFilter(cutoff_frequency_hz=80),
        HighShelfFilter(cutoff_frequency_hz=7500, gain_db=-1.0),
        PeakFilter(cutoff_frequency_hz=3000, gain_db=0.8, q=1.0),
        Compressor(threshold_db=-20, ratio=2.5, attack_ms=8, release_ms=120),
        Gain(gain_db=1.0),
    ])


def apply_voice_chain(audio: np.ndarray, sr: int, gender: str | None = None) -> np.ndarray:
    """Apply gender-tuned voice processing chain to a TTS batch audio."""
    if audio.size == 0:
        return audio
    try:
        chain = _voice_chain(sr, gender=gender)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return chain(audio.astype(np.float32), sr)
    except Exception as e:
        logger.warning("apply_voice_chain failed (%s, gender=%s) — return raw", e, gender)
        return audio.astype(np.float32) if audio.dtype != np.float32 else audio


def normalize_loudness_rms(audio: np.ndarray, target_dbfs: float = -20.0,
                           max_gain_db: float = 12.0) -> np.ndarray:
    """RMS-normalize audio to target dBFS. Cap gain to ±max_gain_db để
    không boost noise floor lên thành tiếng ồn lớn.

    Dùng cho mỗi batch TTS để tất cả segment cùng volume khi mix vào track —
    tránh batch nào nhỏ hơn batch nào.
    """
    if audio.size == 0:
        return audio
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2) + 1e-12))
    if rms < 1e-6:
        return audio
    cur_dbfs = 20.0 * np.log10(rms)
    gain_db = target_dbfs - cur_dbfs
    gain_db = max(-max_gain_db, min(max_gain_db, gain_db))
    factor = 10.0 ** (gain_db / 20.0)
    return (audio * factor).astype(np.float32)


def crossfade_concat(prev: np.ndarray, cur: np.ndarray, fade_samples: int) -> np.ndarray:
    """Concat 2 audio buffers với crossfade ở junction để tránh click/pop.
    Cur sẽ overlap fade_samples cuối của prev. Trả buffer mới length =
    len(prev) + len(cur) - fade_samples.
    """
    if fade_samples <= 0 or len(prev) < fade_samples or len(cur) < fade_samples:
        return np.concatenate([prev, cur])
    fade_in = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
    fade_out = 1.0 - fade_in
    out = np.zeros(len(prev) + len(cur) - fade_samples, dtype=np.float32)
    out[: len(prev) - fade_samples] = prev[: -fade_samples]
    # Overlap region
    overlap = prev[-fade_samples:] * fade_out + cur[:fade_samples] * fade_in
    out[len(prev) - fade_samples : len(prev)] = overlap
    out[len(prev) :] = cur[fade_samples:]
    return out


def fade_edges(audio: np.ndarray, sr: int, fade_ms: float = 30.0) -> np.ndarray:
    """Apply linear fade-in + fade-out cho audio (default 30ms mỗi đầu).
    Dùng khi place batch vào silent track — tránh click khi voice start/end abrupt."""
    if audio.size == 0:
        return audio
    fade_samples = min(int(sr * fade_ms / 1000), len(audio) // 4)
    if fade_samples <= 0:
        return audio
    out = audio.astype(np.float32).copy()
    fade_in = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
    fade_out = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
    out[:fade_samples] *= fade_in
    out[-fade_samples:] *= fade_out
    return out


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


# ── Pre-Whisper amplification ──────────────────────────────
def normalize_for_stt(input_path: str, output_path: str,
                       target_lufs: float = -16.0,
                       compression_threshold: float = -28.0,
                       compression_ratio: float = 4.0) -> None:
    """Normalize + dynamically compress audio so Whisper catches quiet speech.

    Quiet whispers / internal monologues often get filtered as silence by Whisper.
    Pre-processing chain:
      1. Compressor (4:1 from -28dB) — bring quiet up, leave loud alone
      2. LUFS normalize to -16 — consistent loudness
      3. Limiter at -1dBFS — prevent clipping

    Use this on vocals.wav (after Demucs) BEFORE feeding to Whisper.
    """
    import numpy as np
    import soundfile as sf
    from pedalboard import Pedalboard, Compressor, Limiter, HighpassFilter

    # Load audio (force mono for STT)
    audio, sr = sf.read(input_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    # Pre-STT chain
    chain = Pedalboard([
        HighpassFilter(cutoff_frequency_hz=60),       # remove rumble
        Compressor(threshold_db=compression_threshold,
                   ratio=compression_ratio,
                   attack_ms=10, release_ms=120),     # boost quiet
    ])
    processed = chain(audio, sr)

    # LUFS normalize
    try:
        import pyloudnorm as pyln
        meter = pyln.Meter(sr)
        current_lufs = meter.integrated_loudness(processed)
        if np.isfinite(current_lufs) and current_lufs > -70:
            processed = pyln.normalize.loudness(processed, current_lufs, target_lufs)
            logger.info("STT pre-amp: LUFS %.1f → %.1f", current_lufs, target_lufs)
    except Exception as e:
        logger.warning("LUFS normalize skipped: %s", e)

    # Final limiter
    limiter = Pedalboard([Limiter(threshold_db=-1.0, release_ms=100)])
    processed = limiter(processed.astype(np.float32), sr)

    # Safety
    peak = float(np.abs(processed).max())
    if peak > 0.95:
        processed = processed * (0.95 / peak)

    sf.write(output_path, processed, sr)
    logger.info("STT pre-amp wrote %s (peak=%.3f)", output_path, float(np.abs(processed).max()))
