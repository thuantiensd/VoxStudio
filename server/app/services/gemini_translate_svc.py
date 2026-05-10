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


def _extra_block(topic_hint: str | None,
                 glossary: list[tuple[str, str]] | None) -> str:
    """Render topic hint + glossary thành block prompt phía trên context."""
    from app.services import glossary_svc
    parts = []
    if topic_hint:
        s = glossary_svc.format_topic_hint_for_prompt(topic_hint)
        if s: parts.append(s)
    if glossary:
        s = glossary_svc.format_for_prompt(glossary)
        if s: parts.append(s)
    if not parts:
        return ""
    return "\n\n" + "\n\n".join(parts) + "\n"


def _genre_block_for_gemini(film_genre: str | None) -> str:
    """Inject genre-specific pronoun matrix + ngôn ngữ guide vào Gemini prompt.

    Ưu tiên block từ `app.services.llm.genre_detector` (chi tiết, có pronoun
    matrix cổ trang/hiện đại/action/romcom). Fallback block cũ nếu module
    chưa có.
    """
    if not film_genre or film_genre == "auto":
        return ""
    try:
        from app.services.llm import get_genre_prompt_block
        block = get_genre_prompt_block(film_genre)
        if block:
            return "\n" + block + "\n"
    except Exception:
        pass
    # Fallback block cũ (giữ tương thích)
    try:
        from app.services.llm_translate_svc import _genre_prompt_block
        block = _genre_prompt_block(film_genre)
        if block:
            return f"\n\n6. **Film Genre Context**:\n{block}\n"
    except Exception:
        pass
    return ""


MAX_RETRY = 3
# Cho phép vượt budget 25% — soft limit. >25% → fail validate, retry.
BUDGET_SLACK = 1.25


def _max_chars_for_seg(seg: dict) -> int:
    """Tính budget chars cho 1 seg dựa trên duration. Đồng bộ với prompt."""
    dur = max(0.3, seg.get("end", 0) - seg.get("start", 0))
    return max(8, int(dur * 11.5))


def _validate_translations(
    parsed: list[dict],
    batch: list[dict],
) -> list[dict]:
    """Validate parsed output. Trả list error dicts cho seg nào không pass.

    Mỗi error: {index, reasons: [str]}. Empty list = all OK.
    """
    errors: list[dict] = []
    for i, seg in enumerate(batch):
        result = parsed[i] if i < len(parsed) else {}
        translated = (result.get("translated_text") or "").strip()
        reasons: list[str] = []

        # Empty / placeholder
        if not translated:
            reasons.append("trống — không có dịch")
        elif translated in ("...", "…", "TBD", "TODO", "?", "—", "/"):
            reasons.append(f"placeholder ({translated!r})")
        elif len(translated) < 2:
            reasons.append("quá ngắn (<2 ký tự)")

        # Leak prompt artifacts
        if "[SPK" in translated or "[SPEAKER" in translated:
            reasons.append("chứa SPK marker leak từ prompt")
        if "max " in translated.lower() and "chars" in translated.lower():
            reasons.append("chứa 'max chars' leak từ prompt")
        # Slash-form pronoun chưa giải quyết: "anh/em", "tôi/mình"
        if re.search(r"\b(anh|em|tôi|tao|chú|cô|nàng|chàng|ngươi|ta)/(anh|em|tôi|tao|chú|cô|nàng|chàng|ngươi|ta)\b", translated, re.IGNORECASE):
            reasons.append("chứa dạng pronoun 'X/Y' chưa chọn")

        # Char budget — chấp nhận BUDGET_SLACK% slack
        max_chars = _max_chars_for_seg(seg)
        if len(translated) > int(max_chars * BUDGET_SLACK):
            reasons.append(f"vượt {len(translated)}>{int(max_chars*BUDGET_SLACK)} chars (budget={max_chars})")

        if reasons:
            errors.append({"batch_index": i, "global_index": seg["index"], "reasons": reasons,
                            "translated": translated[:60], "max_chars": max_chars})
    return errors


def _build_retry_prompt_addendum(errors: list[dict]) -> str:
    """Build error feedback section cho retry prompt. Liệt kê line + lý do
    cụ thể để LLM hiểu cần fix gì."""
    if not errors:
        return ""
    lines = ["", "═══════════════════════════════════════════════════════════════",
             "⚠️ LẦN TRƯỚC CÓ LỖI — SỬA NGAY CHO CÁC LINE SAU:"]
    for e in errors:
        idx = e["global_index"] + 1
        reason_str = "; ".join(e["reasons"])
        prev = e.get("translated", "")
        lines.append(f"  • Line {idx}: {reason_str}")
        if prev:
            lines.append(f"    Lần trước: {prev!r}")
    lines.append("Phải fix ĐÚNG các line trên. KHÔNG được lặp lại lỗi cũ.")
    lines.append("")
    return "\n".join(lines)


