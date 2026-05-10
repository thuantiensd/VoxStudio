"""Unified prompt builder cho mọi LLM engine (Gemini, OpenAI, Claude).

Trước đây mỗi engine có prompt riêng → Gemini đầy đủ, OpenAI/Claude minimal
→ chất lượng dịch chênh lệch lớn. Module này build 1 prompt chuẩn dùng
cho cả 3, tune theo provider quirks (JSON mode, system message, etc).

Functions:
  - build_translation_prompt(segments, ..., engine): main builder
  - build_retry_addendum(errors): error feedback cho retry
"""
from __future__ import annotations

import json
from typing import Optional


# Tiếng Việt ~13 chars/giây speech rate, ép 11.5 chars/s để có headroom
VN_SPEECH_RATE = 11.5


def _max_chars(seg: dict) -> int:
    dur = max(0.3, seg.get("end", 0) - seg.get("start", 0))
    return max(8, int(dur * VN_SPEECH_RATE))


def _lang_display_name(lang: str) -> str:
    names = {
        "vietnamese": "Tiếng Việt", "vi": "Tiếng Việt",
        "english": "English", "en": "English",
        "chinese": "Tiếng Trung", "zh": "Tiếng Trung",
        "japanese": "Tiếng Nhật", "ja": "Tiếng Nhật",
        "korean": "Tiếng Hàn", "ko": "Tiếng Hàn",
        "auto": "auto-detect",
    }
    return names.get((lang or "").lower(), lang or "auto")


def build_translation_prompt(
    *,
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    context_before: Optional[list[dict]] = None,
    topic_hint: Optional[str] = None,
    glossary_block: Optional[str] = None,
    speaker_genders: Optional[dict] = None,
    film_genre: Optional[str] = None,
    engine: str = "gemini",
) -> dict:
    """Build prompt cho LLM. Trả dict {system, user, format_hint} để caller
    adapt theo provider:
      - Gemini: nối system + user, gen JSON
      - OpenAI: dùng response_format=json_object, system + user
      - Claude: system + messages user

    Format output yêu cầu (mọi engine):
        JSON: {"translations": [{"index": int, "translated": str,
                                  "speech": str, "emotion": str}]}
    """
    tgt_name = _lang_display_name(target_lang)
    src_name = _lang_display_name(source_lang)

    # Build segment list — kèm budget + speaker info
    has_speakers = bool(speaker_genders) and any(seg.get("speaker") for seg in segments)
    seg_lines = []
    for seg in segments:
        text = (seg.get("original_text") or "").strip()
        if not text:
            continue
        budget = _max_chars(seg)
        prefix = f'[{seg["start"]:.1f}s-{seg["end"]:.1f}s, max {budget} chars]'
        if has_speakers and seg.get("speaker"):
            spk = seg["speaker"]
            g = (speaker_genders or {}).get(spk, "unknown")
            prefix = f'{prefix} [{spk}:{g}]'
        seg_lines.append(f'{seg["index"] + 1}. {prefix} {text}')

    # Context section
    context_section = ""
    if context_before:
        ctx_lines = [f'  {c["index"]}. {c["original"]} → {c["translated"]}'
                     for c in context_before]
        context_section = ("\n\nDIALOGUE TRƯỚC ĐÓ (chỉ tham khảo, KHÔNG dịch lại):\n"
                            + "\n".join(ctx_lines))

    # Genre block
    genre_block = ""
    if film_genre and film_genre != "auto":
        try:
            from .genre_detector import get_genre_prompt_block
            block = get_genre_prompt_block(film_genre)
            if block:
                genre_block = "\n" + block + "\n"
        except Exception:
            pass

    # Extra block (topic_hint, glossary)
    extra_block = ""
    if topic_hint:
        extra_block += f"\n\n📌 Topic/Background: {topic_hint}\n"
    if glossary_block:
        extra_block += f"\n\n📖 Glossary:\n{glossary_block}\n"

    # System message — KHÔNG ĐỔI giữa engines, mọi rule chung ở đây
    system = f"""Bạn là dịch giả phim chuyên nghiệp 10+ năm cho VTV/HTV.
NHIỆM VỤ: dịch lời thoại từ {src_name} → {tgt_name} cho lồng tiếng/phụ đề.

═══════════════════════════════════════════════════════════════
QUY TRÌNH BẮT BUỘC TUẦN TỰ:

BƯỚC 0 — ĐỌC HẾT SCENE TRƯỚC KHI DỊCH:
   • Identify register (cổ trang/hiện đại/action/romcom)
   • Identify quan hệ giữa speaker (vợ chồng / mẹ-con / sếp-nhân viên / bạn bè?)
   • Tone (trang trọng/thân mật/căng thẳng/hài hước)
   • Plan pronoun nhất quán cho mỗi SPKx XUYÊN SUỐT scene

BƯỚC 1 — PICK PRONOUN MATRIX (cực quan trọng):
{genre_block if genre_block else '''
   Đọc context để chọn:
   • Vợ chồng / yêu nhau: "anh/em" — KHÔNG "tôi/bạn"
   • Mẹ-con: "mẹ/con" — KHÔNG "tôi/bạn"
   • Cha-con: "ba|bố|cha/con"
   • Anh-chị-em ruột: theo tuổi
   • Bạn bè thân: "tao/mày" hoặc "tớ/cậu"
   • Đồng nghiệp: "tôi/anh", "tôi/chị"
   • Cổ trang: "ta/nàng/chàng/khanh/trẫm/thiếp" — KHÔNG "anh/em"
   • Người LẠ mới dùng "tôi/bạn"
'''}

BƯỚC 2 — PRONOUN GROUND TRUTH từ [SPKx:gender]:
   • SPKx:male → speaker NAM, không tự xưng "em" với người ngang tuổi
   • SPKx:female → speaker NỮ, không tự xưng "anh"
   • CÙNG SPKx phải có CÙNG cách xưng từ đầu đến cuối
   • KHÔNG include [SPKx:gender] trong output

BƯỚC 3 — TIMING BUDGET (BẮT BUỘC):
   Mỗi line có [max N chars] = số ký tự TỐI ĐA cho dub khớp nhịp.
   Tiếng Việt thường dài hơn Trung 30% nếu literal → vượt → dub dồn.
   Phải RÚT GỌN: cắt filler ("thì là", "vậy đó"), dùng từ ngắn.
   Ưu tiên: ý chính > nuance > literal completeness.
   HARD RULE: KHÔNG vượt max N chars cho bất kỳ line nào.

BƯỚC 4 — ANCHOR ENTITIES BẮT BUỘC GIỮ:
   Các từ key trong gốc PHẢI xuất hiện trong dịch (không được "đoán"
   thay nội dung):
   • Vật dụng: 钻石→kim cương, 婚戒→nhẫn cưới, 戒指→nhẫn, 手机→điện thoại
   • Quan hệ: 妈妈→mẹ, 爸爸→ba/bố, 姐姐→chị, 老板→sếp/ông chủ
   • Ăn uống: 咖啡→cà phê, 牛奶→sữa, 果汁→nước trái cây
   • Tên riêng (Wenxi, 阿絮, 张总): GIỮ NGUYÊN — KHÔNG dịch sang Việt

BƯỚC 5 — NGÔN NGỮ:
   • Mượt như phim VTV — KHÔNG word-by-word literal
   • Match emotion: angry→gắt, whisper→nhỏ, happy→tươi
   • Tiếng Việt tự nhiên: chêm "nhé/à/vậy" hợp ngữ cảnh
{extra_block}{context_section}

═══════════════════════════════════════════════════════════════
EMOTION TAGS hợp lệ: neutral, happy, sad, angry, whisper, surprised, fearful

OUTPUT: JSON object với schema:
{{
  "translations": [
    {{"index": 1, "translated": "...", "speech": "...", "emotion": "neutral"}},
    {{"index": 2, "translated": "...", "speech": "...", "emotion": "happy"}}
  ]
}}

• "translated": câu Việt mượt + đúng pronoun + KHÔNG vượt max_chars
• "speech": tối ưu TTS — thêm "..." giữa cụm cho ngắt nhịp
• "emotion": 1 trong 7 tag

KIỂM TRA TRƯỚC XUẤT:
[ ] Mọi line ≤ max_chars?
[ ] Pronoun nhất quán cho mỗi SPKx?
[ ] Anchor entities (vật/người/ăn) đầy đủ?
[ ] Tên riêng giữ nguyên?
[ ] JSON hợp lệ, đủ index?
"""

    # User message — chứa dialogue cần dịch
    user_input = "DIALOGUE CẦN DỊCH (đọc HẾT trước):\n" + "\n".join(seg_lines)

    return {
        "system": system,
        "user": user_input,
        "n_segments": len(segments),
    }


