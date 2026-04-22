"""VoxStudio — FastAPI Server."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.config import DEVICE, DTYPE
from app.core.gpu_manager import gpu
from app.db.session import init_db

# Load .env (JWT_SECRET + GOOGLE_OAUTH_CLIENT_ID/SECRET)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models on startup, cleanup on shutdown."""
    logger.info("Starting VoxStudio Server...")
    logger.info("Device: %s | Dtype: %s", DEVICE, DTYPE)
    await init_db()
    gpu.load_all()
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="VoxStudio API",
    version="0.1.0",
    description="TTS + STT API powered by OmniVoice & Whisper",
    lifespan=lifespan,
)

# CORS — allow desktop app to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(api_router)


@app.get("/health")
async def health():
    return {
        "status": "ok" if gpu.ready else "loading",
        "device": DEVICE,
    }


@app.get("/system/vram")
async def vram():
    """Report current VRAM usage + which models are loaded."""
    return gpu.vram_stats()


@app.post("/system/unload")
async def unload(models: str = "llm,tts"):
    """Free specified models from VRAM. models=comma-list of: llm, tts, whisper."""
    targets = [m.strip() for m in models.split(",") if m.strip()]
    freed = []
    if "llm" in targets:
        gpu.unload_llm(); freed.append("llm")
    if "tts" in targets:
        gpu.unload_tts(); freed.append("tts")
    if "whisper" in targets:
        gpu.unload_whisper(); freed.append("whisper")
    return {"unloaded": freed, "vram": gpu.vram_stats()}
