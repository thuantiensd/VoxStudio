"""LLM provider utilities + genre/register detection.

Các module này cải thiện chất lượng dịch cho từng provider khác nhau
(Gemini/OpenAI/Claude) + auto-detect register cho phim cổ trang vs hiện đại.

Public API:
  - detect_genre(text): auto-detect genre từ original_text (zh/ja/ko)
  - get_genre_prompt_block(genre): prompt block tuỳ chỉnh per genre
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
from .speaker_analyzer import analyze_speakers

__all__ = [
    "detect_genre",
    "get_genre_prompt_block",
    "get_genre_display_name",
    "get_translation_cache",
    "cached_translate_segments",
    "TranslationCache",
    "analyze_speakers",
]
