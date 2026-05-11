"""LLM dịch phim — kiến trúc 3-pass (analyze → translate → edit).

Public API:
  - detect_genre / get_genre_prompt_block: register detection
  - cached_translate_segments: cache layer cho translate
  - run_analyze / run_translate / run_edit: 3-pass dispatchers
"""
from .genre_detector import (
    detect_genre,
    get_genre_prompt_block,
    get_genre_display_name,
)
from .cache import (
    get_translation_cache,
    cached_translate_segments,
    TranslationCache,
)
from .llm_runner import (
    run_analyze,
    run_translate,
    run_edit,
    run_visual_analyze,
    VISION_MODELS,
)

# Backward-compat alias — code cũ vẫn gọi analyze_speakers
analyze_speakers = run_analyze

__all__ = [
    "detect_genre",
    "get_genre_prompt_block",
    "get_genre_display_name",
    "get_translation_cache",
    "cached_translate_segments",
    "TranslationCache",
    "run_analyze",
    "run_translate",
    "run_edit",
    "run_visual_analyze",
    "VISION_MODELS",
    "analyze_speakers",  # alias
]
