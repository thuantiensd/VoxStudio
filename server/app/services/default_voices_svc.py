"""Default voice pool — fallback giọng built-in cho multi-voice mode.

Khi user dub 2+ giọng nhưng chưa có voice clone riêng cho speaker, hệ thống
gán giọng từ pool này. Đảm bảo:
  - Cùng speaker_id → cùng giọng XUYÊN SUỐT VIDEO (deterministic via hash)
  - Match gender: speaker nam → giọng nam, speaker nữ → giọng nữ
  - Giọng built-in pool đa dạng (≥2 nam, ≥2 nữ) để 2+ speaker cùng gender
    không bị trùng giọng

Voice pool source: OmniVoice-master/voices/*.pt (đã clone sẵn).
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# Path tới folder voices của OmniVoice-master (chứa file .pt đã clone sẵn).
# Search nhiều location để work cả Mac local + RunPod.
_VOICE_SEARCH_PATHS = [
    Path("/content/OmniVoice-master/voices"),
    Path(__file__).parent.parent.parent.parent / "OmniVoice-master" / "voices",
]


# Phân loại giọng theo gender. Tên file ánh xạ thủ công vì OmniVoice không
# lưu metadata gender trong .pt. Khi thêm giọng mới, update map này.
_VOICE_POOL = {
    "male": [
        "BLV_Bóng_Đá",       # giọng bình luận viên thể thao nam
        "Châu_Tinh_Trì",     # giọng diễn viên nam
    ],
    "female": [
        "Nữ",                # giọng nữ chuẩn
    ],
}


_voice_pool_cache: dict[str, list[Path]] | None = None


def _resolve_voice_pool() -> dict[str, list[Path]]:
    """Tìm physical .pt files cho từng tên trong _VOICE_POOL.
    Cached sau lần đầu scan."""
    global _voice_pool_cache
    if _voice_pool_cache is not None:
        return _voice_pool_cache

    # Tìm voices_dir tồn tại
    voices_dir = None
    for p in _VOICE_SEARCH_PATHS:
        if p.exists() and p.is_dir():
            voices_dir = p
            break

    if voices_dir is None:
        logger.warning("Default voice pool: OmniVoice voices folder not found")
        _voice_pool_cache = {"male": [], "female": []}
        return _voice_pool_cache

    resolved: dict[str, list[Path]] = {"male": [], "female": []}
    for gender, names in _VOICE_POOL.items():
        for name in names:
            p = voices_dir / f"{name}.pt"
            if p.exists():
                resolved[gender].append(p)
            else:
                logger.warning("Default voice pool: missing %s.pt", name)

    logger.info("Default voice pool resolved: male=%d female=%d (dir=%s)",
                len(resolved["male"]), len(resolved["female"]), voices_dir)
    _voice_pool_cache = resolved
    return resolved


def get_default_voice_path_for_speaker(
    speaker_id: str | None,
    gender: str | None,
) -> Optional[Path]:
    """Pick 1 voice .pt path từ pool dựa trên speaker_id + gender.

    Deterministic: cùng (speaker_id, gender) → cùng path mỗi lần gọi.
    Hash speaker_id rồi modulo pool size để chọn → distribute đều +
    ổn định xuyên suốt video.

    Returns:
      Path tới .pt, hoặc None nếu pool rỗng → caller fallback sang
      voice_prompt=None (OmniVoice tự sinh giọng baseline).
    """
    pool = _resolve_voice_pool()
    g = (gender or "").lower()

    # Pick pool theo gender (fallback "any" → male nếu không có gender info)
    if g == "female" and pool["female"]:
        candidates = pool["female"]
    elif g == "male" and pool["male"]:
        candidates = pool["male"]
    else:
        # Không có gender → ưu tiên male (BLV phổ biến hơn cho narrator).
        # Hoặc gender không match (vd unknown) → male làm fallback.
        candidates = pool["male"] or pool["female"]

    if not candidates:
        return None

    # Deterministic pick — cùng speaker_id luôn ra cùng index
    key = (speaker_id or "default").encode("utf-8")
    h = hashlib.md5(key).digest()
    idx = int.from_bytes(h[:4], "big") % len(candidates)
    return candidates[idx]


def has_default_voices() -> bool:
    """Kiểm tra pool có voice nào không (cho diagnostic / debug)."""
    pool = _resolve_voice_pool()
    return bool(pool["male"] or pool["female"])
