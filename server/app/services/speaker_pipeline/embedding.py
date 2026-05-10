"""Phase 4 — Speaker embedding extraction.

Dùng pyannote/embedding (WeSpeaker-ResNet34, 256-d, trained on VoxCeleb).
Sản xuất 1 embedding per diarization turn để feed vào reID clustering.

Tại sao pyannote/embedding (KHÔNG phải Resemblyzer):
  - Pyannote đã có (HF_TOKEN dùng chung diarize)
  - WeSpeaker SOTA cho speaker reID (EER ~1% trên VoxCeleb-O)
  - Resemblyzer cũ hơn (2018), dataset hạn chế
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Optional

import numpy as np

from .types import DiarizationTurn, SpeakerEmbedding

logger = logging.getLogger(__name__)


_inference_lock = threading.Lock()
_inference: object | None = None  # pyannote.audio.Inference instance


def _load_inference() -> object:
    """Lazy-load pyannote embedding MODEL trực tiếp (bypass Inference wrapper
    do pyannote 4.x bug "'str' object has no attribute 'type'").

    Trả thẳng model object — caller tự handle audio + forward pass.
    """
    global _inference
    if _inference is not None:
        return _inference
    with _inference_lock:
        if _inference is not None:
            return _inference
        token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
        if not token:
            raise RuntimeError(
                "HF_TOKEN required for pyannote embedding."
            )
        try:
            from pyannote.audio import Model
            import torch
        except ImportError as e:
            raise RuntimeError("pyannote.audio not installed") from e

        logger.info("Loading pyannote/embedding model (direct)...")
        try:
            model = Model.from_pretrained("pyannote/embedding", token=token)
        except TypeError:
            model = Model.from_pretrained("pyannote/embedding", use_auth_token=token)
        model.eval()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model.to(device)
        _inference = {"model": model, "device": device}
        logger.info("pyannote/embedding ready (device=%s)", device)
        return _inference


def _audio_quality_score(audio: np.ndarray, sr: int) -> float:
    """Heuristic SNR-based quality 0-1. Higher = cleaner voice.

    Logic: signal-to-noise ratio dựa trên RMS của top 25% loudest frames vs
    bottom 25%. Voice rõ → ratio cao. Audio toàn noise → ratio ~1.
    """
    if audio.size < sr * 0.3:
        return 0.0
    frame_size = int(sr * 0.025)  # 25ms frames
    hop = frame_size // 2
    n_frames = max(1, (len(audio) - frame_size) // hop + 1)
    energies = np.array([
        float(np.sqrt(np.mean(audio[i * hop : i * hop + frame_size] ** 2)))
        for i in range(n_frames)
    ])
    if energies.size < 4 or float(energies.max()) <= 1e-6:
        return 0.0
    top_q = np.quantile(energies, 0.75)
    bot_q = np.quantile(energies, 0.25)
    if bot_q <= 1e-9:
        return 1.0
    snr = top_q / bot_q
    # Map snr → 0-1 (snr ≥ 4 = clean voice ≈ 1.0, snr ~ 1 = noise)
    quality = float(np.clip((snr - 1.0) / 3.0, 0.0, 1.0))
    return quality


def extract_embeddings(
    audio_path: str,
    turns: list[DiarizationTurn],
    min_duration: float = 0.5,
) -> list[SpeakerEmbedding]:
    """Extract 1 embedding per diarization turn.

    Args:
      audio_path: clean audio (vocals.wav preferable)
      turns: từ Phase 3
      min_duration: skip turns ngắn hơn (embedding noisy)

    Returns: list embeddings — same length as filtered turns
    """
    if not turns:
        return []

    inference_info = _load_inference()
    model = inference_info["model"]
    device = inference_info["device"]

    import torch
    # Đọc audio 1 lần
    import soundfile as sf
    audio_full, sr_full = sf.read(audio_path, dtype="float32")
    if audio_full.ndim > 1:
        audio_full = audio_full.mean(axis=1)

    # Resample whole audio sang 16kHz (pyannote/embedding train 16k)
    target_sr = 16000
    if sr_full != target_sr:
        import librosa
        audio16 = librosa.resample(audio_full, orig_sr=sr_full, target_sr=target_sr)
    else:
        audio16 = audio_full

    embeddings: list[SpeakerEmbedding] = []
    for turn in turns:
        dur = turn.end - turn.start
        if dur < min_duration:
            continue

        try:
            # Extract chunk + chuẩn hoá shape (1, 1, N) cho model forward
            start_sample = max(0, int(turn.start * target_sr))
            end_sample = min(len(audio16), int(turn.end * target_sr))
            chunk = audio16[start_sample:end_sample]
            if chunk.size < target_sr * 0.3:
                continue

            # Model expect tensor shape (batch, channels, samples)
            wav_t = torch.from_numpy(chunk).float().unsqueeze(0).unsqueeze(0).to(device)
            with torch.no_grad():
                emb = model(wav_t)
            # emb shape thường (batch, dim) — squeeze về 1D
            if hasattr(emb, "cpu"):
                emb_np = emb.cpu().numpy()
            else:
                emb_np = np.asarray(emb)
            vector = emb_np.flatten().astype(np.float32)

            norm = np.linalg.norm(vector)
            if norm < 1e-9:
                continue
            vector = vector / norm

            # Quality score từ chunk
            chunk_orig = audio_full[
                max(0, int(turn.start * sr_full)):
                min(len(audio_full), int(turn.end * sr_full))
            ]
            quality = _audio_quality_score(chunk_orig, sr_full) if chunk_orig.size > 0 else 0.5

            embeddings.append(SpeakerEmbedding(
                speaker_id=turn.speaker,
                start=turn.start,
                end=turn.end,
                vector=vector,
                quality=quality,
            ))
        except Exception as e:
            logger.warning("Embedding fail for turn %.2f-%.2f (%s): %s",
                           turn.start, turn.end, turn.speaker, e)
    logger.info("Extracted %d/%d embeddings (skip %d short/failed)",
                len(embeddings), len(turns), len(turns) - len(embeddings))
    return embeddings


def is_available() -> bool:
    """Check if pyannote embedding can run (deps + token)."""
    if not (os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")):
        return False
    try:
        import pyannote.audio  # noqa: F401
        return True
    except ImportError:
        return False
