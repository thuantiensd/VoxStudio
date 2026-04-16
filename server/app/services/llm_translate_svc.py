"""Speech rewriting + emotion detection using local LLM (Qwen).

Hybrid pipeline: Google Translate (accuracy) → Qwen (emotion + pauses + speech polish)
"""

import logging
import re

from app.core.gpu_manager import gpu

logger = logging.getLogger(__name__)

LANG_NAMES = {
    "vietnamese": "Tiếng Việt",
    "english": "English",
    "chinese": "Tiếng Trung",
    "japanese": "Tiếng Nhật",
    "korean": "Tiếng Hàn",
    "french": "Tiếng Pháp",
    "spanish": "Tiếng Tây Ban Nha",
    "german": "Tiếng Đức",
    "portuguese": "Tiếng Bồ Đào Nha",
    "russian": "Tiếng Nga",
    "thai": "Tiếng Thái",
    "hindi": "Tiếng Hindi",
}

VALID_EMOTIONS = {"neutral", "happy", "sad", "angry", "fearful", "surprised", "disgusted", "whisper"}

BATCH_SIZE = 10


def _build_polish_prompt(translated_lines: list[str], target_lang: str) -> list[dict]:
    """Build a simple prompt for Qwen: just add emotion + pauses to already-translated text.

    This is a MUCH easier task for a 3B model than full translation.
    """
    tgt_name = LANG_NAMES.get(target_lang, target_lang)
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(translated_lines))

    system = f"""You are a professional Vietnamese voice dubbing scriptwriter.
Input: machine-translated {tgt_name} subtitles from a film/drama.
Your job: rewrite each line so it sounds like REAL spoken {tgt_name} dialogue — natural, emotional, fits the context of a film scene.

Format per line: N. [emotion] rewritten text
Emotions: [neutral] [happy] [sad] [angry] [whisper] [surprised] [fearful]

Rules:
- Rewrite to sound like natural spoken dialogue, NOT subtitle text
- Fix awkward machine translation — make it sound like a real person talking
- Use natural Vietnamese pronouns (anh/em, chị, tao/mày, ông/bà) based on context
- Add '...' for dramatic pauses, hesitation, trailing off
- Add ',' for breath pauses
- Keep the SAME meaning but change wording to sound natural
- Consider the flow between lines — they are consecutive dialogue
- Do NOT add foreign words
- Same number of lines as input"""

    user = f"Rewrite for voice acting:\n\n{numbered}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _parse_response(response: str, count: int) -> list[dict]:
    """Parse numbered lines with emotion tags from LLM response."""
    lines = response.strip().split("\n")
    results = [{"speech_text": "", "emotion": "neutral"} for _ in range(count)]

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Match "1. [emotion] text"
        m = re.match(r"^(\d+)[.):\s]+\[(\w+)\]\s*(.+)$", line)
        if m:
            idx = int(m.group(1)) - 1
            emotion = m.group(2).lower()
            text = m.group(3).strip()
            if 0 <= idx < count:
                if emotion not in VALID_EMOTIONS:
                    emotion = "neutral"
                results[idx] = {"speech_text": text, "emotion": emotion}
        else:
            # Fallback: no emotion tag
            m2 = re.match(r"^(\d+)[.):\s]+(.+)$", line)
            if m2:
                idx = int(m2.group(1)) - 1
                text = m2.group(2).strip()
                if 0 <= idx < count:
                    results[idx] = {"speech_text": text, "emotion": "neutral"}

    return results


def _build_translate_prompt(segments: list[dict], target_lang: str, source_lang: str = None) -> list[dict]:
    """Build prompt for Qwen to do FULL translation with emotion tags.

    Similar to gemini_translate_svc but optimized for smaller local LLM.
    """
    tgt_name = LANG_NAMES.get(target_lang, target_lang)
    src_name = LANG_NAMES.get(source_lang, source_lang) if source_lang else "auto-detect"

    numbered = "\n".join(
        f"{i+1}. {seg.get('original_text', seg.get('text', ''))}"
        for i, seg in enumerate(segments)
    )

    system = f"""You are a professional film dialogue translator.
Translate from {src_name} to {tgt_name}.

Output format — one line per input:
N. [emotion] translated text

Emotions: [neutral] [happy] [sad] [angry] [whisper] [surprised] [fearful]

Rules:
- Translate naturally for spoken dialogue (not literal subtitles)
- Use appropriate pronouns for {tgt_name} (e.g. Vietnamese: anh/em, chị/em based on context)
- Add '...' for pauses, ',' for breath pauses
- Keep the meaning accurate
- Output MUST have exactly the same number of lines as input
- Output ONLY in {tgt_name}"""

    user = f"Translate this dialogue:\n\n{numbered}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _parse_translate_response(response: str, count: int) -> list[dict]:
    """Parse translation response. Same format as polish response."""
    results = _parse_response(response, count)
    # Map to same format as gemini_translate_svc output
    return [
        {
            "translated_text": r["speech_text"],
            "speech_text": r["speech_text"],
            "emotion": r["emotion"],
        }
        for r in results
    ]


def translate_segments(
    segments: list[dict],
    target_language: str,
    source_language: str = None,
) -> list[dict]:
    """Full translation using Qwen LLM — translates + adds emotion tags.

    Input: list of segment dicts with "original_text"
    Output: list of {"translated_text", "speech_text", "emotion"}

    Unlike polish_for_speech(), this does the ACTUAL translation.
    """
    if not segments:
        return []

    all_results = [
        {"translated_text": "", "speech_text": "", "emotion": "neutral"}
        for _ in segments
    ]

    for batch_start in range(0, len(segments), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(segments))
        batch = segments[batch_start:batch_end]

        if not any((s.get("original_text") or "").strip() for s in batch):
            continue

        messages = _build_translate_prompt(batch, target_language, source_language)

        try:
            response = gpu.llm_generate(messages, max_new_tokens=2048, temperature=0.3)
            parsed = _parse_translate_response(response, len(batch))

            for i, result in enumerate(parsed):
                if result["translated_text"]:
                    all_results[batch_start + i] = result

            logger.info("Qwen translated batch %d-%d (%s → %s)",
                        batch_start + 1, batch_end, source_language or "auto", target_language)

        except Exception as e:
            logger.error("Qwen translation failed for batch %d-%d: %s",
                         batch_start + 1, batch_end, e)

    return all_results


def polish_for_speech(
    translated_texts: list[str],
    target_language: str,
) -> list[dict]:
    """Add emotion tags + natural pauses to already-translated text.

    Input: list of translated subtitle strings (from Google Translate)
    Output: list of {"speech_text": ..., "emotion": ...}

    This is the ONLY job for Qwen — no translation needed.
    """
    if not translated_texts:
        return []

    all_results = [{"speech_text": t, "emotion": "neutral"} for t in translated_texts]

    for batch_start in range(0, len(translated_texts), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(translated_texts))
        batch_texts = translated_texts[batch_start:batch_end]

        if not any(t.strip() for t in batch_texts):
            continue

        messages = _build_polish_prompt(batch_texts, target_language)

        try:
            response = gpu.llm_generate(messages, max_new_tokens=1024, temperature=0.3)
            parsed = _parse_response(response, len(batch_texts))

            for i, result in enumerate(parsed):
                if result["speech_text"]:
                    all_results[batch_start + i] = result

            logger.info("Qwen polished batch %d-%d", batch_start + 1, batch_end)

        except Exception as e:
            logger.error("Qwen polish failed for batch %d-%d: %s", batch_start + 1, batch_end, e)
            # Fallback: keep Google Translate text with neutral emotion

    return all_results
