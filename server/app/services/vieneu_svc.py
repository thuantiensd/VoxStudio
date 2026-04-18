"""VieNeu-TTS service — native Vietnamese TTS with zero-shot voice cloning.

Model: pnnbao-ump/VieNeu-TTS (qwen2 0.5B architecture).
Key advantages over XTTS v2:
- Native Vietnamese (not a finetune/patch on English model)
- Much smaller: 0.3B/0.5B params vs XTTS 2GB
- Clean API: pip install vieneu
- Instant voice cloning: 3-5s reference audio + transcript
- Available in GGUF Q4 for CPU-only inference
"""

import logging
import os
import threading
from pathlib import Path
from typing import Optional

import torch

logger = logging.getLogger(__name__)


class VieNeuService:
    """Lazy-loaded VieNeu-TTS with thread-safe inference."""

    def __init__(self):
        self._lock = threading.Lock()
        self._tts = None
        self._loaded = False

    @staticmethod
    def _pick_device() -> str:
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"

    def _ensure_loaded(self):
        if self._loaded:
            return

        # Free VRAM first — unload other big models
        try:
            from app.core.gpu_manager import gpu
            gpu.unload_tts()
            gpu.unload_llm()
        except Exception as e:
            logger.warning("Could not pre-free VRAM: %s", e)

        try:
            from vieneu import Vieneu
        except ImportError as e:
            raise RuntimeError(
                "VieNeu-TTS not installed. Run: pip install vieneu"
            ) from e

        device = self._pick_device()
        logger.info("Loading VieNeu-TTS on %s ...", device)

        # Vieneu() defaults to 0.3B-Q4 GGUF for CPU. On CUDA we may want
        # the full 0.5B BF16 — but the simple default works everywhere.
        kwargs = {}
        # Allow override via env var
        model_variant = os.getenv("VIENEU_MODEL", "").strip()
        if model_variant:
            kwargs["model"] = model_variant

        self._tts = Vieneu(**kwargs)
        self._loaded = True
        logger.info("VieNeu-TTS loaded.")

    def unload(self):
        """Free model from memory."""
        with self._lock:
            if self._tts is None:
                return
            try:
                if hasattr(self._tts, "close"):
                    self._tts.close()
            except Exception as e:
                logger.warning("VieNeu close() failed: %s", e)
            del self._tts
            self._tts = None
            self._loaded = False
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    @property
    def sampling_rate(self) -> int:
        # Check model for actual rate; default 24kHz per VieNeu docs
        if self._tts is not None and hasattr(self._tts, "sample_rate"):
            return int(self._tts.sample_rate)
        return 24000

    def _build_voice(self, ref_wav_path: str, ref_text: Optional[str]) -> dict:
        """Encode a reference WAV into a voice dict usable by infer().

        Turbo/standard/fast backends all accept `voice={"codes":..., "text":...}`.
        Turbo's infer() does NOT accept ref_audio/ref_text kwargs — those would
        be silently dropped and the default preset voice used instead.
        """
        cache_key = (ref_wav_path, ref_text or "")
        if not hasattr(self, "_voice_cache"):
            self._voice_cache = {}
        if cache_key in self._voice_cache:
            return self._voice_cache[cache_key]

        codes = self._tts.encode_reference(ref_wav_path)
        voice = {"codes": codes, "text": ref_text or ""}
        self._voice_cache[cache_key] = voice
        logger.info("VieNeu encoded reference: %s (ref_text=%s)",
                    ref_wav_path, bool(ref_text))
        return voice

    def generate(
        self,
        text: str,
        ref_wav_path: Optional[str] = None,
        ref_text: Optional[str] = None,
        out_wav_path: Optional[str] = None,
    ) -> str:
        """Synthesize Vietnamese speech.

        If ref_wav_path is given, clones the voice from the reference audio.
        Otherwise uses VieNeu's default preset voice.

        Returns the output WAV path.
        """
        import numpy as np
        import soundfile as sf

        if not text or not text.strip():
            raise ValueError("Empty text for VieNeu-TTS")
        if out_wav_path is None:
            raise ValueError("out_wav_path is required")

        with self._lock:
            self._ensure_loaded()

            logger.info("VieNeu generating (%d chars, clone=%s): %s",
                        len(text), bool(ref_wav_path), text[:80])

            kwargs = {"text": text, "show_progress": False}
            if ref_wav_path:
                # Build + cache voice dict so we only encode once per reference
                kwargs["voice"] = self._build_voice(ref_wav_path, ref_text)

            audio = self._tts.infer(**kwargs)

            # Normalize to numpy float32 1D
            if hasattr(audio, "cpu"):
                audio = audio.cpu().numpy()
            audio = np.asarray(audio, dtype=np.float32).squeeze()

            if audio.size == 0:
                raise RuntimeError(f"VieNeu produced empty audio for: {text[:100]}")

            duration = len(audio) / self.sampling_rate
            peak = float(np.abs(audio).max())
            logger.info("VieNeu output: %.2fs, peak=%.3f @ %dHz",
                        duration, peak, self.sampling_rate)

            if peak < 1e-4:
                raise RuntimeError(f"VieNeu produced silent audio for: {text[:100]}")

            # Prefer the library's own save method for correct format
            if hasattr(self._tts, "save"):
                try:
                    self._tts.save(audio, out_wav_path)
                    return out_wav_path
                except Exception:
                    pass
            sf.write(out_wav_path, audio, self.sampling_rate)
            return out_wav_path


# Singleton
vieneu = VieNeuService()
