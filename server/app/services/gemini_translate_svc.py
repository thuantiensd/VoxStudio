"""Context-aware film translation using Google Gemini API.

Translates film dialogue with proper pronouns, honorifics, and character awareness.
Free tier: 15 requests/min, 1M tokens/day.
"""

import json
import logging
import re

import google.generativeai as genai

from app.config import GEMINI_API_KEY

logger = logging.getLogger(__name__)

BATCH_SIZE = 20  # segments per batch for context window

VALID_EMOTIONS = {"neutral", "happy", "sad", "angry", "fearful", "surprised", "disgusted", "whisper"}


def is_available() -> bool:
    return bool(GEMINI_API_KEY)


def _configure():
    genai.configure(api_key=GEMINI_API_KEY)


def translate_segments(
    segments: list[dict],
    target_language: str,
    source_language: str = "auto",
) -> list[dict]:
    """Translate film dialogue segments with full context awareness.

    Args:
        segments: list of {"index", "start", "end", "original_text"}
        target_language: e.g. "vietnamese"
        source_language: e.g. "chinese", "auto"

    Returns:
        list of {"translated_text", "speech_text", "emotion"}
    """
    if not GEMINI_API_KEY:
        raise ValueError("Gemini API key not configured. Set GEMINI_API_KEY in Settings.")

    _configure()
    model = genai.GenerativeModel("gemini-2.0-flash")

    results = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
               for _ in segments]

    # Process in batches with overlap for context
    for batch_start in range(0, len(segments), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(segments))
        batch = segments[batch_start:batch_end]

        # Include context from previous batch (last 3 segments)
        context_before = []
        if batch_start > 0:
            ctx_start = max(0, batch_start - 3)
            for seg in segments[ctx_start:batch_start]:
                prev_result = results[seg["index"]]
                if prev_result["translated_text"]:
                    context_before.append({
                        "index": seg["index"] + 1,
                        "original": seg["original_text"],
                        "translated": prev_result["translated_text"],
                    })

        prompt = _build_prompt(batch, target_language, source_language, context_before)

        try:
            response = model.generate_content(prompt)
            parsed = _parse_response(response.text, len(batch))

            for i, result in enumerate(parsed):
                if result["translated_text"]:
                    results[batch_start + i] = result

            logger.info("Gemini translated batch %d-%d (%d segments)",
                        batch_start + 1, batch_end, len(batch))

        except Exception as e:
            logger.error("Gemini translation failed for batch %d-%d: %s",
                         batch_start + 1, batch_end, e)
            # Don't raise — partial results are OK, caller can fallback

    return results


def _build_prompt(
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    context_before: list[dict],
) -> str:
    """Build a detailed prompt for context-aware film translation."""

    lang_names = {
        "vietnamese": "Tiếng Việt", "english": "English", "chinese": "Tiếng Trung",
        "japanese": "Tiếng Nhật", "korean": "Tiếng Hàn", "french": "Tiếng Pháp",
        "spanish": "Tiếng Tây Ban Nha", "german": "Tiếng Đức",
    }
    tgt_name = lang_names.get(target_lang, target_lang)
    src_name = lang_names.get(source_lang, source_lang) if source_lang != "auto" else "auto-detect"

    # Build segment list
    seg_lines = []
    for seg in segments:
        text = seg["original_text"].strip()
        if text:
            seg_lines.append(f'{seg["index"] + 1}. [{seg["start"]:.1f}s-{seg["end"]:.1f}s] {text}')

    # Build context section
    context_section = ""
    if context_before:
        ctx_lines = [f'  {c["index"]}. {c["original"]} → {c["translated"]}' for c in context_before]
        context_section = f"\n\nPrevious dialogue (for context, do NOT translate these):\n" + "\n".join(ctx_lines)

    prompt = f"""You are a professional film/drama translator and subtitle localizer.

TASK: Translate the following film dialogue from {src_name} to {tgt_name}.

CRITICAL RULES for {tgt_name} translation:
1. **Pronouns & Honorifics**: Use correct Vietnamese pronouns based on speaker relationships:
   - Young man to older man: "anh" (speaker) / "em" (self)
   - Young woman to older woman: "chị" (speaker) / "em" (self)
   - Between lovers/couples: "anh/em" (male/female)
   - Child to parent: "ba/mẹ/bố/mẹ" + "con" (self)
   - To elders: "bác/chú/cô/dì" + "cháu" (self)
   - Between friends same age: "tao/mày" (casual) or "tôi/bạn" (formal)
   - Boss/subordinate: "sếp/giám đốc" + "tôi/em"

2. **Character Consistency**: The SAME character should use the SAME pronouns throughout.
   Identify speakers by context (timestamps, dialogue flow, who responds to whom).

3. **Natural Vietnamese**: Write how Vietnamese people actually speak in films/dramas.
   - Use natural contractions and colloquial speech
   - Avoid literal/stiff translation
   - Match the emotional tone of the original

4. **Emotion Detection**: Detect the emotion in each line from context.
   Valid emotions: neutral, happy, sad, angry, whisper, surprised, fearful

5. **Film Context**: These are consecutive dialogue lines from a film scene.
   Use the flow of conversation to understand relationships and context.
{context_section}

DIALOGUE TO TRANSLATE:
{chr(10).join(seg_lines)}

RESPOND in this exact JSON format (no markdown, no code blocks):
[
  {{"index": 1, "translated": "...", "speech": "...", "emotion": "neutral"}},
  {{"index": 2, "translated": "...", "speech": "...", "emotion": "happy"}}
]

Where:
- "index": the line number
- "translated": accurate translation with proper pronouns
- "speech": same text optimized for TTS (add ... for pauses, natural speech flow)
- "emotion": detected emotion tag
"""
    return prompt


def _parse_response(response: str, count: int) -> list[dict]:
    """Parse JSON response from Gemini."""
    results = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
               for _ in range(count)]

    # Clean response — remove markdown code blocks if present
    text = response.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    text = text.strip()

    try:
        parsed = json.loads(text)
        if not isinstance(parsed, list):
            logger.warning("Gemini response is not a list")
            return results

        for item in parsed:
            idx = item.get("index", 0) - 1
            if 0 <= idx < count:
                translated = item.get("translated", "").strip()
                speech = item.get("speech", translated).strip()
                emotion = item.get("emotion", "neutral").lower()
                if emotion not in VALID_EMOTIONS:
                    emotion = "neutral"
                results[idx] = {
                    "translated_text": translated,
                    "speech_text": speech or translated,
                    "emotion": emotion,
                }
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Gemini JSON: %s\nResponse: %s", e, text[:500])
        # Try line-by-line fallback
        _parse_fallback(text, results, count)

    return results


def _parse_fallback(text: str, results: list, count: int):
    """Fallback parser for non-JSON responses."""
    for line in text.split("\n"):
        line = line.strip()
        m = re.match(r'^(\d+)[.):\s]+(.+)$', line)
        if m:
            idx = int(m.group(1)) - 1
            translated = m.group(2).strip()
            if 0 <= idx < count and translated:
                results[idx] = {
                    "translated_text": translated,
                    "speech_text": translated,
                    "emotion": "neutral",
                }
