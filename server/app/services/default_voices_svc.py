"""Default voice pool — fallback giọng built-in cho multi-voice mode.

Khi dub 2+ giọng nhưng user chưa pick voice clone riêng cho speaker, hệ
thống gán giọng từ pool này. Đảm bảo:
  - Cùng speaker_id → cùng giọng XUYÊN SUỐT VIDEO (deterministic via hash)
  - Match gender: speaker nam → giọng nam, speaker nữ → giọng nữ
  - Pool đa dạng (≥2 nam, ≥2 nữ) → 2+ speaker cùng gender không trùng giọng

Voice pool source: voxstudio-engine/voices/<slug>.pt — share chung pool với
premium_voice_svc. Nguồn của truth là `.json` sidecar (gender field).
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Optional

from app.services.premium_voice_svc import _get_cache

logger = logging.getLogger(__name__)


def _resolve_voice_pool() -> dict[str, list[Path]]:
    """Group premium voices theo gender. Reuse cache của premium_voice_svc
    để khỏi scan folder 2 lần."""
    cache = _get_cache()
    by_slug = cache["by_slug"]
    pool: dict[str, list[Path]] = {"male": [], "female": []}
    for slug, meta in by_slug.items():
        g = (meta.get("gender") or "").lower()
        if g in ("male", "female"):
            pool[g].append(meta["_pt_path"])
    return pool


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
      voice_prompt=None (Vox Premium tự sinh giọng baseline).
    """
    pool = _resolve_voice_pool()
    g = (gender or "").lower()

    if g == "female" and pool["female"]:
        candidates = pool["female"]
    elif g == "male" and pool["male"]:
        candidates = pool["male"]
    else:
        # Không có gender info hoặc gender lạ → fallback male (narrator
        # thường nam), nếu pool nam rỗng thì lấy nữ.
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