def build_retry_addendum(errors: list[dict]) -> str:
    """Build feedback section cho retry."""
    if not errors:
        return ""
    lines = ["", "═══════════════════════════════════════════════════════════════",
             "⚠️ LẦN TRƯỚC CÓ LỖI — SỬA NGAY CÁC LINE SAU:"]
    for e in errors:
        idx = e["global_index"] + 1
        reason_str = "; ".join(e["reasons"])
        prev = e.get("translated", "")
        orig = e.get("original", "")
        lines.append(f"  • Line {idx}: {reason_str}")
        if orig:
            lines.append(f"    Gốc: {orig!r}")
        if prev:
            lines.append(f"    Lần trước: {prev!r}")
    lines.append("Phải fix ĐÚNG các line trên. KHÔNG được lặp lại lỗi cũ.")
    lines.append("")
    return "\n".join(lines)


def parse_translation_response(response_text: str, n_segments: int) -> list[dict]:
    """Parse JSON response từ LLM. Robust với markdown wrapper, partial JSON.

    Returns list[dict] length=n_segments với keys translated_text, speech_text, emotion.
    Empty entries cho missing index.
    """
    import re

    results = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
               for _ in range(n_segments)]

    text = (response_text or "").strip()
    if not text:
        return results

    # Strip markdown code fence
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    text = text.strip()

    parsed = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Try extract JSON object from text
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except Exception:
                pass
    if parsed is None:
        return results

    # Accept both: {"translations": [...]} and direct [...]
    if isinstance(parsed, dict):
        items = parsed.get("translations") or parsed.get("data") or []
    elif isinstance(parsed, list):
        items = parsed
    else:
        return results

    if not isinstance(items, list):
        return results

    valid_emotions = {"neutral", "happy", "sad", "angry", "whisper",
                       "surprised", "fearful"}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item.get("index", 0)) - 1
        except (TypeError, ValueError):
            continue
        if not (0 <= idx < n_segments):
            continue
        translated = (item.get("translated") or item.get("text") or "").strip()
        speech = (item.get("speech") or translated).strip()
        emotion = (item.get("emotion") or "neutral").lower()
        if emotion not in valid_emotions:
            emotion = "neutral"
        if translated:
            results[idx] = {
                "translated_text": translated,
                "speech_text": speech or translated,
                "emotion": emotion,
            }
    return results
