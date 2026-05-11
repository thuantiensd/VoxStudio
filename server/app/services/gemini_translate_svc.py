"""Gemini translation service — 3-pass (analyze → translate → edit).

Public API:
  - is_available(): bool
  - translate_segments(segments, target_language, source_language, ...) → list[dict]

3-pass flow:
  Pass-0: analyze speaker relationships (skip nếu 1 speaker).
  Pass-1: translate literal nhưng pronoun đúng.
  Pass-2: edit polish thành film style.
"""
from __future__ import annotations

import logging

from app.config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

BATCH_SIZE = 20  # segments per batch
ENGINE = "gemini"


def is_available() -> bool:
    return bool(GEMINI_API_KEY)


def translate_segments(
    segments: list[dict],
    target_language: str,
    source_language: str = "auto",
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
    visual_context: dict | None = None,
) -> list[dict]:
    """Translate film dialogue segments — 3-pass cinematic.

    Returns list[{translated_text, speech_text, emotion}] song song segments.
    """
    if not GEMINI_API_KEY:
        raise ValueError("Gemini API key not configured. Set GEMINI_API_KEY in Settings.")

    # ── Cache lookup TRƯỚC khi call LLM ──
    try:
        from app.services.llm import cached_translate_segments
        register = film_genre or "generic"

        def _llm_call(uncached: list[dict]) -> list[dict]:
            return _translate_uncached(
                uncached, target_language, source_language,
                topic_hint, glossary, film_genre, visual_context,
            )

        return cached_translate_segments(
            segments=segments,
            target_lang=target_language,
            source_lang=source_language,
            engine=ENGINE,
            register=register,
            fallback_translate_fn=_llm_call,
            speaker_genders=speaker_genders,
        )
    except ImportError:
        return _translate_uncached(
            segments, target_language, source_language,
            topic_hint, glossary, film_genre, visual_context,
        )


def _translate_uncached(
    segments: list[dict],
    target_language: str,
    source_language: str,
    topic_hint: str | None,
    glossary: list[tuple[str, str]] | None,
    film_genre: str | None,
    visual_context: dict | None = None,
) -> list[dict]:
    """Internal — gọi 3-pass thực sự (sau cache miss)."""
    from app.services.llm import run_analyze, run_translate, run_edit
    from app.services.llm.prompts import _max_chars
    from app.services import glossary_svc

    glossary_block = glossary_svc.format_for_prompt(glossary) if glossary else None
    topic_block = glossary_svc.format_topic_hint_for_prompt(topic_hint) if topic_hint else None

    # ── Pass-0: analyze speaker relationships (1 call cho cả phim) ──
    relationships: dict = {}
    try:
        relationships = run_analyze(
            engine=ENGINE,
            segments=segments,
            source_lang=source_language,
            film_genre=film_genre,
            visual_context=visual_context,
        )
        # Backward-compat: lưu gender vào cache cho dubbing_svc đọc lại
        if relationships and relationships.get("speakers"):
            try:
                from app.services.cloud_translate_svc import _store_llm_genders
                genders = {
                    spk_id: {"gender": info.get("gender", "unsure"),
                              "evidence": info.get("evidence", "")}
                    for spk_id, info in relationships["speakers"].items()
                }
                _store_llm_genders(ENGINE, genders)
            except Exception:
                pass
    except Exception as e:
        logger.warning("Gemini Pass-0 fail: %s — Pass-1/2 chạy không anchor", e)

    # ── Pass-1 + Pass-2: per batch ──
    results = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
               for _ in segments]

    for batch_start in range(0, len(segments), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(segments))
        batch = segments[batch_start:batch_end]

        # Context cho continuity (3 line gần nhất đã dịch)
        context_before = []
        if batch_start > 0:
            ctx_start = max(0, batch_start - 3)
            for seg in segments[ctx_start:batch_start]:
                prev = results[seg["index"]]
                if prev["translated_text"]:
                    context_before.append({
                        "index": seg["index"] + 1,
                        "original": seg["original_text"],
                        "translated": prev["translated_text"],
                    })

        # Pass-1: literal translator
        try:
            literal = run_translate(
                engine=ENGINE,
                segments=batch,
                target_lang=target_language,
                source_lang=source_language,
                speaker_relationships=relationships,
                context_before=context_before,
                topic_hint=topic_block,
                glossary_block=glossary_block,
                film_genre=film_genre,
            )
        except Exception as e:
            logger.error("Gemini Pass-1 fail batch %d-%d: %s",
                          batch_start + 1, batch_end, e)
            raise ValueError(f"Gemini lỗi: {e}") from e

        # Pass-2: editor polish
        polished = literal  # fallback nếu Pass-2 fail
        try:
            items = []
            for i, seg in enumerate(batch):
                lit_text = literal[i].get("translated_text", "") if i < len(literal) else ""
                items.append({
                    "index": seg["index"],
                    "speaker": seg.get("speaker"),
                    "original": seg["original_text"],
                    "literal": lit_text,
                    "max_chars": _max_chars(seg),
                })
            polished_raw = run_edit(
                engine=ENGINE,
                items=items,
                target_lang=target_language,
                source_lang=source_language,
                speaker_relationships=relationships,
            )
            # Merge: polished thay literal khi có
            for i, p in enumerate(polished_raw):
                if p.get("translated_text"):
                    polished[i] = p
        except Exception as e:
            logger.warning("Gemini Pass-2 (editor) fail batch %d-%d: %s — dùng literal",
                            batch_start + 1, batch_end, e)

        # Merge vào results với speech_text (default = translated)
        for i, p in enumerate(polished):
            tr = p.get("translated_text", "")
            if tr:
                results[batch_start + i] = {
                    "translated_text": tr,
                    "speech_text": tr,
                    "emotion": p.get("emotion", "neutral"),
                }

        logger.info("Gemini batch %d-%d (%d segs) ok", batch_start + 1, batch_end, len(batch))

    missing = sum(1 for r in results if not r["translated_text"])
    if missing:
        logger.warning("Gemini: %d/%d segments missing translation", missing, len(results))

    return results
