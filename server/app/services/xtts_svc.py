"""XTTS v2 Vietnamese TTS service.

Uses Nhat1106/xtts-vietnamese finetune on top of Coqui XTTS v2 base model.
Supports voice cloning from a reference WAV file.

Notes:
- XTTS v2 base does NOT support Vietnamese ('vi' not in default languages).
- The Vietnamese finetune (Nhat1106/xtts-vietnamese) ships its own config.json
  that adds 'vi' to the languages list and a retrained vocab.json for VN tokens.
- Model file (~1.8GB) is downloaded on first use — best run on Colab/CUDA.
"""

import glob
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Optional

import torch

logger = logging.getLogger(__name__)


def _patch_tts_for_transformers5():
    """Coqui TTS uses `isin_mps_friendly` which was removed in transformers 5.x.

    Patch the source file on disk (idempotent) so `from TTS.api import TTS` works.
    Must run BEFORE any `from TTS...` import.
    """
    for site in sys.path:
        hits = glob.glob(f"{site}/TTS/tts/layers/tortoise/autoregressive.py")
        if not hits:
            continue
        file_path = hits[0]
        try:
            with open(file_path) as f:
                code = f.read()
            if "isin_mps_friendly" not in code:
                return  # already patched
            code = code.replace(
                "from transformers.pytorch_utils import isin_mps_friendly as isin",
                "from torch import isin",
            )
            with open(file_path, "w") as f:
                f.write(code)
            logger.info("Auto-patched Coqui TTS for transformers 5.x at %s", file_path)
        except Exception as e:
            logger.warning("Could not auto-patch TTS: %s", e)
        return


# Apply patch at module import time so subsequent `from TTS...` calls work
_patch_tts_for_transformers5()

# HuggingFace repo for Vietnamese finetune
VN_REPO_ID = os.getenv("XTTS_VN_REPO", "Nhat1106/xtts-vietnamese")
VN_CACHE_DIR = Path(os.getenv("XTTS_VN_CACHE", str(Path.home() / ".cache" / "xtts-vi")))

os.environ.setdefault("COQUI_TOS_AGREED", "1")


class XTTSService:
    """Lazy-loaded XTTS v2 VN model with thread-safe inference."""

    def __init__(self):
        self._lock = threading.Lock()
        self._model = None
        self._config = None
        self._loaded = False

    @staticmethod
    def _pick_device() -> str:
        if torch.cuda.is_available():
            return "cuda"
        # XTTS runs poorly on MPS (kernel issues); CPU fallback
        return "cpu"

    def _download_vn_model(self) -> Path:
        """Download Nhat1106/xtts-vietnamese files to cache dir."""
        from huggingface_hub import snapshot_download

        VN_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        # Skip download if already cached
        required = ["model.pth", "config.json", "vocab.json"]
        if all((VN_CACHE_DIR / f).exists() for f in required):
            logger.info("VN XTTS model already cached at %s", VN_CACHE_DIR)
            return VN_CACHE_DIR

        logger.info("Downloading %s to %s (first-time ~1.8GB)...", VN_REPO_ID, VN_CACHE_DIR)
        snapshot_download(
            repo_id=VN_REPO_ID,
            local_dir=str(VN_CACHE_DIR),
            allow_patterns=["*.pth", "*.json"],
            max_workers=4,
        )
        for f in required:
            if not (VN_CACHE_DIR / f).exists():
                raise FileNotFoundError(f"Missing {f} after download")
        logger.info("VN XTTS model ready: %s", VN_CACHE_DIR)
        return VN_CACHE_DIR

    def _ensure_loaded(self):
        if self._loaded:
            return

        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        # Free VRAM first — unload OmniVoice so we don't OOM loading XTTS too
        try:
            from app.core.gpu_manager import gpu
            if gpu.tts_model is not None:
                logger.info("Unloading OmniVoice to free VRAM for XTTS...")
                del gpu.tts_model
                gpu.tts_model = None
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.synchronize()
        except Exception as e:
            logger.warning("Could not unload OmniVoice: %s", e)

        vn_dir = self._download_vn_model()

        logger.info("Loading XTTS v2 VN config...")
        config = XttsConfig()
        config.load_json(str(vn_dir / "config.json"))

        logger.info("Initializing XTTS v2 VN model...")
        model = Xtts.init_from_config(config)

        # Base XTTS v2 provides speakers_xtts.pth + dvae / mel_stats files.
        # They live in Coqui's default cache after first TTSApi() call;
        # ensure they exist by touching the API once.
        self._ensure_base_files()

        device = self._pick_device()
        logger.info("Loading VN checkpoint on %s ...", device)
        model.load_checkpoint(
            config,
            checkpoint_dir=str(vn_dir),
            eval=True,
            use_deepspeed=False,
        )
        if device == "cuda":
            model.cuda()
        else:
            model.to(torch.device(device))

        self._model = model
        self._config = config
        self._loaded = True
        logger.info("XTTS v2 VN loaded.")

    @staticmethod
    def _ensure_base_files():
        """Coqui XTTS v2 needs speakers_xtts.pth + dvae files.

        Trigger a one-time download via TTS API (no-op if already cached).
        """
        try:
            from TTS.api import TTS as TTSApi
            cache = Path.home() / "Library" / "Application Support" / "tts" / \
                "tts_models--multilingual--multi-dataset--xtts_v2"
            if not (cache / "speakers_xtts.pth").exists():
                logger.info("Downloading Coqui XTTS v2 base auxiliary files (one-time)...")
                TTSApi("tts_models/multilingual/multi-dataset/xtts_v2", gpu=False)
        except Exception as e:
            logger.warning("Could not pre-download XTTS base aux files: %s", e)

    @property
    def sampling_rate(self) -> int:
        if self._config is None:
            return 24000
        return getattr(self._config.audio, "output_sample_rate", 24000)

    def generate(
        self,
        text: str,
        ref_wav_path: str,
        out_wav_path: str,
        language: str = "vi",
        temperature: float = 0.75,
        repetition_penalty: float = 5.0,
        length_penalty: float = 1.0,
        speed: float = 1.0,
    ) -> None:
        """Synthesize `text` with voice cloned from `ref_wav_path`, write to `out_wav_path`."""
        import soundfile as sf

        with self._lock:
            self._ensure_loaded()

            logger.info("XTTS generating (%d chars, lang=%s)", len(text), language)
            outputs = self._model.synthesize(
                text,
                self._config,
                speaker_wav=ref_wav_path,
                language=language,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                length_penalty=length_penalty,
                speed=speed,
            )
            wav = outputs["wav"]
            sf.write(out_wav_path, wav, self.sampling_rate)


# Singleton
xtts = XTTSService()
