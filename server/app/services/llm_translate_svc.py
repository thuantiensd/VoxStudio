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


# ── Film genre prompts ──────────────────────────────────────
# Mỗi genre có guidance riêng cho LLM để dịch sát ngữ cảnh phim. User
# pick genre trong UI → inject prompt block tương ứng.
FILM_GENRE_PROMPTS: dict[str, str] = {
    "auto": "",  # no specific guidance — LLM tự suy
    "drama": (
        "FILM GENRE: Drama / melodrama (chính kịch).\n"
        "- Dialogue tự nhiên, đời thường, cảm xúc thật.\n"
        "- Đại từ đa dạng theo quan hệ: cặp đôi 'anh/em', gia đình "
        "'con/bố/mẹ/anh/chị/em', bạn bè 'tớ/cậu' hoặc 'tao/mày'.\n"
        "- Tránh từ ngữ archaic, tránh literal Chinese-style honorifics."
    ),
    "romance": (
        "FILM GENRE: Romance / phim tình cảm.\n"
        "- Tập trung diễn đạt CẢM XÚC giữa cặp đôi nhân vật.\n"
        "- Cặp yêu nhau LUÔN dùng 'anh' (nam) / 'em' (nữ) — không 'tôi/bạn'.\n"
        "- Lời tỏ tình, ghen tuông, thề nguyền dùng từ ngữ ngọt ngào, tự nhiên.\n"
        "- Cãi nhau giữa cặp đôi vẫn giữ 'anh/em' (không chuyển 'mày/tao')."
    ),
    "action": (
        "FILM GENRE: Action / phim hành động.\n"
        "- Câu ngắn, gọn, mệnh lệnh nhiều ('chạy đi!', 'tránh ra!').\n"
        "- Đối thủ dùng 'mày/tao' khi xung đột.\n"
        "- Đồng đội dùng 'anh em', 'huynh đệ', 'đồng chí' tùy bối cảnh.\n"
        "- Súng đạn / vũ khí giữ tên quốc tế ('AK', 'sniper') không Việt hoá."
    ),
    "comedy": (
        "FILM GENRE: Comedy / phim hài.\n"
        "- Đời thường, vui vẻ, slang Việt hoá thoải mái.\n"
        "- Bạn bè dùng 'tao/mày' hoặc 'tớ/cậu'.\n"
        "- Joke phải ADAPT văn hoá Việt — không dịch literal joke nước ngoài.\n"
        "- Có thể thêm từ lóng đời thường ('xời', 'trời ơi', 'thôi rồi')."
    ),
    "historical": (
        "FILM GENRE: Historical / cổ trang / phim cung đình.\n"
        "- Dùng tiếng Việt cổ phong, KHÔNG slang hiện đại.\n"
        "- Hoàng đế: 'trẫm' (tự xưng) / 'bệ hạ' (gọi). Cận thần: 'thần'.\n"
        "- Cặp đôi cổ trang: 'thiếp/chàng', 'phu quân/nương tử'.\n"
        "- Tôi tớ tự xưng 'nô tì/nô bộc'.\n"
        "- Quan lại: 'tiểu nhân/đại nhân', 'hạ thần'.\n"
        "- Tránh các từ hiện đại như 'OK', 'cool', 'sếp'."
    ),
    "crime": (
        "FILM GENRE: Crime / thriller / phim hình sự.\n"
        "- Lời thoại thẳng thừng, có thể thô.\n"
        "- Tội phạm / nạn nhân dùng 'mày/tao' tự do.\n"
        "- Cảnh sát formal: 'tôi' / 'anh-chị' với dân, 'mày' với tội phạm.\n"
        "- Profanity được phép khi phù hợp ('mẹ kiếp', 'chết tiệt')."
    ),
    "family": (
        "FILM GENRE: Family / phim gia đình.\n"
        "- Quan hệ gia đình PHẢI chính xác: con/bố/mẹ/ông/bà/cô/chú/dì/cậu/bác.\n"
        "- Anh chị em ruột: 'anh/chị/em' theo thứ tự.\n"
        "- Họ hàng: tự xưng 'cháu', gọi theo vai vế ('cô Lan', 'chú Ba').\n"
        "- Tránh dùng 'tôi/bạn' giữa người thân — luôn dùng vai vế."
    ),
    "horror": (
        "FILM GENRE: Horror / phim kinh dị.\n"
        "- Câu ngắn, không khí căng thẳng, thì thầm.\n"
        "- Sợ hãi: dùng nhiều dấu '...' để diễn tả ngắt quãng.\n"
        "- Kẻ phản diện / quỷ: 'ngươi', 'mày'.\n"
        "- Nạn nhân tự xưng nhỏ 'tôi', 'mình'."
    ),
    "anime": (
        "FILM GENRE: Anime / animation.\n"
        "- Năng lượng, tươi trẻ, biểu cảm.\n"
        "- Trẻ em / học sinh: 'tớ/cậu', 'mình/cậu'.\n"
        "- Bạn thân: 'tao/mày' OK.\n"
        "- Senpai/sensei giữ romaji nếu phổ biến.\n"
        "- Tên nhân vật giữ romaji ('Naruto', 'Sakura'), không Việt hoá."
    ),
    "documentary": (
        "FILM GENRE: Documentary / phim tài liệu.\n"
        "- Trung tính, factual, không cảm xúc.\n"
        "- Người dẫn dùng 'tôi' formal, gọi 'các bạn'.\n"
        "- Tránh slang và đại từ thân mật."
    ),
    "kpop_drama": (
        "FILM GENRE: K-drama / phim Hàn Quốc.\n"
        "- Romance: cặp đôi 'anh/em' (older male / younger female).\n"
        "- Tên nhân vật giữ romanization Hàn ('Lee Min-ho', 'Kim Soo-hyun').\n"
        "- Honorifics: 'oppa' → 'anh', 'noona' → 'chị', 'ahjussi' → 'chú'.\n"
        "- Boss formal: 'sajangnim' → 'giám đốc'."
    ),
    "cdrama": (
        "FILM GENRE: C-drama / phim Hoa ngữ hiện đại.\n"
        "- Romance modern: 'anh/em' couple.\n"
        "- Boss / CEO: 'tổng giám đốc' / 'sếp'.\n"
        "- Tên nhân vật phiên âm tiếng Việt ('Tô Huyên', 'Lý Minh').\n"
        "- 哥/姐 (anh trai/chị gái lớn) → 'anh/chị'."
    ),
    "wuxia": (
        "FILM GENRE: Wuxia / kiếm hiệp / cổ trang Trung Quốc.\n"
        "- Cao thủ võ lâm: tự xưng 'tại hạ', gọi 'các hạ'.\n"
        "- Sư phụ/đệ tử: 'sư phụ/đồ nhi', 'sư huynh/sư đệ/sư muội'.\n"
        "- Cặp đôi cổ trang: 'thiếp/chàng', 'tướng công/phu nhân'.\n"
        "- Vũ khí giữ tên Hán-Việt ('thanh kiếm', 'cây cung', 'ngân châm').\n"
        "- Môn phái giữ tên gốc ('Thiếu Lâm', 'Võ Đang')."
    ),
}


