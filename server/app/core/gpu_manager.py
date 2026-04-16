"""Manage Whisper + OmniVoice + LLM on a single GPU with thread-safe inference."""

import logging
import os
import threading
from typing import Optional

# Allow MPS to use more memory (avoids OOM on Apple Silicon)
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")

import torch
from transformers import pipeline as hf_pipeline, AutoModelForCausalLM, AutoTokenizer

from omnivoice import OmniVoice

from app.config import (
    DEVICE, DTYPE, TTS_MODEL, WHISPER_MODEL, LLM_MODEL,
    FASTER_WHISPER_MODEL, USE_FASTER_WHISPER,
)

logger = logging.getLogger(__name__)


class GPUManager:
    def __init__(self):
        self._lock = threading.Lock()        # TTS + Whisper
        self._llm_lock = threading.Lock()    # LLM riêng, không block TTS/Whisper
        self.tts_model: Optional[OmniVoice] = None
        self.whisper_pipe = None
        self._fw_model = None                # Faster-Whisper model
        self._use_faster_whisper = USE_FASTER_WHISPER
        self._llm_model = None
        self._llm_tokenizer = None
        self._llm_loaded = False
        self._llm_loading = False
        self._ready = False

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------
    def _load_faster_whisper(self):
        """Load Faster-Whisper (CTranslate2) — much faster than HuggingFace pipeline."""
        from faster_whisper import WhisperModel

        compute_type = "float16" if DEVICE.startswith("cuda") else "int8"
        device = "cuda" if DEVICE.startswith("cuda") else "cpu"
        logger.info("Loading Faster-Whisper model=%s device=%s compute=%s ...",
                     FASTER_WHISPER_MODEL, device, compute_type)
        self._fw_model = WhisperModel(
            FASTER_WHISPER_MODEL,
            device=device,
            compute_type=compute_type,
        )
        logger.info("Faster-Whisper loaded.")

    def _load_hf_whisper(self):
        """Load HuggingFace Whisper pipeline (fallback)."""
        logger.info("Loading HF Whisper from %s ...", WHISPER_MODEL)
        whisper_dtype = torch.float16 if DEVICE.startswith("cuda") else torch.float32
        self.whisper_pipe = hf_pipeline(
            "automatic-speech-recognition",
            model=WHISPER_MODEL,
            dtype=whisper_dtype,
            device_map=DEVICE,
        )
        logger.info("HF Whisper loaded.")

    def load_all(self):
        """Load Whisper at startup. TTS loads lazily on first generate to save memory."""
        logger.info("Loading models on device=%s dtype=%s ...", DEVICE, DTYPE)

        # Whisper STT — load at startup (needed for transcription)
        if self._use_faster_whisper:
            try:
                self._load_faster_whisper()
            except Exception as e:
                logger.warning("Faster-Whisper failed (%s), falling back to HF Whisper", e)
                self._use_faster_whisper = False
                self._load_hf_whisper()
        else:
            self._load_hf_whisper()

        # TTS loads on first generate_tts() call
        self._ready = True
        logger.info("Server ready. TTS will load on first generate request.")

    def _ensure_tts(self):
        """Lazy-load OmniVoice TTS on first use."""
        if self.tts_model is not None:
            return
        logger.info("Loading OmniVoice from %s (first TTS request)...", TTS_MODEL)
        self.tts_model = OmniVoice.from_pretrained(
            TTS_MODEL,
            device_map=DEVICE,
            dtype=DTYPE,
            load_asr=False,
        )
        logger.info("OmniVoice loaded.")

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def sampling_rate(self) -> int:
        return self.tts_model.sampling_rate if self.tts_model else 24000

    # ------------------------------------------------------------------
    # Thread-safe inference — TTS & Whisper
    # ------------------------------------------------------------------
    def transcribe_faster(self, audio_path: str, language: str = None) -> dict:
        """Faster-Whisper STT — returns {"text", "segments", "language"}."""
        with self._lock:
            kwargs = {"beam_size": 5, "vad_filter": True}
            if language:
                kwargs["language"] = language
            segments_gen, info = self._fw_model.transcribe(audio_path, **kwargs)
            segments = []
            for s in segments_gen:
                segments.append({
                    "start": s.start,
                    "end": s.end,
                    "text": s.text.strip(),
                })
            full_text = " ".join(seg["text"] for seg in segments)
            self._clear_cache()
            return {
                "text": full_text,
                "segments": segments,
                "language": info.language,
            }

    def transcribe(self, audio_path: str, return_timestamps: bool = False, language: str = None) -> dict:
        """HuggingFace Whisper STT — returns {"text": ..., "chunks": [...]}."""
        with self._lock:
            kwargs = {"return_timestamps": return_timestamps}
            if language:
                kwargs["generate_kwargs"] = {"language": language}
            result = self.whisper_pipe(audio_path, **kwargs)
            return result

    def _clear_cache(self):
        """Free GPU memory cache."""
        if DEVICE == "mps":
            torch.mps.empty_cache()
        elif DEVICE == "cuda":
            torch.cuda.empty_cache()

    def create_voice_prompt(self, ref_audio: str, ref_text: str = None):
        """Create a reusable VoiceClonePrompt from reference audio."""
        with self._lock:
            self._ensure_tts()
            self._clear_cache()
            if ref_text is None:
                logger.info("Auto-transcribing reference audio...")
                whisper_result = self.whisper_pipe(ref_audio)
                ref_text = whisper_result["text"].strip()
                logger.info("Transcribed: %s", ref_text[:80])

            prompt = self.tts_model.create_voice_clone_prompt(
                ref_audio=ref_audio,
                ref_text=ref_text,
            )
            self._clear_cache()
            return prompt

    def generate_tts(self, text: str, voice_prompt=None, **kwargs):
        """Generate audio from text. Returns waveform tensor."""
        with self._lock:
            self._ensure_tts()
            self._clear_cache()
            kw = {"text": text}
            if voice_prompt is not None:
                kw["voice_clone_prompt"] = voice_prompt
            kw.update(kwargs)
            audio = self.tts_model.generate(**kw)
            self._clear_cache()
            return audio[0].squeeze(0)  # (T,)

    # ------------------------------------------------------------------
    # LLM — separate lock, lazy-loaded, non-blocking for TTS/Whisper
    # ------------------------------------------------------------------
    def _ensure_llm(self):
        """Load Qwen model on first use. Uses its own lock."""
        if self._llm_loaded:
            return
        if self._llm_loading:
            logger.info("LLM already loading, waiting...")
            # Wait for loading to finish
            while self._llm_loading and not self._llm_loaded:
                import time
                time.sleep(0.5)
            return

        self._llm_loading = True
        logger.info("Loading LLM %s (this won't block TTS/Whisper)...", LLM_MODEL)
        try:
            self._llm_tokenizer = AutoTokenizer.from_pretrained(LLM_MODEL)
            # Use 4-bit quantization to fit 7B model in limited VRAM
            try:
                from transformers import BitsAndBytesConfig
                quant_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                )
                self._llm_model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL,
                    quantization_config=quant_config,
                    device_map="auto",
                )
                logger.info("LLM loaded with 4-bit quantization")
            except ImportError:
                logger.warning("bitsandbytes not available, loading in float16")
                self._llm_model = AutoModelForCausalLM.from_pretrained(
                    LLM_MODEL,
                    torch_dtype=torch.float16 if DEVICE != "cpu" else torch.float32,
                    device_map=DEVICE,
                )
            self._llm_model.eval()
            self._llm_loaded = True
            logger.info("LLM loaded on %s.", DEVICE)
        except Exception as e:
            logger.error("Failed to load LLM: %s", e)
            raise
        finally:
            self._llm_loading = False

    def llm_generate(self, messages: list[dict], max_new_tokens: int = 2048, temperature: float = 0.3) -> str:
        """Run chat completion with the loaded LLM. Uses separate lock from TTS/Whisper."""
        with self._llm_lock:
            self._ensure_llm()
            self._clear_cache()

            text = self._llm_tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )
            inputs = self._llm_tokenizer(text, return_tensors="pt").to(self._llm_model.device)

            with torch.no_grad():
                output_ids = self._llm_model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    temperature=temperature,
                    do_sample=temperature > 0,
                    top_p=0.9,
                )

            # Decode only new tokens
            new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
            result = self._llm_tokenizer.decode(new_tokens, skip_special_tokens=True)
            self._clear_cache()
            return result.strip()

    @property
    def llm_ready(self) -> bool:
        return self._llm_loaded


# Singleton
gpu = GPUManager()
