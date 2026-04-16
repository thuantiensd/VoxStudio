"""Vocal separation service using Demucs (Meta).

Separates audio into vocals + accompaniment (music/SFX).
Auto-detects GPU: uses CUDA if enough VRAM (>4GB), otherwise CPU.
"""

import logging
import subprocess
import shutil
from pathlib import Path

import soundfile as sf
import numpy as np

logger = logging.getLogger(__name__)

# Demucs model — htdemucs is the default hybrid transformer model
# Outputs 4 stems: drums, bass, vocals, other
MODEL = "htdemucs"
MIN_VRAM_GB = 4.0  # Minimum VRAM to use GPU for Demucs


def _pick_device() -> str:
    """Auto-detect best device for Demucs. GPU if VRAM sufficient, else CPU."""
    try:
        import torch
        if torch.cuda.is_available():
            free_mem, total_mem = torch.cuda.mem_get_info()
            free_gb = free_mem / (1024 ** 3)
            logger.info("Demucs device check: CUDA free=%.1fGB (need %.1fGB)", free_gb, MIN_VRAM_GB)
            if free_gb >= MIN_VRAM_GB:
                return "cuda"
    except Exception:
        pass
    return "cpu"


def separate(audio_path: str, output_dir: str) -> dict:
    """Run Demucs to separate vocals from accompaniment.

    Args:
        audio_path: Path to input audio (WAV).
        output_dir: Directory to save vocals.wav and accompaniment.wav.

    Returns:
        dict with paths: {"vocals": ..., "accompaniment": ...}
    """
    audio_path = Path(audio_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Demucs writes to: <out>/<model>/<track_name>/{drums,bass,vocals,other}.wav
    demucs_out = output_dir / "_demucs_tmp"

    logger.info("Starting vocal separation: %s", audio_path)

    try:
        # Run demucs CLI — auto device, 2 stems mode (vocals + no_vocals)
        device = _pick_device()
        logger.info("Demucs using device: %s", device)
        cmd = [
            "python", "-m", "demucs",
            "--two-stems", "vocals",  # Only split into vocals + no_vocals
            "-n", MODEL,
            "--device", device,
            "-o", str(demucs_out),
            str(audio_path),
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=600,  # 10 min max
        )
        if result.returncode != 0:
            logger.error("Demucs stderr: %s", result.stderr)
            raise RuntimeError(f"Demucs failed: {result.stderr[:500]}")

        # Find output stems
        track_name = audio_path.stem
        stems_dir = demucs_out / MODEL / track_name

        vocals_src = stems_dir / "vocals.wav"
        accomp_src = stems_dir / "no_vocals.wav"

        if not vocals_src.exists() or not accomp_src.exists():
            raise RuntimeError(f"Demucs output not found in {stems_dir}")

        # Copy to final locations
        vocals_dst = output_dir / "vocals.wav"
        accomp_dst = output_dir / "accompaniment.wav"
        shutil.copy2(str(vocals_src), str(vocals_dst))
        shutil.copy2(str(accomp_src), str(accomp_dst))

        # Clean up demucs temp
        shutil.rmtree(str(demucs_out), ignore_errors=True)

        logger.info("Vocal separation complete: vocals=%s, accompaniment=%s",
                     vocals_dst, accomp_dst)

        return {
            "vocals": str(vocals_dst),
            "accompaniment": str(accomp_dst),
        }

    except subprocess.TimeoutExpired:
        shutil.rmtree(str(demucs_out), ignore_errors=True)
        raise RuntimeError("Vocal separation timed out (>10 minutes)")
    except Exception:
        shutil.rmtree(str(demucs_out), ignore_errors=True)
        raise


def is_separated(project_dir: str) -> bool:
    """Check if vocal separation has already been done."""
    pdir = Path(project_dir)
    return (pdir / "vocals.wav").exists() and (pdir / "accompaniment.wav").exists()