def _genre_prompt_block(film_genre: str | None) -> str:
    """Lấy prompt block cho genre. Ưu tiên block từ genre_detector mới
    (chi tiết, có pronoun matrix family). Fallback FILM_GENRE_PROMPTS cũ
    (Wuxia + few keys legacy)."""
    if not film_genre:
        return ""
    g = film_genre.lower().strip()
    # Try new module first (historical_zh, modern_drama, romcom, action, news, ...)
    try:
        from app.services.llm import get_genre_prompt_block
        block = get_genre_prompt_block(g)
        if block and len(block) > 50:
            return block
    except Exception:
        pass
    # Fallback: legacy keys (wuxia, drama, ...)
    return FILM_GENRE_PROMPTS.get(g, "")


def _genre_block(film_genre: str | None) -> str:
    """Format genre block for prompt — leading newlines + label."""
    block = _genre_prompt_block(film_genre)
    if not block:
        return ""
    return f"\n\n{block}"


def _build_budget_block(segments: list[dict]) -> str:
    """Build per-segment char budget hint cho Qwen prompt.

    Output format: list "N. text [max M chars]" để Qwen biết line nào
    cần ngắn (slot tight) line nào dài (slot rộng).
    """
    lines = []
    for i, seg in enumerate(segments):
        dur = max(0.3, seg.get("end", 0) - seg.get("start", 0))
        max_chars = max(8, int(dur * 11.5))
        text = seg.get("original_text") or seg.get("text") or ""
        spk = seg.get("speaker")
        speaker_genders = seg.get("_speaker_genders_ref") or {}
        prefix = f"[max {max_chars} chars]"
        if spk:
            g = speaker_genders.get(spk, "unknown")
            prefix = f"[{spk}:{g}, max {max_chars} chars]"
        lines.append(f"{i+1}. {prefix} {text}")
    return "\n".join(lines)


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


