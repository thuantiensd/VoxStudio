"""LRU cache cho translation results — giảm cost LLM API + tăng tốc re-run.

Use case:
  - User dub cùng video 2 lần (test settings) → 100% cache hit
  - Phim series có dialogue lặp ("Vâng", "Cảm ơn", "Đợi đã") → 30%+ hit
  - User edit translation thủ công rồi re-run TTS → segments cached

Key: SHA256(text + src_lang + tgt_lang + engine + register + speaker_gender)
Value: dict {translated_text, speech_text, emotion}

LRU 5000 entries (đủ cho ~50 dub jobs, 100 segments/job). Memory ~5MB.
Thread-safe (lock). Process-local — không persist qua restart (acceptable
cho production phase 1, có thể chuyển Redis sau).
"""
from __future__ import annotations

import hashlib
import logging
import threading
from collections import OrderedDict
from typing import Optional

logger = logging.getLogger(__name__)


# LRU cap — config qua env nếu cần tune sau
MAX_ENTRIES = 5000


class TranslationCache:
    """Thread-safe LRU cache cho translation results."""

    def __init__(self, max_entries: int = MAX_ENTRIES):
        self._max = max_entries
        self._cache: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    @staticmethod
    def make_key(
        *,
        text: str,
        src_lang: str,
        tgt_lang: str,
        engine: str,
        register: str = "",
        speaker_gender: str = "",
    ) -> str:
        """Build cache key từ context. Chuẩn hoá để consistent."""
        normalized = "|".join([
            (text or "").strip(),
            (src_lang or "auto").lower().strip(),
            (tgt_lang or "").lower().strip(),
            (engine or "").lower().strip(),
            (register or "generic").lower().strip(),
            (speaker_gender or "").lower().strip(),
        ])
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def get(self, key: str) -> Optional[dict]:
        with self._lock:
            if key in self._cache:
                # Move to end (most recently used)
                self._cache.move_to_end(key)
                self._hits += 1
                return dict(self._cache[key])
            self._misses += 1
            return None

    def set(self, key: str, value: dict) -> None:
        if not value or not value.get("translated_text"):
            return  # Don't cache empty/failed translations
        with self._lock:
            self._cache[key] = dict(value)
            self._cache.move_to_end(key)
            # Evict oldest if over limit
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)

    def stats(self) -> dict:
        with self._lock:
            total = self._hits + self._misses
            return {
                "size": len(self._cache),
                "max_size": self._max,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(self._hits / total, 3) if total else 0.0,
                "total_lookups": total,
            }

    def clear(self) -> int:
        with self._lock:
            n = len(self._cache)
            self._cache.clear()
            self._hits = 0
            self._misses = 0
            return n


# Global singleton
_cache = TranslationCache()


def get_translation_cache() -> TranslationCache:
    """Public accessor cho cache singleton."""
    return _cache


def cached_translate_segments(
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    engine: str,
    register: str,
    fallback_translate_fn,
    *,
    speaker_genders: Optional[dict] = None,
) -> list[dict]:
    """Batch translate với cache.

    Args:
      segments: list {index, original_text, speaker?, ...}
      fallback_translate_fn: callable(uncached_segments) → list[dict]
        chỉ được gọi với segments KHÔNG có trong cache
      speaker_genders: optional, để key hash nhất quán

    Returns: list[dict] cho ALL segments (đã hợp nhất cache + LLM call).
    """
    cache = _cache
    results = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
               for _ in segments]
    uncached_segs: list[dict] = []
    uncached_indices: list[int] = []
    keys: list[str] = []

    # Pass 1: lookup cache
    for i, seg in enumerate(segments):
        text = (seg.get("original_text") or "").strip()
        if not text:
            continue
        spk = seg.get("speaker") or ""
        gender = ""
        if speaker_genders and spk:
            gender = speaker_genders.get(spk, "")
        key = TranslationCache.make_key(
            text=text, src_lang=source_lang, tgt_lang=target_lang,
            engine=engine, register=register, speaker_gender=gender,
        )
        keys.append(key)
        cached = cache.get(key)
        if cached:
            results[i] = cached
        else:
            uncached_segs.append(seg)
            uncached_indices.append(i)

    # Pass 2: call LLM cho uncached
    if uncached_segs:
        logger.info(
            "Translation cache: %d/%d hit, calling LLM cho %d seg",
            len(segments) - len(uncached_segs), len(segments), len(uncached_segs),
        )
        try:
            new_results = fallback_translate_fn(uncached_segs)
        except Exception as e:
            logger.error("Cached translate fallback failed: %s", e)
            return results  # Return partial (chỉ cache hits)

        # Merge new results vào positions
        for new_idx, orig_i in enumerate(uncached_indices):
            if new_idx < len(new_results) and new_results[new_idx].get("translated_text"):
                results[orig_i] = new_results[new_idx]
                # Cache the result
                # Need to recompute key with the right index — keys[orig_i_idx_in_keys]
                # Map: orig_i in segments → which slot in keys[]?
                # keys[] only has entries for non-empty texts in order, same as segments order
                # Easier: recompute key with same formula
                seg = segments[orig_i]
                text = (seg.get("original_text") or "").strip()
                spk = seg.get("speaker") or ""
                gender = ""
                if speaker_genders and spk:
                    gender = speaker_genders.get(spk, "")
                key = TranslationCache.make_key(
                    text=text, src_lang=source_lang, tgt_lang=target_lang,
                    engine=engine, register=register, speaker_gender=gender,
                )
                cache.set(key, results[orig_i])
    else:
        logger.info(
            "Translation cache: 100%% hit (%d segments) — no LLM call needed!",
            len(segments),
        )

    return results
