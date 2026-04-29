"""Handlers cho mỗi job kind. Đăng ký vào gpu_worker dispatch table.

Wrap các pipeline hiện tại (dubbing_svc.auto_dub sync generator) thành
async handler theo signature worker expect:
    async def handler(payload: dict, job_id: str, progress_cb) -> dict

Storage flow:
- R2 mode (production split deploy): payload chứa `audio_key` (R2 private
  bucket key). Worker download từ R2 → /tmp; output upload R2 public bucket.
  KHÔNG dùng SCP nữa — VPS không cần biết Pod IP.
- Local mode (dev): payload chứa `audio_path` (local file). Đọc thẳng.

Backward compat: payload còn `audio_path` thì vẫn dùng (legacy).
"""
from __future__ import annotations

import asyncio
import logging
import os as _os
import threading
import uuid
from pathlib import Path
from typing import Any

from app.config import STORAGE_BACKEND
from app.core.gpu_manager import gpu
from app.core.storage import save_audio
from app.services import dubbing_svc, tts_svc, voice_svc, whisper_svc
from app.worker.gpu_worker import register_handler

logger = logging.getLogger(__name__)

# Tmp dir cho file download từ R2 — namespaced theo job để cleanup dễ.
_TMP_ROOT = Path(_os.environ.get("WORKER_TMP_DIR", "/tmp/voxstudio-worker"))
_TMP_ROOT.mkdir(parents=True, exist_ok=True)


def _job_tmp_dir(job_id: str) -> Path:
    """Mỗi job 1 thư mục tmp riêng → dễ cleanup, không race tên file."""
    d = _TMP_ROOT / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _fetch_input(payload: dict, job_id: str) -> str:
    """Resolve input audio file cho handler.

    Ưu tiên:
    1. payload['audio_key'] + STORAGE_BACKEND=r2 → R2 download → tmp
    2. payload['audio_path'] tồn tại local → dùng thẳng
    3. payload['audio_path'] không tồn tại + R2 mode → coi như R2 key

    Trả về local path để handler xử lý.
    """
    key = payload.get("audio_key")
    path = payload.get("audio_path")

    if key and STORAGE_BACKEND == "r2":
        from app.core import storage_r2
        local = _job_tmp_dir(job_id) / Path(key).name
        storage_r2.download_file(key, local)
        return str(local)

    if path and _os.path.exists(path):
        return path

    # Fallback: nếu chỉ có audio_path và backend là R2, coi audio_path như key
    if path and STORAGE_BACKEND == "r2":
        from app.core import storage_r2
        local = _job_tmp_dir(job_id) / Path(path).name
        storage_r2.download_file(path, local)
        return str(local)

    raise ValueError(
        "Không tìm thấy file audio. payload cần có 'audio_key' (R2) "
        "hoặc 'audio_path' (local).",
    )


def _cleanup_job_tmp(job_id: str) -> None:
    """Xoá tmp dir của job sau khi xong. Best-effort, không raise."""
    d = _TMP_ROOT / job_id
    if not d.exists():
        return
    try:
        for f in d.iterdir():
            try:
                if f.is_file():
                    f.unlink()
                elif f.is_dir():
                    import shutil
                    shutil.rmtree(f, ignore_errors=True)
            except Exception:
                pass
        d.rmdir()
    except Exception as e:
        logger.debug("[worker] cleanup tmp %s skip: %s", job_id, e)


