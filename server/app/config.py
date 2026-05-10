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


# Paths — cho phép env override để VPS ↔ Pod cùng dùng path mirror nhau
BASE_DIR = Path(__file__).resolve().parent.parent  # server/
VOICES_DIR = Path(os.getenv("VOICES_DIR") or BASE_DIR / "voices")
AUDIO_OUTPUT_DIR = Path(os.getenv("AUDIO_OUTPUT_DIR") or BASE_DIR / "audio_output")
DUBBING_DIR = Path(os.getenv("DUBBING_PROJECTS_DIR") or BASE_DIR / "dubbing_projects")

VOICES_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DUBBING_DIR.mkdir(parents=True, exist_ok=True)

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

# WhisperX (opt-in) — adds word-level alignment + pyannote diarization on top
# of faster-whisper. ~2x slower trên CPU nhưng subtitle/timing chính xác hơn
# rõ rệt. Cần `pip install whisperx` + (optional) HF_TOKEN cho diarize.
USE_WHISPERX = os.getenv("USE_WHISPERX", "false").lower() == "true"

# Generation defaults (lower steps = faster on MPS/CPU)
DEV_MODE = not IS_CUDA
TTS_DEFAULT_STEPS = 8 if DEV_MODE else 32
TTS_DEFAULT_GUIDANCE = 2.0

# LLM for translation
LLM_MODEL = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")

# Gemini API for context-aware translation
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Worker mode — split deploy: VPS chạy WORKER_ENABLED=false (API-only, không
# load model, RAM thấp), RunPod chạy WORKER_ENABLED=true (process GPU job).
WORKER_ENABLED = os.getenv("WORKER_ENABLED", "true").lower() != "false"

# ── Storage backend ────────────────────────────────────────────
# "local" = filesystem (dev); "r2" = Cloudflare R2 (production).
# Khi r2: cần đầy đủ R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY
# + R2_BUCKET_PUBLIC + R2_BUCKET_PRIVATE; thiếu sẽ raise lỗi ở runtime call.
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_PUBLIC = os.getenv("R2_BUCKET_PUBLIC", "voxstudio-public")
R2_BUCKET_PRIVATE = os.getenv("R2_BUCKET_PRIVATE", "voxstudio-private")
# Public URL prefix — pub-xxx.r2.dev hoặc files.voxstudio.vn (custom domain).
# Bắt buộc set khi STORAGE_BACKEND=r2 để build URL audio output trả về client.
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "").rstrip("/")
# Endpoint S3-compatible — auto build từ ACCOUNT_ID nếu không override.
R2_ENDPOINT_URL = os.getenv(
    "R2_ENDPOINT_URL",
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else "",
)
