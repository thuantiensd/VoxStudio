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


def _build_polish_prompt(
    translated_lines: list[str],
    target_lang: str,
    durations: list[float] = None,
) -> list[dict]:
    """Build a prompt for Qwen: rewrite translated text for natural spoken dubbing.

    If durations provided, include per-line word budget so Qwen controls output length
    to match original audio timing (avoids over-long TTS that gets stretched awkwardly).
    """
    tgt_name = LANG_NAMES.get(target_lang, target_lang)

    if durations and len(durations) == len(translated_lines):
        # Vietnamese speech rate ~2.5 words/sec — give Qwen a soft word budget per line
        numbered = "\n".join(
            f"{i+1}. [{durations[i]:.1f}s, ~{max(2, int(durations[i] * 2.5))} words] {t}"
            for i, t in enumerate(translated_lines)
        )
        duration_rule = (
            "- Each input line starts with a metadata tag [X.Ys, ~N words] which is\n"
            "  a HINT FOR YOU ONLY — it tells you how many words fit in that time slot.\n"
            "- CRITICAL: your output must NEVER contain numbers followed by 's', 'giây',\n"
            "  'seconds', 'words', 'từ', or brackets with timing/word-count info.\n"
            "  The TTS will literally read those numbers aloud. Strip them completely.\n"
            "- Keep output length CLOSE to the ~N words budget so timing lines up."
        )
    else:
        numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(translated_lines))
        duration_rule = ""

    system = f"""You are a professional {tgt_name} voice dubbing scriptwriter.
Input: machine-translated {tgt_name} subtitles from a film/drama.
Your job: rewrite each line so it sounds like REAL spoken {tgt_name} dialogue — natural, emotional, fits a film scene.

Format per line: N. [emotion] rewritten text
Emotions: [neutral] [happy] [sad] [angry] [whisper] [surprised] [fearful]

Rules:
- Rewrite to sound like natural spoken dialogue, NOT subtitle text
- Fix awkward machine translation — make it sound like a real person talking
- Use natural {tgt_name} pronouns (Vietnamese: anh/em, chị, tao/mày, ông/bà based on context)
- Add '...' for dramatic pauses, hesitation, trailing off
- Add ',' for breath pauses
- Keep the SAME meaning but change wording to sound natural
- Consider the flow between lines — they are consecutive dialogue
- Do NOT add foreign words
- Keep the SAME number of lines as input — do NOT merge or split
{duration_rule}"""

    user = f"Rewrite for voice acting:\n\n{numbered}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


_DURATION_HINT_PATTERNS = [
    # [5.2s, ~13 words]
    re.compile(r"\[\s*\d+(?:\.\d+)?\s*s\s*,\s*[~≈]?\s*\d+\s*words?\s*\]", re.IGNORECASE),
    # [5.2s]
    re.compile(r"\[\s*\d+(?:\.\d+)?\s*s\s*\]", re.IGNORECASE),
    # [~13 words]  /  [13 words]
    re.compile(r"\[\s*[~≈]?\s*\d+\s*words?\s*\]", re.IGNORECASE),
    # 5.2 giây  / 2.5s  / 13 từ / 13 words — nếu lọt vào text
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:giây|seconds?|secs?)\b", re.IGNORECASE),
    re.compile(r"\b[~≈]?\s*\d+\s*(?:từ|words?)\b", re.IGNORECASE),
]


def _strip_duration_hints(text: str) -> str:
    """Remove [X.Ys, ~N words] / [X.Ys] / [~N words] hints that Qwen sometimes leaks."""
    out = text
    for pat in _DURATION_HINT_PATTERNS:
        out = pat.sub("", out)
    # Collapse resulting double-spaces / leading commas
    out = re.sub(r"\s{2,}", " ", out).strip(" ,.")
    return out.strip()


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
                    # What we captured as "emotion" was actually a duration hint like
                    # "2.5s" or "6 words" — treat as neutral + merge back into text
                    emotion_raw = m.group(2)
                    emotion = "neutral"
                    text = f"[{emotion_raw}] {text}"
                text = _strip_duration_hints(text)
                results[idx] = {"speech_text": text, "emotion": emotion}
        else:
            # Fallback: no emotion tag
            m2 = re.match(r"^(\d+)[.):\s]+(.+)$", line)
            if m2:
                idx = int(m2.group(1)) - 1
                text = _strip_duration_hints(m2.group(2).strip())
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
    durations: list[float] = None,
) -> list[dict]:
    """Add emotion tags + natural pauses to already-translated text.

    Input:
      translated_texts: list of translated subtitle strings (from Google Translate)
      durations: optional per-segment duration in seconds — used to give Qwen
                 a word budget so output length matches original audio timing.

    Output: list of {"speech_text": ..., "emotion": ...}
    """
    if not translated_texts:
        return []

    all_results = [{"speech_text": t, "emotion": "neutral"} for t in translated_texts]

    for batch_start in range(0, len(translated_texts), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(translated_texts))
        batch_texts = translated_texts[batch_start:batch_end]
        batch_durs = durations[batch_start:batch_end] if durations else None

        if not any(t.strip() for t in batch_texts):
            continue

        messages = _build_polish_prompt(batch_texts, target_language, batch_durs)

        try:
            response = gpu.llm_generate(messages, max_new_tokens=1024, temperature=0.3)
            parsed = _parse_response(response, len(batch_texts))

            for i, result in enumerate(parsed):
                if result["speech_text"]:
                    all_results[batch_start + i] = result

            logger.info("Qwen polished batch %d-%d (with durations=%s)",
                        batch_start + 1, batch_end, bool(batch_durs))

        except Exception as e:
            logger.error("Qwen polish failed for batch %d-%d: %s", batch_start + 1, batch_end, e)
            # Fallback: keep Google Translate text with neutral emotion

    return all_results
