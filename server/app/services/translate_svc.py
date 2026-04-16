"""Translation service using Google Translate (free, no API key)."""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from deep_translator import GoogleTranslator

logger = logging.getLogger(__name__)

# Map our language names to Google Translate codes
LANG_MAP = {
    "vietnamese": "vi",
    "english": "en",
    "chinese": "zh-CN",
    "japanese": "ja",
    "korean": "ko",
    "french": "fr",
    "spanish": "es",
    "german": "de",
    "portuguese": "pt",
    "russian": "ru",
    "thai": "th",
    "hindi": "hi",
}


def translate_text(text: str, target_language: str, source_language: str = "auto") -> str:
    """Translate a single text string."""
    if not text.strip():
        return ""

    target_code = LANG_MAP.get(target_language, target_language)
    source_code = LANG_MAP.get(source_language, source_language) if source_language != "auto" else "auto"

    try:
        result = GoogleTranslator(source=source_code, target=target_code).translate(text)
        return result or ""
    except Exception as e:
        logger.error("Translation failed: %s", e)
        raise ValueError(f"Translation failed: {e}")


def _translate_one(text: str, source_code: str, target_code: str) -> str:
    """Translate a single text — used as a thread target."""
    if not text.strip():
        return ""
    try:
        result = GoogleTranslator(source=source_code, target=target_code).translate(text)
        return result or ""
    except Exception as e:
        logger.error("Translation failed for '%s': %s", text[:50], e)
        return ""


def translate_batch(texts: list[str], target_language: str, source_language: str = "auto") -> list[str]:
    """Translate a list of texts in parallel using thread pool."""
    target_code = LANG_MAP.get(target_language, target_language)
    source_code = LANG_MAP.get(source_language, source_language) if source_language != "auto" else "auto"

    results = [""] * len(texts)

    # Use up to 10 threads for parallel translation
    with ThreadPoolExecutor(max_workers=min(10, len(texts) or 1)) as executor:
        future_to_idx = {
            executor.submit(_translate_one, text, source_code, target_code): i
            for i, text in enumerate(texts)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                logger.error("Translation thread error: %s", e)
                results[idx] = ""

    return results
