"""File storage for voices (.pt/.json/.wav) and audio output (.wav).

Voice layout (per-user folders):
    voices/<user_id>/<voice_id>.pt     ← embedding tensor
    voices/<user_id>/<voice_id>.json   ← metadata
    voices/<user_id>/<voice_id>.wav    ← raw ref audio (cho XTTS fallback)

Legacy flat layout (voices/<voice_id>.pt) vẫn được hỗ trợ đọc — migration
script trong db/migrations.py sẽ chuyển dần sang folder user.
"""

import json
import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import soundfile as sf
import torch

from app.config import AUDIO_OUTPUT_DIR, VOICES_DIR

logger = logging.getLogger(__name__)

# TTL cho file TTS output: file > N giờ sẽ bị xoá. User được khuyến khích
# tải về máy ngay sau khi generate. Đặt 24h để vẫn có "lịch sử ngắn" cho
# user retry / preview lại trong cùng ngày.
AUDIO_OUTPUT_TTL_SEC = 24 * 60 * 60


# ── Audio output ─────────────────────────────────────
def save_audio(waveform, sample_rate: int) -> tuple[str, str]:
    """Save waveform tensor to WAV file. Returns (file_id, file_path)."""
    file_id = uuid.uuid4().hex[:12]
    filename = f"{file_id}.wav"
    path = AUDIO_OUTPUT_DIR / filename
    sf.write(str(path), waveform.cpu().numpy(), sample_rate)
    return file_id, str(path)


def get_audio_path(file_id: str) -> Optional[Path]:
    path = AUDIO_OUTPUT_DIR / f"{file_id}.wav"
    return path if path.exists() else None


def cleanup_audio_output(ttl_sec: int = AUDIO_OUTPUT_TTL_SEC) -> int:
    """Xoá các file .wav trong AUDIO_OUTPUT_DIR cũ hơn ttl_sec giây.
    Trả về số file đã xoá. Lỗi từng file → bỏ qua (không fatal).
    """
    now = time.time()
    deleted = 0
    try:
        for f in AUDIO_OUTPUT_DIR.glob("*.wav"):
            try:
                age = now - f.stat().st_mtime
                if age > ttl_sec:
                    f.unlink()
                    deleted += 1
            except Exception as e:
                logger.warning("cleanup_audio_output skip %s: %s", f.name, e)
    except Exception as e:
        logger.warning("cleanup_audio_output scan failed: %s", e)
    if deleted:
        logger.info("cleanup_audio_output: deleted %d expired file(s)", deleted)
    return deleted


# ── Voice storage (user-scoped) ──────────────────────