def translate_segments(
    segments: list[dict],
    target_language: str,
    source_language: str = "auto",
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
) -> list[dict]:
    """Translate film dialogue segments with full context awareness.

    Quality control:
      - Cache lookup TRƯỚC LLM call (giảm cost + tốc độ re-run).
      - Validate output (char budget, missing index, prompt leak, placeholder).
      - Retry tối đa MAX_RETRY lần với prompt addendum chỉ rõ line lỗi.
      - Sau retry vẫn fail → giữ partial result, log warning, không silent corrupt.
      - Per-segment fallback: nếu 1-2 seg trong batch fail, retry CHỈ những seg đó.
    """
    # ── Cache layer: lookup TRƯỚC khi gọi LLM ──
    # Cache key gồm text + lang + engine + register + speaker_gender →
    # cùng video re-run, hoặc dialogue lặp giữa các phim, sẽ hit cache.
    try:
        from app.services.llm import cached_translate_segments
        register = film_genre or "generic"

        def _llm_call(uncached: list[dict]) -> list[dict]:
            return _translate_uncached(
                uncached, target_language, source_language,
                topic_hint, glossary, speaker_genders, film_genre,
            )

        return cached_translate_segments(
            segments=segments,
            target_lang=target_language,
            source_lang=source_language,
            engine="gemini",
            register=register,
            fallback_translate_fn=_llm_call,
            speaker_genders=speaker_genders,
        )
    except ImportError:
        # Fallback: cache module chưa load → call LLM trực tiếp
        return _translate_uncached(
            segments, target_language, source_language,
            topic_hint, glossary, speaker_genders, film_genre,
        )


def _translate_uncached(
    segments: list[dict],
    target_language: str,
    source_language: str = "auto",
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
) -> list[dict]:
    """Internal — actual LLM call, không qua cache. Caller (translate_segments)
    đã cache lookup."""
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

        prompt = _build_prompt(
            batch, target_language, source_language, context_before,
            topic_hint=topic_hint, glossary=glossary,
            speaker_genders=speaker_genders,
            film_genre=film_genre,
        )

        # Translate batch với retry-on-validation-fail
        batch_results, retry_count = _translate_batch_with_retry(
            model=model, prompt_base=prompt, batch=batch,
            max_retry=MAX_RETRY,
        )

        for i, result in enumerate(batch_results):
            if result["translated_text"]:
                results[batch_start + i] = result

        logger.info(
            "Gemini batch %d-%d (%d segs) — retried %d time(s)",
            batch_start + 1, batch_end, len(batch), retry_count,
        )

    # Final stats
    missing = sum(1 for r in results if not r["translated_text"])
    if missing:
        logger.warning(
            "Gemini final: %d/%d segments missing translation (caller should fallback engine)",
            missing, len(results),
        )

    return results


def _translate_batch_with_retry(
    *, model, prompt_base: str, batch: list[dict], max_retry: int,
) -> tuple[list[dict], int]:
    """Run translate + validate, retry với prompt addendum khi có error.

    Returns (results, retry_count).
    """
    parsed = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
              for _ in batch]
    addendum = ""
    last_errors: list[dict] = []

    for attempt in range(max_retry):
        prompt = prompt_base + addendum
        try:
            response = model.generate_content(prompt)
            new_parsed = _parse_response(response.text, len(batch))
        except Exception as e:
            logger.error("Gemini API call failed attempt %d: %s", attempt + 1, e)
            if attempt == max_retry - 1:
                break
            continue

        # Merge new results — chỉ override những seg lần trước fail/empty
        if attempt == 0:
            parsed = new_parsed
        else:
            # Retry: chỉ thay những seg trong last_errors (failed last attempt)
            failed_idx = {e["batch_index"] for e in last_errors}
            for i, r in enumerate(new_parsed):
                if i in failed_idx and r["translated_text"]:
                    parsed[i] = r

        # Validate
        errors = _validate_translations(parsed, batch)
        if not errors:
            return parsed, attempt + 1

        last_errors = errors
        if attempt < max_retry - 1:
            logger.info(
                "Gemini retry %d/%d — %d/%d seg cần sửa",
                attempt + 1, max_retry, len(errors), len(batch),
            )
            addendum = _build_retry_prompt_addendum(errors)
        else:
            logger.warning(
                "Gemini batch giữ partial result sau %d retry — %d seg vẫn fail validate",
                max_retry, len(errors),
            )
            for e in errors[:5]:  # log 5 sample errors
                logger.warning("  Line %d: %s — %r",
                                e["global_index"] + 1, "; ".join(e["reasons"]),
                                e.get("translated", ""))

    return parsed, max_retry