async def _run_sync_generator(gen_factory, progress_cb):
    """Chạy sync generator trong thread, bridge progress qua asyncio.Queue.

    progress_cb(progress, step) là async function do worker cung cấp.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()
    last_update: dict = {}

    def producer():
        try:
            for update in gen_factory():
                loop.call_soon_threadsafe(queue.put_nowait, update)
        except Exception as e:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"step": "error", "label": str(e), "_exception": e},
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, SENTINEL)

    threading.Thread(target=producer, daemon=True).start()

    while True:
        item = await queue.get()
        if item is SENTINEL:
            break
        if item.get("step") == "error" and item.get("_exception"):
            raise item["_exception"]
        last_update = item
        progress = item.get("progress")
        if progress is not None and progress < 0:
            progress = None  # -1 sentinel nghĩa là state change, không phải %
        await progress_cb(progress=progress, step=item.get("step") or item.get("label"))
    return last_update


# ── Dubbing handler ────────────────────────────────────────

async def dubbing_handler(payload: dict, *, job_id: str, progress_cb) -> dict:
    """Payload: { project_id, engine, translate_api_key? }"""
    project_id = payload.get("project_id")
    engine = payload.get("engine", "google")
    translate_api_key = payload.get("translate_api_key")
    if not project_id:
        raise ValueError("Thiếu project_id")

    logger.info("[dubbing] start project=%s engine=%s", project_id, engine)

    def gen_factory():
        return dubbing_svc.auto_dub(
            project_id, engine=engine, api_key=translate_api_key,
        )

    last = await _run_sync_generator(gen_factory, progress_cb)

    # Ước tính thời lượng audio/video để tính usage (phút)
    minutes = 0.0
    try:
        from app.services.dubbing_svc import _load_project
        proj = _load_project(project_id)
        if proj and proj.get("duration"):
            minutes = float(proj["duration"]) / 60.0
    except Exception:
        pass

    return {
        "project_id": project_id,
        "engine": engine,
        "final_step": last.get("step") if last else None,
        "output_url": last.get("output_url") if last else None,
        "usage": {
            "minutes": minutes,
            "project_id": project_id,
        },
    }


register_handler("dubbing", dubbing_handler)


# ── STT handler ────────────────────────────────────────────

async def stt_handler(payload: dict, *, job_id: str, progress_cb) -> dict:
    """Payload: { audio_key? | audio_path?, language? }
    Audio file hoặc đã upload R2 (audio_key) hoặc local path (audio_path).
    Worker tự resolve qua _fetch_input."""
    language = payload.get("language") or None
    audio_path = _fetch_input(payload, job_id)

    try:
        await progress_cb(step="transcribing", progress=5)
        # Whisper blocking call — chạy trong thread để không block event loop
        result = await asyncio.to_thread(
            whisper_svc.transcribe, audio_path,
            True, language,  # return_timestamps=True, language
        )

        # Ước tính phút audio để tính usage
        minutes = 0.0
        try:
            segments = result.get("segments") or []
            if segments:
                minutes = float(segments[-1].get("end", 0) or 0) / 60.0
        except Exception:
            pass

        # KHÔNG dùng step="done" — worker emit "done" cuối cùng kèm result.
        await progress_cb(progress=100, step="finalizing")
        return {
            "text": result.get("text", ""),
            "segments": result.get("segments", []),
            "language": result.get("language"),
            "usage": {"minutes": minutes},
        }
    finally:
        _cleanup_job_tmp(job_id)


register_handler("stt", stt_handler)


# ── TTS handler ────────────────────────────────────────────

async def tts_handler(payload: dict, *, job_id: str, progress_cb) -> dict:
    """Payload: tất cả param của tts_svc.generate(...) + owner_user_id"""
    text = payload.get("text") or ""
    if not text.strip():
        raise ValueError("Nội dung trống.")

    # Check voice ownership nếu có voice_id
    voice_id = payload.get("voice_id")
    owner_id = payload.get("_owner_user_id")
    if voice_id and owner_id:
        from app.db.session import AsyncSessionLocal
        from app.db.models import User
        from app.services import voice_svc as _vs
        async with AsyncSessionLocal() as db:
            user = await db.get(User, owner_id)
            is_admin = bool(user and user.role == "admin")
            v = await _vs.check_ownership(db, voice_id, owner_id, is_admin=is_admin)
            if v is None:
                raise ValueError("Bạn không có quyền sử dụng giọng này.")

    await progress_cb(step="generating", progress=10)
    result = await asyncio.to_thread(
        tts_svc.generate,
        text,
        payload.get("voice_id"),
        payload.get("language"),
        payload.get("speed", 1.0),
        payload.get("num_step"),
        payload.get("guidance_scale"),
        payload.get("t_shift"),
        payload.get("layer_penalty_factor"),
        payload.get("position_temperature"),
        payload.get("class_temperature"),
        payload.get("denoise"),
        payload.get("preprocess_prompt"),
        payload.get("postprocess_output"),
        payload.get("audio_chunk_duration"),
    )
    # storage.save_audio đã tự upload lên R2 public bucket khi STORAGE_BACKEND=r2
    # Endpoint /tts/audio/{file_id} sẽ redirect sang URL R2 public — không cần
    # SCP file về VPS như trước.

    # KHÔNG gọi progress_cb(step="done") ở đây — worker._process_one sẽ emit
    # "done" cuối cùng kèm 'result' sau khi handler return.
    await progress_cb(progress=100, step="finalizing")
    return {
        **result,
        "usage": {"characters": len(text)},
    }


register_handler("tts", tts_handler)


# ── Voice preview / clone handlers ─────────────────────────

async def voice_preview_handler(payload: dict, *, job_id: str, progress_cb) -> dict:
    """Generate a temporary cloned-voice preview on the GPU worker."""
    text = (payload.get("text") or "").strip()
    if not text:
        raise ValueError("Nội dung preview trống.")
    audio_path = _fetch_input(payload, job_id)

    clean_path = None
    try:
        await progress_cb(step="preprocessing", progress=10)
        from app.services.audio_preprocess_svc import preprocess_ref_audio
        from app.services.tts_svc import trim_silence
        from omnivoice import OmniVoiceGenerationConfig

        clean_path = preprocess_ref_audio(audio_path)

        await progress_cb(step="creating_voice_prompt", progress=30)
        voice_prompt = gpu.create_voice_prompt(
            ref_audio=clean_path,
            ref_text=payload.get("ref_text") or None,
        )

        cfg = {
            k: v for k, v in (payload.get("config") or {}).items()
            if v is not None
        }
        gen_config = OmniVoiceGenerationConfig(**cfg)
        kwargs = {"generation_config": gen_config}
        language = payload.get("language")
        speed = payload.get("speed")
        if language:
            kwargs["language"] = language
        if speed and speed != 1.0:
            kwargs["speed"] = speed

        await progress_cb(step="generating", progress=65)
        waveform = gpu.generate_tts(text, voice_prompt=voice_prompt, **kwargs)
        waveform = trim_silence(
            waveform, gpu.sampling_rate, threshold_db=-40, pad_ms=30,
        )
        # save_audio tự upload R2 public bucket nếu STORAGE_BACKEND=r2
        file_id, _file_path = save_audio(waveform, gpu.sampling_rate)
        duration = waveform.shape[-1] / gpu.sampling_rate
        await progress_cb(step="finalizing", progress=100)
        return {
            "audio_url": f"/api/v1/tts/audio/{file_id}",
            "duration": round(duration, 2),
            "usage": {"characters": len(text)},
        }
    finally:
        # Cleanup preprocessed copy + tmp dir của job
        if clean_path:
            try:
                if _os.path.exists(clean_path) and clean_path != audio_path:
                    _os.remove(clean_path)
            except Exception:
                pass
        _cleanup_job_tmp(job_id)


register_handler("voice_preview", voice_preview_handler)


async def voice_clone_handler(payload: dict, *, job_id: str, progress_cb) -> dict:
    """Clone and persist a voice on the GPU worker. R2 mode: voice_svc.clone
    sẽ gọi storage.save_voice → tự mirror file lên R2 private bucket. Không
    cần SCP về VPS."""
    audio_path = _fetch_input(payload, job_id)

    try:
        await progress_cb(step="cloning", progress=20)
        from app.db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            meta = await voice_svc.clone(
                db,
                user_id=int(payload.get("_owner_user_id") or 0),
                audio_path=audio_path,
                name=payload.get("name") or "Voice",
                ref_text=payload.get("ref_text") or None,
                tags=payload.get("tags") or [],
                consent_ip=payload.get("consent_ip"),
            )

        await progress_cb(step="finalizing", progress=100)
        return {**meta, "usage": {"characters": 0}}
    finally:
        _cleanup_job_tmp(job_id)


register_handler("voice_clone", voice_clone_handler)
