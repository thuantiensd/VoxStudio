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


def _pronoun_hint_for_gender(gender: str) -> str:
    """Hint pronoun cụ thể cho LLM tránh nhầm. Inject thẳng vào mỗi seg
    line thay vì chỉ rule chung.

    Đọc gender + register sau (LLM tự pick từ context). Hint chỉ là
    REMINDER MẠNH cho LLM — không lock 1 từ duy nhất.
    """
    g = (gender or "").lower().strip()
    if g == "male":
        return "tự xưng anh/tôi/ông/cha/ba/chú; KHÔNG tự xưng em/chị/cô"
    if g == "female":
        return "tự xưng em/chị/cô/mẹ/bà; KHÔNG tự xưng anh/ông/chú"
    return ""


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


def _name_translation_rule(source_lang: Optional[str]) -> str:
    """Return name translation rule cho từng source language.

    Convention:
      - zh (Trung) → Hán-Việt (Văn Tịch, Thương Dịch)
      - ko (Hàn)   → Hán-Việt (Lý Mẫn Hạo, Kim Tae-hee → Kim Thái Hi)
      - ja (Nhật)  → Romaji giữ nguyên (Tanaka, Sakura)
      - en/fr/de/.. → giữ nguyên (Tom, Marie, John)
    """
    src = (source_lang or "").lower().strip()
    # Map cả ISO short + tên đầy đủ
    if src in ("zh", "chinese", "zh-cn", "zh-tw", "mandarin"):
        return """
🔤 TÊN RIÊNG (source = Tiếng Trung):
   → PHIÊN ÂM HÁN-VIỆT theo phong cách phim Việt Nam.
   → TUYỆT ĐỐI KHÔNG để pinyin (Wenxi, Shang Yi) ra output cuối.

   Ví dụ:
   - 文汐 / Wenxi → Văn Tịch
   - 商奕 / Shang Yi → Thương Dịch
   - 阿絮 → A Tự
   - 慕容 → Mộ Dung
   - 林惜 → Lâm Tích
   - 张总 → Tổng Trương (sếp họ Trương)
   - 王大爷 → ông Vương
   - 子安 → Tử An

   Họ thông dụng → Hán-Việt:
   张→Trương, 王→Vương, 李→Lý, 刘→Lưu, 陈→Trần, 林→Lâm,
   赵→Triệu, 孙→Tôn, 周→Chu, 黄→Hoàng, 朱→Chu, 文→Văn,
   苏→Tô, 慕容→Mộ Dung, 欧阳→Âu Dương, 司马→Tư Mã

   Tước vị / chức danh:
   - Cổ trang: 陛下→Bệ hạ, 殿下→Điện hạ, 郡主→Quận chúa,
     公子→Công tử, 小姐→Tiểu thư, 王爷→Vương gia, 微臣→thần
   - Hiện đại: 老板→Sếp/ông chủ, 总裁→Tổng giám đốc,
     经理→Quản lý, 主任→Chủ nhiệm, 师父→Sư phụ
"""
    if src in ("ko", "korean", "kor"):
        return """
🔤 TÊN RIÊNG (source = Tiếng Hàn):
   → PHIÊN ÂM HÁN-VIỆT (convention phim Hàn dubbed VN).
   Ví dụ:
   - 이민호 / Lee Min Ho → Lý Mẫn Hạo
   - 김태희 / Kim Tae-hee → Kim Thái Hi
   - 박찬욱 / Park Chan-wook → Phác Tán Úc
"""
    if src in ("ja", "japanese", "jpn"):
        return """
🔤 TÊN RIÊNG (source = Tiếng Nhật):
   → GIỮ Romaji nguyên dạng (convention phim Nhật subbed VN).
   Ví dụ:
   - 田中 / Tanaka → Tanaka
   - 桜 / Sakura → Sakura
   KHÔNG dịch sang Hán-Việt (vd Điền Trung — không phổ biến).
"""
    # English / Latin scripts / others → giữ nguyên
    return """
🔤 TÊN RIÊNG (source = Tiếng Anh/Latin):
   → GIỮ NGUYÊN. KHÔNG phiên âm Hán-Việt.
   Ví dụ:
   - Tom → Tom
   - Sarah → Sarah
   - John Smith → John Smith
   - Marie Curie → Marie Curie
"""


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

    # Build segment list — kèm budget + STRONG pronoun anchor per line
    # (không chỉ rule chung — mỗi line có hint pronoun cụ thể để LLM follow)
    has_speakers = bool(speaker_genders) and any(seg.get("speaker") for seg in segments)
    seg_lines = []
    for seg in segments:
        text = (seg.get("original_text") or "").strip()
        if not text:
            continue
        budget = _max_chars(seg)
        prefix = f'[max {budget} chars]'
        if has_speakers and seg.get("speaker"):
            spk = seg["speaker"]
            g = (speaker_genders or {}).get(spk, "unknown")
            # STRONG hint: kèm pronoun cụ thể cho gender (theo register VN)
            # → LLM khó nhầm hơn so với chỉ "[SPK:female]"
            pronoun_hint = _pronoun_hint_for_gender(g)
            if pronoun_hint:
                prefix = f'[{spk}, {g}, {pronoun_hint}, max {budget} chars]'
            else:
                prefix = f'[{spk}, {g}, max {budget} chars]'
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
{_name_translation_rule(source_lang)}
BƯỚC 5 — NGÔN NGỮ:
   • Mượt như phim VTV — KHÔNG word-by-word literal
   • Match emotion: angry→gắt, whisper→nhỏ, happy→tươi
   • Tiếng Việt tự nhiên: chêm "nhé/à/vậy" hợp ngữ cảnh

