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


def _find_tts_file(relative_path: str) -> Optional[str]:
    for site in sys.path:
        hits = glob.glob(f"{site}/TTS/{relative_path}")
        if hits:
            return hits[0]
    return None


def _patch_tts_for_transformers5():
    """Coqui TTS uses `isin_mps_friendly` (removed in transformers 5.x).
    Patch the source file on disk (idempotent) so `from TTS.api import TTS` works.
    Must run BEFORE any `from TTS...` import.
    """
    file_path = _find_tts_file("tts/layers/tortoise/autoregressive.py")
    if not file_path:
        return
    try:
        with open(file_path) as f:
            code = f.read()
        if "isin_mps_friendly" not in code:
            return
        code = code.replace(
            "from transformers.pytorch_utils import isin_mps_friendly as isin",
            "from torch import isin",
        )
        with open(file_path, "w") as f:
            f.write(code)
        logger.info("Auto-patched Coqui TTS for transformers 5.x: %s", file_path)
    except Exception as e:
        logger.warning("Could not auto-patch TTS autoregressive.py: %s", e)


def _patch_tts_for_vietnamese():
    """Add Vietnamese support to XTTS tokenizer.

    Upstream Coqui tokenizer raises NotImplementedError for 'vi' in
    preprocess_text(). Since the VN finetune retrained on VN data with
    a modified vocab.json, we only need to route 'vi' through the same
    multilingual_cleaners used for Latin languages (like 'en'). Also
    add 'vi' to char_limits so split_sentence doesn't KeyError.
    """
    file_path = _find_tts_file("tts/layers/xtts/tokenizer.py")
    if not file_path:
        return
    try:
        with open(file_path) as f:
            code = f.read()

        # 1. Inject 'vi' into preprocess_text language set (after 'ar', 'cs', ...)
        old_set = '{"ar", "cs", "de", "en", "es", "fr", "hi", "hu", "it", "nl", "pl", "pt", "ru", "tr", "zh", "ko"}'
        new_set = '{"ar", "cs", "de", "en", "es", "fr", "hi", "hu", "it", "nl", "pl", "pt", "ru", "tr", "zh", "ko", "vi"}'
        if old_set in code and new_set not in code:
            code = code.replace(old_set, new_set)

        # 2. Add 'vi' to char_limits dict (so split_sentence/check_input_length don't KeyError)
        limits_old = '"hi": 150,\n        }'
        limits_new = '"hi": 150,\n            "vi": 250,\n        }'
        if limits_old in code and '"vi": 250,' not in code:
            code = code.replace(limits_old, limits_new)

        with open(file_path, "w") as f:
            f.write(code)
        logger.info("Auto-patched Coqui TTS tokenizer for Vietnamese: %s", file_path)
    except Exception as e:
        logger.warning("Could not auto-patch TTS tokenizer for 'vi': %s", e)


# Apply patches at module import time so subsequent `from TTS...` calls work
_patch_tts_for_transformers5()
_patch_tts_for_vietnamese()

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

        # Patch tokenizer: upstream TTS `char_limits` dict doesn't have 'vi'
        # even though VN finetune adds 'vi' to languages. Add it ourselves
        # to the same limit as English (~250) to avoid KeyError in split_sentence.
        try:
            char_limits = getattr(model.tokenizer, "char_limits", None)
            if char_limits is not None and "vi" not in char_limits:
                char_limits["vi"] = char_limits.get("en", 250)
                logger.info("Patched tokenizer.char_limits['vi'] = %d", char_limits["vi"])
        except Exception as e:
            logger.warning("Could not patch char_limits: %s", e)

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
        import numpy as np
        import soundfile as sf

        with self._lock:
            self._ensure_loaded()

            if not text or not text.strip():
                raise ValueError(f"Empty text for XTTS")

            logger.info("XTTS generating (%d chars, lang=%s): %s",
                        len(text), language, text[:80])

            # Use lower-level inference() with explicit speaker embedding (more reliable
            # than synthesize() on VN finetune which has modified tokenizer).
            gpt_cond_latent, speaker_embedding = self._model.get_conditioning_latents(
                audio_path=[ref_wav_path],
                gpt_cond_len=self._model.config.gpt_cond_len,
                gpt_cond_chunk_len=self._model.config.gpt_cond_chunk_len,
                max_ref_length=self._model.config.max_ref_len,
                sound_norm_refs=self._model.config.sound_norm_refs,
            )

            # Disable text splitting — split ourselves if needed to avoid
            # tokenizer.char_limits[language] KeyError path
            max_chars = 220
            if len(text) > max_chars:
                import re
                # naive split on . ! ? , keeping reasonable chunk size
                chunks = []
                buf = ""
                for part in re.split(r"(?<=[.!?…])\s+", text):
                    if len(buf) + len(part) < max_chars:
                        buf = (buf + " " + part).strip()
                    else:
                        if buf: chunks.append(buf)
                        buf = part
                if buf: chunks.append(buf)
            else:
                chunks = [text]

            import numpy as np
            wav_parts = []
            for chunk in chunks:
                out = self._model.inference(
                    text=chunk,
                    language=language,
                    gpt_cond_latent=gpt_cond_latent,
                    speaker_embedding=speaker_embedding,
                    temperature=temperature,
                    repetition_penalty=repetition_penalty,
                    length_penalty=length_penalty,
                    speed=speed,
                    enable_text_splitting=False,  # KEY FIX: avoid char_limits[lang] KeyError
                )
                w = out.get("wav")
                if w is None:
                    raise RuntimeError(f"inference returned no 'wav' (keys={list(out.keys())})")
                if hasattr(w, "cpu"):
                    w = w.cpu().numpy()
                wav_parts.append(np.asarray(w, dtype=np.float32).squeeze())

            out = {"wav": np.concatenate(wav_parts) if len(wav_parts) > 1 else wav_parts[0]}

            wav = out.get("wav")
            if wav is None:
                raise RuntimeError(f"XTTS inference returned no 'wav' key (keys={list(out.keys())})")

            # Normalize to numpy float32
            if hasattr(wav, "cpu"):
                wav = wav.cpu().numpy()
            wav = np.asarray(wav, dtype=np.float32).squeeze()

            if wav.size == 0:
                raise RuntimeError(f"XTTS produced empty audio for text: {text[:100]}")

            duration = len(wav) / self.sampling_rate
            peak = float(np.abs(wav).max()) if wav.size > 0 else 0.0
            logger.info("XTTS output: %.2fs, peak=%.3f, samples=%d @ %dHz",
                        duration, peak, len(wav), self.sampling_rate)

            if peak < 1e-4:
                raise RuntimeError(f"XTTS produced silent audio (peak={peak}) for: {text[:100]}")

            sf.write(out_wav_path, wav, self.sampling_rate)
            import os
            sz = os.path.getsize(out_wav_path)
            logger.info("XTTS wrote %s (%.1fKB)", out_wav_path, sz / 1024)


# Singleton
xtts = XTTSService()
