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
    speaker_ids: list[str] = None,
    speaker_genders: dict = None,
) -> list[dict]:
    """Build a prompt for Qwen: rewrite translated text for natural spoken dubbing.

    Args:
      translated_lines: per-line Google Translate output
      target_lang: e.g. "vietnamese"
      durations: per-line seconds (for length control)
      speaker_ids: per-line speaker tag (e.g. "SPK1", "SPK2") from diarization
      speaker_genders: {speaker_id: "male"|"female"} for pronoun choice
    """
    tgt_name = LANG_NAMES.get(target_lang, target_lang)

    # Build each line with metadata prefix: [speaker, gender, X.Ys, ~N chars]
    enriched_lines = []
    for i, t in enumerate(translated_lines):
        meta = []
        if speaker_ids and i < len(speaker_ids) and speaker_ids[i]:
            spk = speaker_ids[i]
            g = (speaker_genders or {}).get(spk, "unknown")
            meta.append(f"{spk}:{g}")
        if durations and i < len(durations):
            # VN speech rate ~14 chars/sec (syllable-based, more accurate than word count)
            dur = durations[i]
            char_budget = max(6, int(dur * 14))
            meta.append(f"{dur:.1f}s, ~{char_budget} chars")
        prefix = f"[{'; '.join(meta)}] " if meta else ""
        enriched_lines.append(f"{i+1}. {prefix}{t}")
    numbered = "\n".join(enriched_lines)

    # Speaker consistency rule (only when speakers provided)
    if speaker_ids and any(speaker_ids):
        speaker_rule = (
            "- The [SPKx:gender] prefix tells you which character speaks. Use consistent\n"
            "  pronouns per speaker across the scene. Do NOT include the prefix in output.\n"
            "- For female speakers use chị/em/cô. For male speakers use anh/ông/chú.\n"
            "  For unknown genders, use neutral forms based on context.\n"
        )
    else:
        speaker_rule = ""

    # Duration rule
    if durations:
        duration_rule = (
            "- The [X.Ys, ~N chars] metadata is a HINT FOR YOU ONLY — it tells you how\n"
            "  many characters fit in that time slot (Vietnamese ~14 chars/sec spoken).\n"
            "- CRITICAL: output must NEVER contain numbers followed by 's', 'giây',\n"
            "  'seconds', 'chars', 'từ', 'words', 'speaker', 'spk', or brackets with\n"
            "  timing/count/speaker info. The TTS literally reads those numbers aloud.\n"
            "- Keep output length VERY CLOSE to the char budget — if you exceed by >20%%\n"
            "  the TTS gets speed-stretched and sounds choppy. Prefer shorter natural\n"
            "  paraphrases over literal translations.\n"
        )
    else:
        duration_rule = ""

    system = f"""You are a professional {tgt_name} voice dubbing scriptwriter for film/drama.
Input: machine-translated {tgt_name} lines from a film scene.
Your job: rewrite each line as natural, spoken {tgt_name} dubbing dialogue.

OUTPUT FORMAT (strict): one line per input — "N. [emotion] rewritten text"
Emotions only: [neutral] [happy] [sad] [angry] [whisper] [surprised] [fearful]

CORE RULES:
- Output must sound like REAL spoken dialogue, NOT subtitle text.
- Keep the SAME meaning as input. Keep the SAME number of lines (no merge/split).

NAMES & PROPER NOUNS:
- ALWAYS transliterate character/place names into Vietnamese phonetics (phiên âm):
    Chinese: 苏萱→Tô Huyên, 李明→Lý Minh, 张伟→Trương Vỹ, 王小姐→cô Vương
    Korean: 이민호→Lee Min-ho (giữ nguyên romanization), 김수현→Kim Soo-hyun
    Japanese: 山田→Yamada (giữ romaji), 佐藤→Satō
    Western: Michael→Mai-cồ / Michael (giữ nếu phổ biến), James→Giêm / James
- Be CONSISTENT: same character = same translated name across all lines in a batch.
- Titles: 先生→ông/anh (tùy tuổi), 小姐→cô, 太太→bà.

PRONOUNS & STYLE:
- Use natural {tgt_name} pronouns based on relationship: anh/em (romantic, same age),
  anh/chị (formal), ông/bà (elder), chú/cô (older-younger), tao/mày (close/rough),
  con/bố/mẹ (family). Infer from context.
- Add '...' for dramatic pauses or hesitation. Add ',' for breath pauses.
- Do NOT add foreign words, emojis, or explanations.
{speaker_rule}{duration_rule}"""

    user = f"Rewrite the following dialogue for voice dubbing:\n\n{numbered}"

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


