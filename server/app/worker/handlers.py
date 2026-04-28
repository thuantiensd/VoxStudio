"""Handlers cho mỗi job kind. Đăng ký vào gpu_worker dispatch table.

Wrap các pipeline hiện tại (dubbing_svc.auto_dub sync generator) thành
async handler theo signature worker expect:
    async def handler(payload: dict, job_id: str, progress_cb) -> dict
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

import tempfile
import os as _os
import subprocess

from app.services import dubbing_svc, whisper_svc, tts_svc
from app.worker.gpu_worker import register_handler

logger = logging.getLogger(__name__)


def _ensure_local_file(remote_path: str) -> str:
    """Nếu file path trỏ tới VPS (không tồn tại local), SCP về /tmp.

    Dùng khi worker chạy trên Pod riêng (RunPod) còn API node trên VPS.
    Pod kết nối VPS qua SSH key đã setup ở /root/.ssh/id_ed25519.
    Trả về local path để xử lý.
    """
    if _os.path.exists(remote_path):
        return remote_path

    vps_host = _os.environ.get("VPS_FILE_HOST", "")  # vd "root@152.42.172.224"
    if not vps_host:
        raise ValueError(f"File không tồn tại: {remote_path}")

    local_path = f"/tmp/{_os.path.basename(remote_path)}"
    try:
        subprocess.run(
            ["scp", "-o", "StrictHostKeyChecking=no",
             "-i", "/root/.ssh/id_ed25519",
             f"{vps_host}:{remote_path}", local_path],
            check=True, capture_output=True, timeout=120,
        )
    except subprocess.CalledProcessError as e:
        raise ValueError(f"SCP thất bại từ {vps_host}: {e.stderr.decode()[:200]}")
    return local_path


def _upload_to_vps(local_path: str, remote_path: str | None = None) -> bool:
    """Push file local Pod → VPS. Dùng sau khi sinh output (TTS, dub, v.v.)
    để VPS serve được URL. No-op nếu không set VPS_FILE_HOST.
    """
    vps_host = _os.environ.get("VPS_FILE_HOST", "")
    if not vps_host or not _os.path.exists(local_path):
        return False
    remote_path = remote_path or local_path  # mirror path
    # Đảm bảo thư mục tồn tại trên VPS
    remote_dir = _os.path.dirname(remote_path)
    try:
        subprocess.run(
            ["ssh", "-o", "StrictHostKeyChecking=no",
             "-i", "/root/.ssh/id_ed25519",
             vps_host, f"mkdir -p {remote_dir}"],
            check=True, capture_output=True, timeout=15,
        )
        subprocess.run(
            ["scp", "-o", "StrictHostKeyChecking=no",
             "-i", "/root/.ssh/id_ed25519",
             local_path, f"{vps_host}:{remote_path}"],
            check=True, capture_output=True, timeout=300,
        )
        return True
    except subprocess.CalledProcessError as e:
        logger.warning("SCP upload back to VPS failed: %s", e.stderr.decode()[:200])
        return False


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
    """Payload: { audio_path, language? }
    Audio file được endpoint copy vào tmp dir trước, payload chỉ có path
    (tránh chuyển Base64 lớn qua JSON)."""
    audio_path = payload.get("audio_path")
    language = payload.get("language") or None
    if not audio_path:
        raise ValueError("Không tìm thấy file audio cần xử lý.")
    audio_path = _ensure_local_file(audio_path)

    await progress_cb(step="transcribing", progress=5)
    # Whisper blocking call — chạy trong thread để không block event loop
    import asyncio as _asyncio
    result = await _asyncio.to_thread(
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

    # Cleanup tmp file
    try:
        _os.remove(audio_path)
    except Exception:
        pass

    # KHÔNG dùng step="done" — worker emit "done" cuối cùng kèm result.
    await progress_cb(progress=100, step="finalizing")
    # Trả đúng shape mà endpoint /stt/transcribe đang return
    return {
        "text": result.get("text", ""),
        "segments": result.get("segments", []),
        "language": result.get("language"),
        "usage": {"minutes": minutes},
    }


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
    import asyncio as _asyncio
    result = await _asyncio.to_thread(
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
    # Push generated audio file back to VPS (nếu chạy chế độ split worker).
    # tts_svc trả audio_url dạng "/api/v1/tts/audio/<file_id>" — file thật ở
    # AUDIO_OUTPUT_DIR/<file_id>.wav. Upload mirror path sang VPS để FE
    # download qua URL VPS.
    try:
        from app.config import AUDIO_OUTPUT_DIR as _AOD
        audio_url = result.get("audio_url", "")
        if audio_url.startswith("/api/v1/tts/audio/"):
            file_id = audio_url.rsplit("/", 1)[-1]
            local_path = str(_AOD / f"{file_id}.wav")
            if _os.path.exists(local_path):
                _upload_to_vps(local_path)
    except Exception as e:
        logger.warning("TTS upload-back skipped: %s", e)

    # KHÔNG gọi progress_cb(step="done") ở đây — worker._process_one sẽ emit
    # "done" cuối cùng kèm 'result' sau khi handler return. Nếu handler tự emit
    # "done" thì subscriber sẽ thấy event "done" rỗng trước, trả về {} sớm.
    await progress_cb(progress=100, step="finalizing")
    # Merge usage vào result (giữ shape cũ: audio_url, duration, sample_rate)
    return {
        **result,
        "usage": {"characters": len(text)},
    }


register_handler("tts", tts_handler)
