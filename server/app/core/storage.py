"""File storage for voices (.pt/.json/.wav) and audio output (.wav).

Hỗ trợ 2 backend qua STORAGE_BACKEND env:
- "local" (default): filesystem local — đủ dùng dev và single-node prod.
- "r2": Cloudflare R2 — split deploy VPS + RunPod worker, FE upload trực tiếp
        qua presigned URL, output public read qua CDN.

Voice layout (per-user folders):
    voices/<user_id>/<voice_id>.pt     ← embedding tensor
    voices/<user_id>/<voice_id>.json   ← metadata
    voices/<user_id>/<voice_id>.wav    ← raw ref audio (cho XTTS fallback)

R2 mode mirror cùng path dưới prefix `voices/` trong private bucket. Worker
load voice sẽ check local cache trước, miss thì pull từ R2 về local. Việc
ghi mới luôn ghi local + upload R2.

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

from app.config import AUDIO_OUTPUT_DIR, STORAGE_BACKEND, VOICES_DIR

logger = logging.getLogger(__name__)

# TTL cho file TTS output local: file > N giờ sẽ bị xoá. User được khuyến khích
# tải về máy ngay sau khi generate. Đặt 24h để vẫn có "lịch sử ngắn" cho
# user retry / preview lại trong cùng ngày.
AUDIO_OUTPUT_TTL_SEC = 24 * 60 * 60

_USE_R2 = STORAGE_BACKEND == "r2"


def _r2():
    """Lazy import R2 module — không import nếu backend=local."""
    from app.core import storage_r2
    return storage_r2


# ── Audio output ─────────────────────────────────────

def save_audio(waveform, sample_rate: int) -> tuple[str, str]:
    """Save waveform tensor to WAV. Trả (file_id, file_path).

    Local mode: ghi thẳng vào AUDIO_OUTPUT_DIR.
    R2 mode: ghi tạm local (cần cho hậu xử lý/cleanup) + upload public bucket.
    """
    file_id = uuid.uuid4().hex[:12]
    filename = f"{file_id}.wav"
    path = AUDIO_OUTPUT_DIR / filename
    sf.write(str(path), waveform.cpu().numpy(), sample_rate)

    if _USE_R2:
        try:
            r2 = _r2()
            r2.upload_file(
                path,
                f"audio/{filename}",
                bucket=r2.public_bucket(),
                content_type="audio/wav",
            )
        except Exception as e:
            logger.error("[storage] R2 upload audio failed (%s) — fallback local", e)
            # Không raise: local file vẫn còn, route /tts/audio/{id} có thể fallback.
    return file_id, str(path)


def get_audio_path(file_id: str) -> Optional[Path]:
    """Trả Path local file nếu tồn tại. R2 mode: file có thể đã cleanup local
    (chỉ còn trên R2) — dùng get_audio_url() thay vì path."""
    path = AUDIO_OUTPUT_DIR / f"{file_id}.wav"
    return path if path.exists() else None


def get_audio_url(file_id: str) -> Optional[str]:
    """Trả URL công khai để client tải audio output.

    Local mode: None — caller serve qua endpoint /tts/audio/{id}.
    R2 mode: URL public bucket trực tiếp (CDN, không qua VPS bandwidth).
    """
    if not _USE_R2:
        return None
    try:
        return _r2().public_url(f"audio/{file_id}.wav")
    except Exception as e:
        logger.warning("[storage] build R2 audio url failed: %s", e)
        return None


def delete_audio(file_id: str) -> bool:
    """Xoá file audio output theo file_id. Trả True nếu xoá được, False nếu
    không tồn tại. Dùng khi client confirm đã tải xong → server không cần
    giữ nữa, tiết kiệm storage + tăng privacy.

    Path traversal protection: file_id phải hex/alnum, không có / hay ..
    """
    if not file_id or not file_id.replace("-", "").replace("_", "").isalnum():
        return False
    if len(file_id) > 32:
        return False
    path = AUDIO_OUTPUT_DIR / f"{file_id}.wav"
    try:
        if path.exists():
            path.unlink()
            logger.info("[storage] deleted audio %s after client confirm", file_id)
            return True
        return False
    except Exception as e:
        logger.warning("[storage] delete_audio %s failed: %s", file_id, e)
        return False


def cleanup_audio_output(ttl_sec: int = AUDIO_OUTPUT_TTL_SEC) -> int:
    """Xoá các file .wav local cũ hơn ttl_sec giây. Trả về số file đã xoá.

    Lưu ý: KHÔNG xoá đối tượng trên R2 (cleanup R2 phải qua Object Lifecycle
    Rules cấu hình bên Cloudflare để tránh load nặng + cost list ops).
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


