"""Combine all v1 API routes.

Khi WORKER_ENABLED=false (vd VPS rẻ không có GPU): chỉ mount auth/billing/admin/
plans/jobs. Bỏ tts/voices/transcribe/dubbing/translate/download để khỏi import
torch + ML libs vào RAM (~150MB tiết kiệm). Worker trên RunPod set WORKER_ENABLED
=true sẽ mount đầy đủ và tự pick job từ DB.
"""

from fastapi import APIRouter

from app.config import WORKER_ENABLED

# Light routes — chạy mọi nơi, không phụ thuộc GPU/ML
from app.api.v1.auth import router as auth_router
from app.api.v1.jobs import router as jobs_router
from app.api.v1.plans import router as plans_router
from app.api.v1.billing import router as billing_router
from app.api.v1.admin import router as admin_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(jobs_router)
api_router.include_router(plans_router)
api_router.include_router(billing_router)
api_router.include_router(admin_router)

# Heavy routes — chỉ mount khi worker enabled (tránh import torch/whisper/tts
# khi chạy API-only trên VPS không có GPU).
if WORKER_ENABLED:
    from app.api.v1.tts import router as tts_router
    from app.api.v1.voices import router as voices_router
    from app.api.v1.transcribe import router as transcribe_router
    from app.api.v1.dubbing import router as dubbing_router
    from app.api.v1.download import router as download_router
    from app.api.v1.translate import router as translate_router
    api_router.include_router(tts_router)
    api_router.include_router(voices_router)
    api_router.include_router(transcribe_router)
    api_router.include_router(dubbing_router)
    api_router.include_router(download_router)
    api_router.include_router(translate_router)