def _build_prompt(
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    context_before: list[dict],
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
) -> str:
    """Build a detailed prompt for context-aware film translation."""

    lang_names = {
        "vietnamese": "Tiếng Việt", "english": "English", "chinese": "Tiếng Trung",
        "japanese": "Tiếng Nhật", "korean": "Tiếng Hàn", "french": "Tiếng Pháp",
        "spanish": "Tiếng Tây Ban Nha", "german": "Tiếng Đức",
    }
    tgt_name = lang_names.get(target_lang, target_lang)
    src_name = lang_names.get(source_lang, source_lang) if source_lang != "auto" else "auto-detect"

    # Build segment list — kèm [SPKx:gender] khi có diarization để chọn pronoun đúng
    # + [max N chars] budget để LLM tự rút gọn câu cho khớp slot duration
    # (Việt ~13 chars/giây speech rate, để headroom 10% tránh overflow TTS)
    has_speakers = bool(speaker_genders) and any(seg.get("speaker") for seg in segments)
    seg_lines = []
    for seg in segments:
        text = seg["original_text"].strip()
        if not text:
            continue
        dur = max(0.3, seg["end"] - seg["start"])
        # Tiếng Việt ~13 chars/s thoải mái; ép 11.5 chars/s để dub có headroom
        max_chars = max(8, int(dur * 11.5))
        prefix = f'[{seg["start"]:.1f}s-{seg["end"]:.1f}s, max {max_chars} chars]'
        if has_speakers and seg.get("speaker"):
            spk = seg["speaker"]
            g = (speaker_genders or {}).get(spk, "unknown")
            prefix = f'{prefix} [{spk}:{g}]'
        seg_lines.append(f'{seg["index"] + 1}. {prefix} {text}')

    # Build context section
    context_section = ""
    if context_before:
        ctx_lines = [f'  {c["index"]}. {c["original"]} → {c["translated"]}' for c in context_before]
        context_section = f"\n\nPrevious dialogue (for context, do NOT translate these):\n" + "\n".join(ctx_lines)

    prompt = f"""Bạn là dịch giả phim chuyên nghiệp đã làm 10+ năm phim Trung/Hàn cho VTV/HTV.
NHIỆM VỤ: dịch lời thoại từ {src_name} → {tgt_name} cho phụ đề/lồng tiếng.

═══════════════════════════════════════════════════════════════
QUY TRÌNH BẮT BUỘC — THỰC HIỆN TUẦN TỰ:

BƯỚC 0 — ĐỌC TOÀN BỘ SCENE TRƯỚC:
   Đọc HẾT mọi dòng trước khi dịch. Xác định:
   • Bối cảnh: cổ trang (sử dụng 朕/郡主/公子/妾/陛下/微臣/在下…) HAY hiện đại?
   • Quan hệ giữa các speaker: vua-tôi, vợ chồng, bạn bè, đồng nghiệp, kẻ thù?
   • Tone: trang trọng / thân mật / căng thẳng / hài hước / bi tráng?
   • Mỗi SPKx nói gì → planning pronoun nhất quán XUYÊN SUỐT scene.

BƯỚC 1 — PICK REGISTER (quan trọng nhất):

   ▸ CỔ TRANG (có 朕/陛下/郡主/公子/小姐/微臣/在下/本宫/姑娘/夫君/妾身):
     • Vua xưng: "trẫm" / gọi quan: "khanh" / gọi dân: "ngươi"
     • Quan xưng vua: "bệ hạ" / xưng mình: "thần" / "vi thần"
     • Công chúa/quận chúa xưng: "bổn cung" / "ta" — gọi nam: "ngươi" / "công tử"
     • Nam nhân với người yêu/vợ: "ta" / "chàng" gọi nữ: "nàng" / "thiếp"
     • Nữ nhân với người yêu/chồng: "thiếp" gọi nam: "chàng"
     • Người ngang vai: "ngươi/ta", "huynh/đệ", "tỷ/muội"
     • TUYỆT ĐỐI KHÔNG dùng "anh/em/bạn/tôi/mình" cho phim cổ trang!

   ▸ HIỆN ĐẠI (đời thường, công sở, romcom):
     • Bạn bè / đồng nghiệp ngang tuổi: "tôi/cậu" hoặc "mình/bạn"
     • Nam-nữ yêu nhau: "anh/em" (KHÔNG đảo ngược!)
     • Cấp trên-dưới: "sếp/em", "anh/em"
     • Thân mật/cãi nhau: "tao/mày" (đúng ngữ cảnh)
     • Gia đình: ba/mẹ/con, ông/bà/cháu, anh/em ruột

BƯỚC 2 — PRONOUN GROUND TRUTH từ [SPKx:gender]:
   • SPKx:male → speaker là NAM → KHÔNG được tự xưng "em" với người ngang tuổi.
   • SPKx:female → speaker là NỮ → KHÔNG được tự xưng "anh".
   • SPKx:unknown → suy ra từ ngữ cảnh + tên gọi (郡主=nữ, 公子=nam, 朕=vua…).
   • CÙNG SPKx phải dùng CÙNG cách xưng hô từ đầu đến cuối scene.
   • KHÔNG include "[SPKx:...]" trong output.

BƯỚC 3 — DỊCH TỪNG DÒNG:
   • Tiếng Việt mượt như phim VTV — KHÔNG word-by-word literal.
   • Match emotion: cãi → giọng gắt, yêu → giọng mềm, sợ → giọng run.
   • Giữ nghĩa CỐT LÕI, bỏ filler/lặp lại không cần thiết.
   • Nếu nhân vật gọi tên/xưng hô → giữ nguyên (郡主→"Quận chúa", 朕→"Trẫm").

═══════════════════════════════════════════════════════════════
TIMING BUDGET (BẮT BUỘC tuân thủ):
   Mỗi dòng có `[max N chars]` — số ký tự TỐI ĐA cho dub đúng nhịp.
   • Tiếng Việt SẼ DÀI HƠN Trung 30-40% nếu dịch literal → vượt slot → dub dồn.
   • Phải RÚT GỌN: cắt filler ("thì là", "vậy đó"), dùng từ ngắn, bỏ chủ ngữ
     thừa nếu vẫn rõ nghĩa.
   • Nếu original dày đặc → ưu tiên Ý CHÍNH, bỏ chi tiết phụ.
   • HARD RULE: KHÔNG vượt max chars. Đếm trước khi xuất.

═══════════════════════════════════════════════════════════════
VÍ DỤ ĐÚNG / SAI cho phim CỔ TRANG:

❌ SAI: "郡主, 你说你来我这里十多回" → "Công chúa, bạn nói bạn đã đến chỗ tôi hơn mười lần"
✅ ĐÚNG: → "Quận chúa, nàng đã đến chỗ ta hơn mười lần rồi"

❌ SAI: "我早就帮你了" → "Tôi đã giúp bạn rồi"
✅ ĐÚNG: → "Ta giúp nàng từ lâu rồi"

❌ SAI: "朕大霉了" → "Vua xui xẻo"
✅ ĐÚNG: → "Trẫm xui xẻo lắm"

❌ SAI (literal cho slot ngắn 1.0s = max ~11 chars):
   "你说你来我这十多回 有谁能帮你"
   → "Ngươi nói ngươi đã tới chỗ ta hơn mười lần rồi, ai có thể giúp được nàng đây"
✅ ĐÚNG: → "Nàng tới đây nhiều lần rồi" (cắt phần lặp lại, giữ ý chính)

VÍ DỤ ĐÚNG / SAI cho phim HIỆN ĐẠI:

❌ SAI: "我以为你不来了" (giữa cặp đôi) → "Tôi tưởng bạn không đến nữa"
✅ ĐÚNG: → "Em tưởng anh không đến nữa"

❌ SAI: "你给我滚" (cãi nhau) → "Bạn cuốn xéo cho tôi"
✅ ĐÚNG: → "Cút đi cho tao!" (giận dữ, không dùng "bạn/tôi")

═══════════════════════════════════════════════════════════════
EMOTION TAGS hợp lệ: neutral, happy, sad, angry, whisper, surprised, fearful
{_extra_block(topic_hint, glossary)}{_genre_block_for_gemini(film_genre)}{context_section}

═══════════════════════════════════════════════════════════════
DIALOGUE CẦN DỊCH (đọc HẾT trước khi dịch):
{chr(10).join(seg_lines)}

═══════════════════════════════════════════════════════════════
TRẢ VỀ CHÍNH XÁC JSON sau (KHÔNG markdown, KHÔNG code fence):
[
  {{"index": 1, "translated": "...", "speech": "...", "emotion": "neutral"}},
  {{"index": 2, "translated": "...", "speech": "...", "emotion": "happy"}}
]

• "translated": câu Việt mượt + đúng pronoun + KHÔNG vượt max_chars
• "speech": cùng text nhưng tối ưu TTS — thêm "..." giữa cụm cho ngắt nhịp tự nhiên
• "emotion": 1 trong 7 tag trên

KIỂM TRA TRƯỚC KHI XUẤT:
[ ] Mọi line ≤ max_chars?
[ ] Pronoun nhất quán cho mỗi SPKx?
[ ] Cổ trang dùng "ta/nàng/chàng/khanh/trẫm/thiếp" — KHÔNG có "anh/em/bạn/tôi"?
[ ] Hiện đại không bị cứng/word-by-word?
[ ] JSON hợp lệ?"""
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
