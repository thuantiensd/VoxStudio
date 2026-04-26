"""VoxStudio — FastAPI Server."""

# Load .env TRƯỚC khi import bất kỳ module nào của app — vì jwt_tokens.py đọc
# JWT_SECRET tại import-time, nếu .env chưa load thì sẽ fallback random secret
# → token cũ invalid sau mỗi restart.
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.config import DEVICE, DTYPE
from app.core.gpu_manager import gpu
from app.db.session import init_db
from app.db.migrations import run_migrations

# Sentry init TRƯỚC khi tạo FastAPI — để middleware bắt được cả init errors.
# DSN opt-in qua env — không có DSN thì skip.
import os as _os
_sentry_dsn = _os.environ.get("SENTRY_DSN", "").strip()
if _sentry_dsn:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        sentry_sdk.init(
            dsn=_sentry_dsn,
            environment=_os.environ.get("SENTRY_ENV", "production"),
            release=_os.environ.get("SENTRY_RELEASE", "voxstudio-server@0.1.0"),
            traces_sample_rate=0,       # không track perf để giảm event
            sample_rate=1.0,             # capture 100% error
            send_default_pii=False,
            integrations=[
                FastApiIntegration(),
                SqlalchemyIntegration(),
            ],
            before_send=lambda event, hint: (
                # Xoá body request khỏi event để tránh leak content/API key
                event.pop("request", None) or event
            ) if False else event,
        )
    except Exception as _e:
        print(f"[sentry] init failed: {_e}")

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
    await run_migrations()  # alter users cols + seed plans + promote admins from ENV
    # Job queue worker — 1 thread chung cho mọi GPU-bound task
    from app.worker.gpu_worker import start_worker, stop_worker
    start_worker()
    gpu.load_all()

    # Background TTL cleanup cho audio_output/ — chạy 1h/lần. Lần đầu chạy
    # ngay khi boot để dọn rác từ phiên trước.
    import asyncio
    from app.core.storage import cleanup_audio_output
    async def _cleanup_loop():
        while True:
            try:
                cleanup_audio_output()
            except Exception as e:
                logger.warning("audio cleanup loop error: %s", e)
            await asyncio.sleep(3600)  # 1h
    cleanup_task = asyncio.create_task(_cleanup_loop())

    yield
    logger.info("Shutting down.")
    cleanup_task.cancel()
    stop_worker()


app = FastAPI(
    title="VoxStudio API",
    version="0.1.0",
    description="TTS + STT API powered by OmniVoice & Whisper",
    lifespan=lifespan,
)

# CORS — allow desktop app to connect.
# QUAN TRỌNG: phải LIST EXPLICIT các header (đặc biệt Authorization), wildcard
# "*" KHÔNG match Authorization header theo CORS spec → browser strip header,
# backend nhận request rỗng → 401 "Missing token". Đã debug 1 buổi vì lý do này.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allow_headers=[
        "Authorization", "Content-Type", "Accept", "Origin",
        "X-Requested-With", "ngrok-skip-browser-warning",
    ],
    expose_headers=["*"],
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
