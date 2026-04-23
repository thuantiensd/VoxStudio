"""Combine all v1 API routes."""

from fastapi import APIRouter

from app.api.v1.tts import router as tts_router
from app.api.v1.voices import router as voices_router
from app.api.v1.transcribe import router as transcribe_router
from app.api.v1.dubbing import router as dubbing_router
from app.api.v1.download import router as download_router
from app.api.v1.auth import router as auth_router
from app.api.v1.translate import router as translate_router
from app.api.v1.jobs import router as jobs_router
from app.api.v1.plans import router as plans_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(tts_router)
api_router.include_router(voices_router)
api_router.include_router(transcribe_router)
api_router.include_router(dubbing_router)
api_router.include_router(download_router)
api_router.include_router(translate_router)
api_router.include_router(jobs_router)
api_router.include_router(plans_router)