def _clean_pronoun_placeholders(text: str) -> str:
    """Remove "anh/em", "chị/em", etc. placeholders that LLM occasionally
    leaks. Pick the FIRST option (usually the speaker pronoun) since that's
    what the LLM was trying to suggest. Conservative — only target patterns
    bắt đầu bằng từ đại từ + "/" + đại từ khác.
    """
    if not text:
        return text
    # Patterns: "Anh/Em", "anh/em", "Chị/em", "ông/bà", "tao/mày", etc.
    # → keep the first word, drop "/word" part
    pronouns = r"(?:anh|em|chị|cô|cậu|tôi|bạn|ông|bà|chú|bác|tao|mày|mình|ta)"
    pattern = re.compile(
        rf"\b({pronouns})\s*/\s*{pronouns}\b",
        re.IGNORECASE,
    )
    return pattern.sub(lambda m: m.group(1), text)


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
                text = _clean_pronoun_placeholders(text)
                results[idx] = {"speech_text": text, "emotion": emotion}
        else:
            # Fallback: no emotion tag
            m2 = re.match(r"^(\d+)[.):\s]+(.+)$", line)
            if m2:
                idx = int(m2.group(1)) - 1
                text = _strip_duration_hints(m2.group(2).strip())
                text = _clean_pronoun_placeholders(text)
                if 0 <= idx < count:
                    results[idx] = {"speech_text": text, "emotion": "neutral"}

    return results


