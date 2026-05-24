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
    voice_gender_hint: str | None = None,
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
                voice_gender_hint=voice_gender_hint,
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
            voice_gender_hint=voice_gender_hint,
        )


def _translate_uncached(
    segments: list[dict],
    target_language: str,
    source_language: str,
    topic_hint: str | None,
    glossary: list[tuple[str, str]] | None,
    film_genre: str | None,
    visual_context: dict | None = None,
    voice_gender_hint: str | None = None,
) -> list[dict]:
    """Internal — gọi 3-pass thực sự (sau cache miss)."""
    from app.services.llm import run_analyze, run_translate, run_edit
    from app.services.llm.prompts import _max_chars
    from app.services import glossary_svc

    glossary_block = glossary_svc.format_for_prompt(glossary) if glossary else None
    topic_block = glossary_svc.format_topic_hint_for_prompt(topic_hint) if topic_hint else None

    # ── Inject voice gender hint vào visual_context để Pass-0 dùng ──
    # Khi voice_count=1 + voice nữ/nam → đây là tín hiệu giới tính mạnh
    # mà Pass-0 nên dùng khi text không rõ gender.
    effective_visual = visual_context
    if voice_gender_hint and not visual_context:
        gender_vn = "nữ" if voice_gender_hint == "female" else "nam"
        effective_visual = {
            "voice_gender_hint": voice_gender_hint,
            "scene_summary": f"User chọn giọng {gender_vn} cho tất cả nhân vật → "
                             f"ưu tiên suy luận nhân vật là {gender_vn} khi text không rõ giới tính.",
        }
        logger.info("Injected voice_gender_hint=%s into visual context", voice_gender_hint)

    # ── Pass-0: analyze speaker relationships (1 call cho cả phim) ──
    relationships: dict = {}
    try:
        relationships = run_analyze(
            engine=ENGINE,
            segments=segments,
            source_lang=source_language,
            film_genre=film_genre,
            visual_context=effective_visual,
        )
        # Backward-compat: store FULL info (character_name, age, role) cho
        # dubbing_svc đọc lại — TTS routing + UI hiển thị nhân vật.
        if relationships:
            try:
                from app.services.cloud_translate_svc import (
                    _store_llm_genders, store_relationships,
                )
                store_relationships(ENGINE, relationships)
                if relationships.get("speakers"):
                    full_info = {
                        spk_id: {
                            "gender": info.get("gender", "unsure"),
                            "evidence": info.get("evidence", ""),
                            "character_name": info.get("character_name", ""),
                            "age": info.get("age", "adult"),
                            "role": info.get("role", ""),
                        }
                        for spk_id, info in relationships["speakers"].items()
                    }
                    _store_llm_genders(ENGINE, full_info)
            except Exception:
                pass
    except Exception as e:
        logger.warning("Gemini Pass-0 fail: %s — Pass-1/2 chạy không anchor", e)

    # ── Voice gender hint fallback: inject vào relationships nếu Pass-0 thiếu ──
    if voice_gender_hint and (not relationships or not relationships.get("speakers")):
        gender_vn = "nữ" if voice_gender_hint == "female" else "nam"
        relationships = relationships or {}
        relationships["voice_gender_hint"] = voice_gender_hint
        relationships.setdefault("scene_context",
            f"User chọn giọng {gender_vn} → nhân vật chính có thể là {gender_vn}.")
        logger.info("Pass-0 empty/fail → injected voice_gender_hint=%s into relationships",
                     voice_gender_hint)
    elif voice_gender_hint and relationships.get("speakers"):
        relationships["voice_gender_hint"] = voice_gender_hint

    # ── Pass-1 + Pass-2: ADAPTIVE BATCH + PARALLEL DISPATCH ──
    # Với phim dài, sequential batch quá lâu. Parallel 3-6 batch song song
    # (concurrent limit theo engine tier) → 3-4× nhanh hơn.
    from app.services.llm.batch import adaptive_batch_size, run_parallel_batches
    batch_size = adaptive_batch_size(len(segments))
    logger.info("Gemini: %d segments → adaptive batch_size=%d",
                 len(segments), batch_size)

    def _process_batch(batch_idx: int, batch: list[dict]) -> list[dict]:
        """Pass-1 + Pass-2 cho 1 batch. Return list[dict] cùng length batch.
        Mỗi item: {translated_text, speech_text, emotion}.
        """
        # Pass-1: literal translator
        literal = run_translate(
            engine=ENGINE, segments=batch,
            target_lang=target_language, source_lang=source_language,
            speaker_relationships=relationships,
            topic_hint=topic_block, glossary_block=glossary_block,
            film_genre=film_genre,
        )
        # Pass-2: editor polish
        polished = list(literal)
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
                engine=ENGINE, items=items,
                target_lang=target_language, source_lang=source_language,
                speaker_relationships=relationships,
                film_genre=film_genre,
            )
            for i, p in enumerate(polished_raw):
                if p.get("translated_text"):
                    polished[i] = p
        except Exception as e:
            logger.warning("Gemini Pass-2 fail batch %d: %s — dùng literal", batch_idx, e)
        # Trả format đúng cho merge: {translated_text, speech_text, emotion}
        return [
            {
                "translated_text": p.get("translated_text", ""),
                "speech_text": p.get("translated_text", ""),
                "emotion": p.get("emotion", "neutral"),
            }
            for p in polished
        ]

    parallel_results = run_parallel_batches(
        items=segments, batch_size=batch_size, engine=ENGINE,
        process_fn=_process_batch,
    )

    # Replace empty default với parallel result (None khi batch fail)
    results = []
    for i, p in enumerate(parallel_results):
        if p and p.get("translated_text"):
            results.append(p)
        else:
            results.append({"translated_text": "", "speech_text": "", "emotion": "neutral"})

    missing = sum(1 for r in results if not r["translated_text"])
    if missing:
        logger.warning("Gemini: %d/%d segments missing translation", missing, len(results))

    return results