BƯỚC 6 — SELF-VERIFY GENDER (tự kiểm tra giới tính speaker):
   Pipeline đoán giới tính TRƯỚC khi bạn dịch — nhưng có thể SAI vì chỉ
   dựa F0 pitch. Bạn — LLM — có thể nhận ra từ CONTEXT (lời thoại) ai
   thực sự là nam/nữ:
   • Speaker tự xưng "bố/cha/anh/ông" → NAM
   • Speaker tự xưng "mẹ/chị/em (với chồng)/cô" → NỮ
   • Speaker được người khác gọi "anh ơi" → NAM; "em ơi"/"chị ơi" → NỮ
   Sau khi dịch xong, KÈM field "speaker_genders" cuối output:
   nếu evidence rõ → ghi "male"/"female" + lý do; nếu không chắc → "unsure".

   Đây là CHECKING LẠI pipeline — backend sẽ override gender nếu bạn rõ ràng.
{extra_block}{context_section}

═══════════════════════════════════════════════════════════════
EMOTION TAGS hợp lệ: neutral, happy, sad, angry, whisper, surprised, fearful

OUTPUT: JSON object với schema:
{{
  "translations": [
    {{"index": 1, "translated": "...", "speech": "...", "emotion": "neutral"}},
    {{"index": 2, "translated": "...", "speech": "...", "emotion": "happy"}}
  ],
  "speaker_genders": {{
    "SPEAKER_00": {{"gender": "male", "evidence": "tự xưng 'bố' ở line 3"}},
    "SPEAKER_01": {{"gender": "female", "evidence": "chồng gọi 'em ơi'"}}
  }}
}}

• "translated": câu Việt mượt + đúng pronoun + KHÔNG vượt max_chars
• "speech": tối ưu TTS — thêm "..." giữa cụm cho ngắt nhịp
• "emotion": 1 trong 7 tag
• "speaker_genders": với MỖI SPKx, gender "male"/"female"/"unsure"
  + evidence ngắn gọn (1 câu). Đây là self-verify pipeline detection.

KIỂM TRA TRƯỚC XUẤT:
[ ] Mọi line ≤ max_chars?
[ ] Pronoun nhất quán cho mỗi SPKx?
[ ] Anchor entities (vật/người/ăn) đầy đủ?
[ ] Tên riêng dịch ĐÚNG convention source language (Hán-Việt cho Trung)?
[ ] speaker_genders cuối output đủ mọi SPKx?
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


def parse_translation_response(
    response_text: str,
    n_segments: int,
) -> tuple[list[dict], dict]:
    """Parse JSON response từ LLM. Robust với markdown wrapper, partial JSON.

    Returns:
      (translations, speaker_genders)
      - translations: list[dict] length=n_segments với translated_text/speech_text/emotion
      - speaker_genders: dict[str, dict] — LLM self-verify gender per speaker
        {"SPEAKER_00": {"gender": "male", "evidence": "..."}, ...}
        Empty {} nếu LLM không trả field này.
    """
    import re

    results = [{"translated_text": "", "speech_text": "", "emotion": "neutral"}
               for _ in range(n_segments)]
    speaker_genders: dict = {}

    text = (response_text or "").strip()
    if not text:
        return results, speaker_genders

    # Strip markdown code fence
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    text = text.strip()

    parsed = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except Exception:
                pass
    if parsed is None:
        return results, speaker_genders

    if isinstance(parsed, dict):
        items = parsed.get("translations") or parsed.get("data") or []
        # NEW: parse speaker_genders cuối output (LLM self-verify)
        sg = parsed.get("speaker_genders") or {}
        if isinstance(sg, dict):
            valid_g = {"male", "female", "unsure", "unknown"}
            for spk_id, info in sg.items():
                if isinstance(info, dict):
                    g = (info.get("gender") or "").lower().strip()
                    if g in valid_g:
                        speaker_genders[spk_id] = {
                            "gender": g,
                            "evidence": (info.get("evidence") or "").strip()[:200],
                        }
                elif isinstance(info, str):
                    g = info.lower().strip()
                    if g in valid_g:
                        speaker_genders[spk_id] = {"gender": g, "evidence": ""}
    elif isinstance(parsed, list):
        items = parsed
    else:
        return results, speaker_genders

    if not isinstance(items, list):
        return results, speaker_genders

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
    return results, speaker_genders