_DURATION_HINT_PATTERNS = [
    # [SPK1:male; 5.2s, ~70 chars]  — full metadata block
    re.compile(r"\[\s*SPK\d+[^\]]*\]", re.IGNORECASE),
    # [5.2s, ~13 words]  /  [5.2s, ~70 chars]  /  [2.5s]
    re.compile(r"\[\s*\d+(?:\.\d+)?\s*s\s*(?:,\s*[~≈]?\s*\d+\s*(?:words?|chars?|từ))?\s*\]", re.IGNORECASE),
    # [~13 words]  /  [13 words]  /  [~70 chars]
    re.compile(r"\[\s*[~≈]?\s*\d+\s*(?:words?|chars?|từ)\s*\]", re.IGNORECASE),
    # 5.2 giây / 2.5 seconds / 2.5s — raw mentions
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:giây|seconds?|secs?)\b", re.IGNORECASE),
    # ~13 words / 13 từ / 70 chars / 70 ký tự
    re.compile(r"\b[~≈]?\s*\d+\s*(?:từ|words?|chars?|ký tự)\b", re.IGNORECASE),
    # speaker SPK1 / spk2
    re.compile(r"\b(?:speaker\s+)?SPK\d+\b[:\-]?\s*(?:male|female|nam|nữ)?", re.IGNORECASE),
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


def _build_translate_prompt(
    segments: list[dict],
    target_lang: str,
    source_lang: str = None,
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
) -> list[dict]:
    """Build prompt for Qwen to do FULL translation with emotion tags.

    Similar to gemini_translate_svc but optimized for smaller local LLM.
    """
    tgt_name = LANG_NAMES.get(target_lang, target_lang)
    src_name = LANG_NAMES.get(source_lang, source_lang) if source_lang else "auto-detect"

    numbered = "\n".join(
        f"{i+1}. {seg.get('original_text', seg.get('text', ''))}"
        for i, seg in enumerate(segments)
    )

    # Render topic hint + glossary từ glossary_svc — share format với engines khác
    from app.services import glossary_svc
    extras = []
    if topic_hint:
        s = glossary_svc.format_topic_hint_for_prompt(topic_hint)
        if s: extras.append(s)
    if glossary:
        s = glossary_svc.format_for_prompt(glossary)
        if s: extras.append(s)
    extra_block = ("\n\n" + "\n\n".join(extras)) if extras else ""

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
- Output ONLY in {tgt_name}{extra_block}"""

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
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
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

        messages = _build_translate_prompt(
            batch, target_language, source_language,
            topic_hint=topic_hint, glossary=glossary,
        )

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
    speaker_ids: list[str] = None,
    speaker_genders: dict = None,
) -> list[dict]:
    """Rewrite translated text as natural spoken dubbing + emotion tags.

    Input:
      translated_texts: per-line Google Translate output
      target_language: e.g. "vietnamese"
      durations: optional per-segment seconds — drives char budget for Qwen
      speaker_ids: optional per-segment speaker tag ("SPK1", "SPK2") from diarization
      speaker_genders: optional {speaker_id: "male"|"female"} for pronoun choice

    Output: list of {"speech_text": ..., "emotion": ...}
    """
    if not translated_texts:
        return []

    all_results = [{"speech_text": t, "emotion": "neutral"} for t in translated_texts]

    for batch_start in range(0, len(translated_texts), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(translated_texts))
        batch_texts = translated_texts[batch_start:batch_end]
        batch_durs = durations[batch_start:batch_end] if durations else None
        batch_spks = speaker_ids[batch_start:batch_end] if speaker_ids else None

        if not any(t.strip() for t in batch_texts):
            continue

        messages = _build_polish_prompt(
            batch_texts, target_language,
            durations=batch_durs,
            speaker_ids=batch_spks,
            speaker_genders=speaker_genders,
        )

        try:
            response = gpu.llm_generate(messages, max_new_tokens=1536, temperature=0.3)
            parsed = _parse_response(response, len(batch_texts))

            for i, result in enumerate(parsed):
                if result["speech_text"]:
                    all_results[batch_start + i] = result

            logger.info("Qwen polished batch %d-%d (durations=%s, speakers=%s)",
                        batch_start + 1, batch_end, bool(batch_durs), bool(batch_spks))

        except Exception as e:
            logger.error("Qwen polish failed for batch %d-%d: %s", batch_start + 1, batch_end, e)

    return all_results
