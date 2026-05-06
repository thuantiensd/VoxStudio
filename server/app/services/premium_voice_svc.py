"""Premium preset voices — built-in voice library shared by all users.

Premium voices KHÁC user clones:
  • Lưu ở `voxstudio-engine/voices/<slug>.pt` (không phải `server/voices/`)
  • Slug-based ID (`nu_mai_anh`, `nam_quoc_bao`) thay vì UUID
  • Không vào DB `voices` table → không xuất hiện trong My Voices của user
  • Read-only — user không edit/xoá được, chỉ pick để dùng
  • Có preview audio (.wav) sẵn để user nghe thử trước khi chọn

Public API:
  list_premium() → list[dict] — toàn bộ preset, group được theo gender
  get_premium(slug) → dict | None — metadata 1 voice
  load_premium_prompt(slug) → VoiceClonePrompt | None — embedding tensor
  get_preview_path(slug) → Path | None — path tới <slug>_preview.wav
  is_premium_slug(s) → bool — discriminator giữa preset slug vs UUID clone
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# Slugs preset có prefix theo ngôn ngữ. UUID clone là hex 12 char (ko underscore).
# Phân biệt rõ ràng để storage layer route đúng pool.
#   nu_/nam_ : Vietnamese (legacy + main pool)
#   en_/zh_/jp_/kr_/fr_/es_/de_/ru_/it_/pt_ : multi-language presets
_PREMIUM_SLUG_PREFIXES = (
    "nu_", "nam_",
    "en_", "zh_", "jp_", "kr_", "fr_", "es_", "de_", "ru_", "it_", "pt_",
)


# Path tới folder voices của voxstudio-engine. Search nhiều location để work
# cả Mac local + VPS/server (folder có thể nằm ở repo root hoặc mounted volume).
_VOICE_SEARCH_PATHS = [
    Path(__file__).parent.parent.parent.parent / "voxstudio-engine" / "voices",
]


# In-memory cache: voices_dir + dict slug→meta. Invalidated khi gọi reload_cache().
_cache: dict[str, Any] | None = None


def _resolve_voices_dir() -> Optional[Path]:
    for p in _VOICE_SEARCH_PATHS:
        if p.exists() and p.is_dir():
            return p
    return None


def _build_cache() -> dict[str, Any]:
    """Scan folder, đọc tất cả .json sidecar, build dict slug→meta.
    Empty cache nếu folder không tồn tại."""
    voices_dir = _resolve_voices_dir()
    if voices_dir is None:
        logger.warning("Premium voices: voxstudio-engine/voices/ not found")
        return {"voices_dir": None, "by_slug": {}}

    by_slug: dict[str, dict] = {}
    for json_file in sorted(voices_dir.glob("*.json")):
        slug = json_file.stem
        if not slug.startswith(_PREMIUM_SLUG_PREFIXES):
            # File khác (vd voice cũ legacy không match prefix) → skip,
            # không coi là premium preset.
            continue
        pt_file = json_file.with_suffix(".pt")
        if not pt_file.exists():
            logger.warning("Premium voice %s: .json có nhưng .pt thiếu, skip", slug)
            continue
        try:
            meta = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Premium voice %s: invalid metadata (%s), skip", slug, e)
            continue
        # Augment với path info để caller không cần query lại
        preview_file = voices_dir / f"{slug}_preview.wav"
        meta["_pt_path"] = pt_file
        meta["_preview_path"] = preview_file if preview_file.exists() else None
        by_slug[slug] = meta

    logger.info("Premium voices loaded: %d presets (dir=%s)",
                len(by_slug), voices_dir)
    return {"voices_dir": voices_dir, "by_slug": by_slug}


def _get_cache() -> dict[str, Any]:
    global _cache
    if _cache is None:
        _cache = _build_cache()
    return _cache


def reload_cache() -> None:
    """Force rescan folder. Gọi sau khi build/redeploy thêm preset mới."""
    global _cache
    _cache = None


def is_premium_slug(voice_id: str | None) -> bool:
    """True nếu voice_id là preset slug. Dùng ở storage layer để route loader."""
    if not voice_id:
        return False
    return voice_id.startswith(_PREMIUM_SLUG_PREFIXES)


def _to_public_dict(slug: str, meta: dict) -> dict:
    """Strip internal fields (_pt_path, _preview_path), build response object."""
    has_preview = meta.get("_preview_path") is not None
    # Default language: vietnamese — 12 preset hiện tại đều train trên text VN.
    # Khi thêm voice non-VN, .json sidecar phải set language explicit.
    return {
        "slug": slug,
        "display_name": meta.get("display_name") or slug,
        "gender": meta.get("gender") or "",
        "language": (meta.get("language") or "vietnamese").lower(),
        "description": meta.get("description") or "",
        "instruct": meta.get("instruct") or "",
        "preview_url": f"/api/v1/voices/premium/{slug}/preview" if has_preview else None,
    }


def list_premium() -> list[dict]:
    """Toàn bộ preset, sorted: nữ trước, nam sau, mỗi nhóm theo display_name."""
    by_slug = _get_cache()["by_slug"]
    items = [_to_public_dict(slug, meta) for slug, meta in by_slug.items()]
    # Sort female first, then male; within group by display_name
    items.sort(key=lambda x: (
        0 if x["gender"] == "female" else 1 if x["gender"] == "male" else 2,
        x["display_name"],
    ))
    return items


def get_premium(slug: str) -> Optional[dict]:
    by_slug = _get_cache()["by_slug"]
    meta = by_slug.get(slug)
    if meta is None:
        return None
    return _to_public_dict(slug, meta)


def get_preview_path(slug: str) -> Optional[Path]:
    """Path tới <slug>_preview.wav. None nếu preview chưa build."""
    by_slug = _get_cache()["by_slug"]
    meta = by_slug.get(slug)
    if meta is None:
        return None
    return meta.get("_preview_path")


def load_premium_prompt(slug: str):
    """Load voice_clone_prompt tensor. Return None nếu slug không tồn tại
    hoặc load fail.

    Load identical với user clone path (storage.load_voice) — chỉ
    `torch.load(path, weights_only=False)` để giữ behavior nhất quán.
    weights_only=False vì VoiceClonePrompt là dataclass custom; premium
    pool là code-controlled (dev build qua script) → an toàn unpickle.
    """
    by_slug = _get_cache()["by_slug"]
    meta = by_slug.get(slug)
    if meta is None:
        return None
    pt_path: Path = meta["_pt_path"]
    try:
        import torch
        return torch.load(str(pt_path), weights_only=False)
    except Exception as e:
        logger.error("Load premium voice %s fail: %s", slug, e)
        return None