def _user_voice_dir(owner_id: int | str) -> Path:
    """voices/<owner_id>/ — tự tạo nếu chưa có."""
    d = VOICES_DIR / str(owner_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _resolve_voice_path(voice_id: str, ext: str,
                        owner_id: int | str | None = None) -> Optional[Path]:
    """Tìm file <voice_id>.<ext> theo thứ tự ưu tiên:
       1. voices/<owner_id>/<voice_id>.<ext>  (nếu có owner_id)
       2. voices/<u>/<voice_id>.<ext>         (scan các user folder)
       3. voices/<voice_id>.<ext>             (legacy flat)
    Trả Path tồn tại đầu tiên, hoặc None.
    """
    if owner_id is not None:
        p = _user_voice_dir(owner_id) / f"{voice_id}.{ext}"
        if p.exists():
            return p
    # Scan user subfolders
    if VOICES_DIR.exists():
        for sub in VOICES_DIR.iterdir():
            if sub.is_dir():
                p = sub / f"{voice_id}.{ext}"
                if p.exists():
                    return p
    # Legacy flat
    flat = VOICES_DIR / f"{voice_id}.{ext}"
    if flat.exists():
        return flat
    return None


def _meta_path(voice_id: str, owner_id: int | str | None = None) -> Path:
    """Path canonical (luôn nằm trong user folder nếu có owner_id) dùng
    cho ghi mới. Đọc thì dùng _resolve_voice_path."""
    if owner_id is not None:
        return _user_voice_dir(owner_id) / f"{voice_id}.json"
    return VOICES_DIR / f"{voice_id}.json"


def save_voice(voice_id: str, name: str, prompt, ref_text: str = None,
               tags: list = None, owner_id: int | str | None = None):
    """Save voice prompt (.pt, optional) và metadata (.json) vào folder của
    owner. Nếu không truyền owner_id → fallback flat (chỉ dùng cho code cũ
    chưa migrate, KHÔNG khuyến nghị).
    """
    if owner_id is not None:
        target_dir = _user_voice_dir(owner_id)
    else:
        target_dir = VOICES_DIR
        logger.warning("save_voice without owner_id (legacy flat) for %s", voice_id)
    if prompt is not None:
        torch.save(prompt, target_dir / f"{voice_id}.pt")
    meta = {
        "id": voice_id,
        "name": name,
        "ref_text": ref_text,
        "tags": tags or [],
        "created_at": datetime.now().isoformat(),
        "has_prompt": prompt is not None,
        "owner_id": owner_id,
    }
    (target_dir / f"{voice_id}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def load_voice(voice_id: str, owner_id: int | str | None = None):
    """Load voice prompt tensor. Tìm file qua _resolve_voice_path."""
    path = _resolve_voice_path(voice_id, "pt", owner_id)
    if path is None:
        return None
    return torch.load(str(path), weights_only=False)


def get_voice_meta(voice_id: str,
                   owner_id: int | str | None = None) -> Optional[dict]:
    path = _resolve_voice_path(voice_id, "json", owner_id)
    if path is None:
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_voices() -> List[dict]:
    """List ALL voices từ filesystem (cả user folders + legacy flat).
    Caller (admin) cần dedupe nếu lo trùng. User-facing list nên query DB
    qua voice_svc.get_all() thay vì hàm này.
    """
    voices = []
    # User folders
    if VOICES_DIR.exists():
        for sub in sorted(VOICES_DIR.iterdir()):
            if sub.is_dir():
                for f in sorted(sub.glob("*.json")):
                    try:
                        voices.append(json.loads(f.read_text(encoding="utf-8")))
                    except Exception:
                        continue
    # Legacy flat
    for f in sorted(VOICES_DIR.glob("*.json")):
        try:
            voices.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    return voices


def delete_voice(voice_id: str, owner_id: int | str | None = None) -> bool:
    """Delete tất cả file của voice (.pt + .json + .wav) tại MỌI vị trí
    có thể (user folder mới + legacy flat). Idempotent.
    """
    deleted = False
    candidate_dirs: list[Path] = []
    if owner_id is not None:
        candidate_dirs.append(_user_voice_dir(owner_id))
    if VOICES_DIR.exists():
        for sub in VOICES_DIR.iterdir():
            if sub.is_dir() and sub not in candidate_dirs:
                candidate_dirs.append(sub)
    candidate_dirs.append(VOICES_DIR)  # flat last

    for d in candidate_dirs:
        for ext in ("pt", "json", "wav"):
            p = d / f"{voice_id}.{ext}"
            if p.exists():
                try:
                    p.unlink()
                    deleted = True
                except Exception as e:
                    logger.warning("delete_voice failed for %s: %s", p, e)
    return deleted


def delete_user_voices(owner_id: int | str) -> int:
    """Wipe toàn bộ folder voices/<owner_id>/. Gọi khi user xoá tài khoản.
    Trả về số file đã xoá."""
    d = VOICES_DIR / str(owner_id)
    if not d.exists():
        return 0
    count = 0
    try:
        for f in d.iterdir():
            try:
                f.unlink()
                count += 1
            except Exception as e:
                logger.warning("delete_user_voices skip %s: %s", f, e)
        try:
            d.rmdir()
        except Exception:
            pass
    except Exception as e:
        logger.warning("delete_user_voices failed for %s: %s", owner_id, e)
    if count:
        logger.info("delete_user_voices: removed %d files for user %s",
                    count, owner_id)
    return count