def _build_translate_prompt(
    segments: list[dict],
    target_lang: str,
    source_lang: str = None,
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
) -> list[dict]:
    """Build prompt for Qwen to do FULL translation with emotion tags.

    Similar to gemini_translate_svc but optimized for smaller local LLM.

    Nếu segments có 'speaker' + project có 'speaker_genders' thì truyền vào
    prompt dạng [SPKx:gender] để LLM chọn đại từ phù hợp giới tính từng nhân
    vật, tránh trường hợp dịch lại "cô" cho cả nam.
    """
    tgt_name = LANG_NAMES.get(target_lang, target_lang)
    src_name = LANG_NAMES.get(source_lang, source_lang) if source_lang else "auto-detect"

    # Numbered input — kèm prefix [SPKx:gender] + [max N chars] BUDGET cho
    # Qwen biết line nào cần ngắn (slot tight) line nào rộng. Tiếng Việt
    # ~11.5 chars/sec speech rate, headroom 10% tránh overflow TTS.
    has_speakers = bool(speaker_genders) and any(seg.get("speaker") for seg in segments)
    lines = []
    for i, seg in enumerate(segments):
        text = seg.get("original_text", seg.get("text", ""))
        dur = max(0.3, seg.get("end", 0) - seg.get("start", 0))
        max_chars = max(8, int(dur * 11.5))
        prefix_parts = [f"max {max_chars} chars"]
        if has_speakers and seg.get("speaker"):
            spk = seg["speaker"]
            g = (speaker_genders or {}).get(spk, "unknown")
            prefix_parts.insert(0, f"{spk}:{g}")
        prefix = "[" + ", ".join(prefix_parts) + "]"
        lines.append(f"{i+1}. {prefix} {text}")
    numbered = "\n".join(lines)

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

    # Speaker rule — branch theo target language. Mỗi ngôn ngữ có hệ
    # đại từ + honorific khác nhau, hard-code Vietnamese rule cho lang
    # khác sẽ confuse LLM.
    speaker_rule = ""
    is_vietnamese = (target_lang or "").lower() in ("vietnamese", "vi", "vi-vn")
    if has_speakers:
        common_prefix = (
            "\n- The [SPKx:gender] prefix tells you which character speaks. Use consistent\n"
            "  pronouns per speaker across the scene. Do NOT include the prefix in output."
        )
        if is_vietnamese:
            vi_specific = (
                "\n- For female speakers use chị/em/cô. For male speakers use anh/ông/chú/cậu.\n"
                "  For unknown genders, use neutral forms based on context.\n"
                "- In heated/argument scenes, use stronger pronouns (mày/tao, ông/bà) when fitting\n"
                "  the gender and tone — don't default to soft 'cô/anh' for arguments."
            )
            speaker_rule = common_prefix + vi_specific
        else:
            generic = (
                f"\n- Use {tgt_name} pronouns/honorifics that match each speaker's gender from\n"
                f"  the prefix. Match the tone (calm vs argument) using register appropriate\n"
                f"  for {tgt_name}."
            )
            speaker_rule = common_prefix + generic

    # Pronoun rule — must be UNAMBIGUOUS to avoid LLM copying placeholder.
    # User feedback: "anh/em" example trong prompt bị LLM output literal
    # ("Anh/Em thật sự có cuộc họp à?"). Fix: yêu cầu CHỌN MỘT pronoun
    # cụ thể, không dùng dấu /.
    pronoun_rule = (
        "- Use ONE specific Vietnamese pronoun per character (NEVER write 'anh/em' "
        "or 'chị/em' with a slash — pick one based on speaker gender + context). "
        "Common choices: anh, em, tôi, bạn, ông, bà, chị, cô, chú, cậu, mày, tao."
        if is_vietnamese
        else f"- Use natural pronouns/honorifics standard for {tgt_name}"
    )

    system = f"""Bạn là dịch giả phim chuyên nghiệp. Dịch từ {src_name} sang {tgt_name}.

═══════════════════════════════════════════════════════════════
QUY TRÌNH BẮT BUỘC:

BƯỚC 1 — ĐỌC SCENE TRƯỚC: identify register (cổ trang/hiện đại/romcom/action),
quan hệ giữa speaker (vợ chồng / mẹ-con / bạn bè / cấp trên-dưới), tone.

BƯỚC 2 — PRONOUN: cùng SPKx phải có CÙNG cách xưng xuyên scene.
{pronoun_rule}{speaker_rule}

BƯỚC 3 — TIMING BUDGET (BẮT BUỘC):
Mỗi line có [max N chars] = ký tự TỐI ĐA cho dub khớp nhịp. Tiếng Việt
thường dài hơn Trung 30% — phải RÚT GỌN: cắt filler, dùng từ ngắn.
HARD: KHÔNG vượt max N chars.

BƯỚC 4 — ANCHOR ENTITIES PHẢI GIỮ:
- Vật dụng: 钻石→kim cương, 婚戒→nhẫn cưới, 戒指→nhẫn, 手机→điện thoại
- Quan hệ: 妈妈→mẹ, 爸爸→ba/bố, 姐姐→chị, 老板→sếp
- Ăn uống: 咖啡→cà phê, 牛奶→sữa, 果汁→nước trái cây
- Tên riêng (Wenxi, 阿絮, 张总): GIỮ NGUYÊN — KHÔNG dịch sang Việt

BƯỚC 5 — NGÔN NGỮ: tự nhiên, mượt như phim VTV. Chêm "...", "," cho ngắt
nhịp. Match emotion.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT (BẮT BUỘC, mỗi input 1 line):

N. [emotion] translated text

Emotions hợp lệ: [neutral] [happy] [sad] [angry] [whisper] [surprised] [fearful]

QUY TẮC OUTPUT:
- Số lines output PHẢI = số lines input
- Output CHỈ tiếng {tgt_name} — KHÔNG markdown/preamble/meta-commentary
- KHÔNG có placeholder, KHÔNG dấu "/" trong pronoun (chọn 1 từ duy nhất)
- KHÔNG include [SPKx:gender] hay [max N chars] trong output{extra_block}{_genre_block(film_genre)}"""

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
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
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
            speaker_genders=speaker_genders,
            film_genre=film_genre,
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