def _voice_r2_key(owner_id: int | str, voice_id: str, ext: str) -> str:
    """Path canonical trong R2 private bucket cho file voice."""
    return f"voices/{owner_id}/{voice_id}.{ext}"


def _resolve_voice_path(voice_id: str, ext: str,
                        owner_id: int | str | None = None) -> Optional[Path]:
    """Tìm file <voice_id>.<ext> theo thứ tự ưu tiên:
       1. voices/<owner_id>/<voice_id>.<ext>  (nếu có owner_id)
       2. voices/<u>/<voice_id>.<ext>         (scan các user folder)
       3. voices/<voice_id>.<ext>             (legacy flat)
    Trả Path tồn tại đầu tiên, hoặc None.

    R2 mode: nếu local miss và có owner_id → thử pull từ R2 về local cache rồi
    trả Path đó. Lần sau hit local. Tránh re-download mỗi inference call.
    """
    if owner_id is not None:
        p = _user_voice_dir(owner_id) / f"{voice_id}.{ext}"
        if p.exists():
            return p
        # R2 fallback: pull về cache
        if _USE_R2:
            try:
                _r2().download_file(_voice_r2_key(owner_id, voice_id, ext), p)
                if p.exists():
                    return p
            except Exception as e:
                logger.debug("[storage] R2 pull miss %s/%s.%s: %s",
                             owner_id, voice_id, ext, e)
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
    owner. R2 mode: mirror cả 2 file lên private bucket sau khi ghi local
    để worker khác / VPS truy cập được.

    Nếu không truyền owner_id → fallback flat (chỉ dùng cho code cũ chưa
    migrate, KHÔNG khuyến nghị).
    """
    if owner_id is not None:
        target_dir = _user_voice_dir(owner_id)
    else:
        target_dir = VOICES_DIR
        logger.warning("save_voice without owner_id (legacy flat) for %s", voice_id)

    pt_path = target_dir / f"{voice_id}.pt"
    if prompt is not None:
        torch.save(prompt, pt_path)

    meta = {
        "id": voice_id,
        "name": name,
        "ref_text": ref_text,
        "tags": tags or [],
        "created_at": datetime.now().isoformat(),
        "has_prompt": prompt is not None,
        "owner_id": owner_id,
    }
    meta_path = target_dir / f"{voice_id}.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    if _USE_R2 and owner_id is not None:
        try:
            r2 = _r2()
            if prompt is not None and pt_path.exists():
                r2.upload_file(pt_path, _voice_r2_key(owner_id, voice_id, "pt"))
            r2.upload_file(
                meta_path,
                _voice_r2_key(owner_id, voice_id, "json"),
                content_type="application/json",
            )
        except Exception as e:
            logger.error("[storage] R2 mirror voice failed %s: %s", voice_id, e)
            # Không raise — local đã ghi xong, sync R2 có thể retry sau.

    return meta


def load_voice(voice_id: str, owner_id: int | str | None = None):
    """Load voice prompt tensor. Routing 2 pools:
      • voice_id dạng `nu_*` / `nam_*` → premium preset (shared, ko gắn user)
      • voice_id UUID → user clone (folder per user, fallback R2)
    """
    # Premium preset — không cần owner_id, không có DB row
    from app.services.premium_voice_svc import is_premium_slug, load_premium_prompt
    if is_premium_slug(voice_id):
        return load_premium_prompt(voice_id)

    # User clone path
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

    R2 mode: vẫn list local (cache) — không pull full bucket vì list ops
    tốn quota. DB là source of truth cho enumeration; storage chỉ check
    file tồn tại bằng has_prompt khi cần.
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
    có thể (user folder mới + legacy flat) + R2 mirror (nếu R2 mode).
    Idempotent.
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

    if _USE_R2 and owner_id is not None:
        try:
            r2 = _r2()
            for ext in ("pt", "json", "wav"):
                r2.delete(_voice_r2_key(owner_id, voice_id, ext))
        except Exception as e:
            logger.warning("[storage] R2 delete voice %s failed: %s", voice_id, e)

    return deleted


def delete_user_voices(owner_id: int | str) -> int:
    """Wipe toàn bộ folder voices/<owner_id>/ + R2 prefix tương ứng. Gọi khi
    user xoá tài khoản. Trả về số file đã xoá local (R2 ops không tính)."""
    d = VOICES_DIR / str(owner_id)
    count = 0
    if d.exists():
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

    if _USE_R2:
        try:
            r2 = _r2()
            keys = r2.list_prefix(f"voices/{owner_id}/")
            if keys:
                r2.delete_many(keys)
        except Exception as e:
            logger.warning("[storage] R2 wipe user %s failed: %s", owner_id, e)

    if count:
        logger.info("delete_user_voices: removed %d files for user %s",
                    count, owner_id)
    return count
