"""Application settings — auto-detect device, paths, model config."""

import os
from pathlib import Path

import torch


def _best_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# Paths
BASE_DIR = Path(__file__).resolve().parent.parent  # server/
VOICES_DIR = BASE_DIR / "voices"
AUDIO_OUTPUT_DIR = BASE_DIR / "audio_output"

DUBBING_DIR = BASE_DIR / "dubbing_projects"

VOICES_DIR.mkdir(exist_ok=True)
AUDIO_OUTPUT_DIR.mkdir(exist_ok=True)
DUBBING_DIR.mkdir(exist_ok=True)

# Device
DEVICE = os.getenv("DEVICE", _best_device())
IS_CUDA = DEVICE.startswith("cuda")
DTYPE = torch.float16 if IS_CUDA else torch.float32

# Models
TTS_MODEL = os.getenv("TTS_MODEL", "k2-fsa/OmniVoice")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "openai/whisper-large-v3-turbo")

# Faster-Whisper (CTranslate2 — 10-20x faster, lower VRAM)
FASTER_WHISPER_MODEL = os.getenv("FASTER_WHISPER_MODEL", "large-v3-turbo")
USE_FASTER_WHISPER = os.getenv("USE_FASTER_WHISPER", "true").lower() == "true"

# Generation defaults (lower steps = faster on MPS/CPU)
DEV_MODE = not IS_CUDA
TTS_DEFAULT_STEPS = 8 if DEV_MODE else 32
TTS_DEFAULT_GUIDANCE = 2.0

# LLM for translation
LLM_MODEL = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct")

# Gemini API for context-aware translation
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
