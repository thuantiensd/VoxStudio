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


def build_speaker_analysis_prompt(
    *,
    segments: list[dict],
    source_lang: str,
    film_genre: Optional[str] = None,
    max_lines: int = 200,
) -> dict:
    """Pass-1 prompt: analyze speaker relationships TRƯỚC khi dịch.

    LLM đọc transcript có SPEAKER_XX tag → output JSON quan hệ:
    ai là ai, nói với ai, gender, pronoun chuẩn cho từng cặp.
    Pass-2 (translate) sẽ dùng map này làm ANCHOR → LLM hết chỗ đoán mò.

    Trả {system, user}. Caller gửi tới LLM (Gemini/OpenAI/Claude), parse
    với parse_speaker_analysis().
    """
    src_name = _lang_display_name(source_lang)

    sample_lines = []
    for seg in segments[:max_lines]:
        text = (seg.get("original_text") or "").strip()
        if not text:
            continue
        spk = seg.get("speaker") or "?"
        sample_lines.append(f"{spk}: {text}")

    genre_hint = ""
    if film_genre and film_genre != "auto":
        genre_hint = f"\n• Thể loại đã detect: {film_genre} — pick register phù hợp.\n"

    system = f"""Bạn là chuyên gia phân tích kịch bản phim. Đọc đoạn hội thoại
sau (từ {src_name}) và XÁC ĐỊNH QUAN HỆ giữa các speaker.

═══════════════════════════════════════════════════════════════
NHIỆM VỤ:
1) Đọc HẾT đoạn hội thoại — từng SPEAKER_XX là 1 nhân vật.
2) Với MỖI speaker, suy ra:
   • gender (male/female/unsure)
   • role trong scene (chồng, vợ, cha, mẹ, con, sếp, bạn, đồng nghiệp...)
   • cách họ tự xưng (anh/em/tôi/ba/mẹ/con/ta/thiếp...)
   • cách họ gọi MỖI speaker khác — VOCATIVE, khi nói TRỰC TIẾP (你)
   • third_person_label — khi người KHÁC nhắc tới speaker này ở NGÔI 3 (他/她)
     VD: con trai = "con" / "thằng bé" / "nó"
         chồng = "anh ấy" / "ông xã"
         sếp = "ông ấy" / "sếp"
3) Identify scene context: vợ chồng cãi nhau? cha con tâm sự? sếp họp?

═══════════════════════════════════════════════════════════════
EVIDENCE để suy luận (đọc kỹ — KHÔNG đoán mò):

🔹 Gender:
   • Speaker tự gọi "anh/bố/ba/chồng/ông/cậu" → NAM
   • Speaker tự gọi "em/mẹ/má/vợ/chị/cô/bà" → NỮ
   • Người khác gọi "anh ơi/cậu ơi/sếp ơi" → speaker NAM
   • Người khác gọi "em ơi/chị ơi/cô ơi" → speaker NỮ

🔹 Quan hệ (CẨN THẬN — không nhầm):
   • Vợ ↔ chồng: tự xưng "anh"/"em", gọi nhau "anh"/"em". KHÔNG dùng "con".
   • Cha/mẹ → con: tự xưng "ba/bố/mẹ", gọi con "con".
   • Con → cha/mẹ: tự xưng "con", gọi "ba/bố/mẹ".
   • Anh/chị → em: tự xưng "anh/chị", gọi "em".
   • Em → anh/chị: tự xưng "em", gọi "anh/chị".
   • Sếp ↔ nhân viên: "tôi/anh", "tôi/chị", "sếp/em".
   • Bạn ngang vai: "tôi/cậu", "tao/mày" (thân).

🔹 CẢNH BÁO TUYỆT ĐỐI:
   ❌ "Con" KHÔNG phải từ vợ gọi chồng / chồng gọi vợ.
   ❌ "Con" KHÔNG phải từ cha mẹ tự xưng (cha mẹ tự xưng "ba/mẹ").
   ❌ "Con" CHỈ là: (1) con cái tự xưng với cha mẹ, (2) cha mẹ gọi con.
{genre_hint}
═══════════════════════════════════════════════════════════════
OUTPUT: JSON object DUY NHẤT (không markdown, không giải thích):

{{
  "scene_context": "Mô tả ngắn bối cảnh + quan hệ (1-2 câu)",
  "register": "modern/cổ trang/business/family/...",
  "speakers": {{
    "SPEAKER_00": {{
      "gender": "male",
      "role": "chồng",
      "self_pronoun": "anh",
      "addresses": {{
        "SPEAKER_01": "em"
      }},
      "third_person_label": "anh ấy",
      "evidence": "Line 3: tự xưng 'anh', gọi SPEAKER_01 'em' nhiều lần"
    }},
    "SPEAKER_01": {{
      "gender": "female",
      "role": "vợ",
      "self_pronoun": "em",
      "addresses": {{
        "SPEAKER_00": "anh"
      }},
      "third_person_label": "cô ấy",
      "evidence": "Line 5: 'em không muốn cãi nữa anh'"
    }},
    "SPEAKER_02": {{
      "gender": "male",
      "role": "con trai",
      "self_pronoun": "con",
      "addresses": {{
        "SPEAKER_00": "mẹ",
        "SPEAKER_01": "ba"
      }},
      "third_person_label": "con",
      "evidence": "Line 7: 'ba ơi con muốn chơi với ba'"
    }}
  }}
}}

QUY TẮC:
• Mỗi SPEAKER trong transcript phải có 1 entry.
• "self_pronoun", "addresses[X]", "third_person_label" PHẢI là tiếng Việt.
• "addresses[X]" = cách gọi TRỰC TIẾP (vocative khi nói VỚI X).
• "third_person_label" = cách nhắc khi nói VỀ speaker này cho người khác.
  - Con (nhỏ) → "con" / "thằng bé" / "nó"
  - Người ngang vai → "anh ấy" / "cô ấy" / "chị ấy"
  - Người lớn tuổi/cấp trên → "ông ấy" / "bà ấy" / "sếp"
• Nếu KHÔNG ĐỦ evidence → gender = "unsure", role = "unknown",
  self_pronoun = "tôi", addresses = {{}}, third_person_label = "người ấy".
• "evidence" phải trỏ tới line cụ thể (không nói chung chung).
"""

    user_input = (
        "ĐOẠN HỘI THOẠI CẦN PHÂN TÍCH (đọc HẾT trước khi trả lời):\n\n"
        + "\n".join(sample_lines)
    )

    return {
        "system": system,
        "user": user_input,
    }


def parse_speaker_analysis(response_text: str) -> dict:
    """Parse JSON output từ Pass-1. Robust với markdown wrapper."""
    import re

    text = (response_text or "").strip()
    if not text:
        return {}

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
    if not isinstance(parsed, dict):
        return {}

    speakers_raw = parsed.get("speakers") or {}
    if not isinstance(speakers_raw, dict):
        return {}

    valid_genders = {"male", "female", "unsure", "unknown"}
    speakers = {}
    for spk_id, info in speakers_raw.items():
        if not isinstance(info, dict):
            continue
        g = (info.get("gender") or "unsure").lower().strip()
        if g not in valid_genders:
            g = "unsure"
        addr = info.get("addresses") or {}
        if not isinstance(addr, dict):
            addr = {}
        speakers[spk_id] = {
            "gender": g,
            "role": (info.get("role") or "unknown").strip()[:40],
            "self_pronoun": (info.get("self_pronoun") or "tôi").strip()[:20],
            "addresses": {k: str(v).strip()[:20] for k, v in addr.items() if v},
            "third_person_label": (info.get("third_person_label") or "").strip()[:30],
            "evidence": (info.get("evidence") or "").strip()[:200],
        }

    return {
        "scene_context": (parsed.get("scene_context") or "").strip()[:300],
        "register": (parsed.get("register") or "").strip()[:40],
        "speakers": speakers,
    }


def _format_speaker_anchor_block(relationships: dict) -> str:
    """Format Pass-1 result thành ANCHOR block cho Pass-2 prompt."""
    if not relationships or not relationships.get("speakers"):
        return ""

    lines = [
        "═══════════════════════════════════════════════════════════════",
        "🎯 SPEAKER MAP — ANCHOR BẮT BUỘC TUÂN THEO (từ Pass-1 analysis):",
    ]

    ctx = relationships.get("scene_context")
    if ctx:
        lines.append(f"   Bối cảnh: {ctx}")
    reg = relationships.get("register")
    if reg:
        lines.append(f"   Register: {reg}")
    lines.append("")

    for spk_id, info in relationships["speakers"].items():
        g = info.get("gender", "unsure")
        role = info.get("role", "unknown")
        self_p = info.get("self_pronoun", "tôi")
        addr = info.get("addresses", {})
        tpl = info.get("third_person_label", "")
        parts = [f'   • {spk_id} ({role}, {g}): tự xưng "{self_p}"']
        if addr:
            addr_str = ", ".join(f'(vocative) gọi {k} là "{v}"' for k, v in addr.items())
            parts.append(addr_str)
        if tpl:
            parts.append(f'(ngôi 3) khi nhắc tới → "{tpl}"')
        lines.append(" — ".join(parts))

    lines.append("")
    lines.append("⚠️ TUYỆT ĐỐI dùng đúng cách xưng hô trên cho MỖI speaker.")
    lines.append("⚠️ KHÔNG đổi xưng hô giữa scene.")
    lines.append("⚠️ Khi nói VỚI người này (你): dùng vocative (addresses).")
    lines.append("⚠️ Khi nói VỀ người này cho người khác (他/她): dùng third_person_label.")
    lines.append("═══════════════════════════════════════════════════════════════")
    return "\n".join(lines)


def _per_segment_anchor(seg: dict, relationships: dict) -> str:
    """Format anchor cho 1 segment dựa trên Pass-1 result."""
    if not relationships or not relationships.get("speakers"):
        return ""
    spk = seg.get("speaker")
    if not spk:
        return ""
    info = (relationships["speakers"] or {}).get(spk)
    if not info:
        return ""
    self_p = info.get("self_pronoun", "")
    addr = info.get("addresses") or {}
    if not self_p:
        return ""
    if addr:
        addr_str = "/".join(f"{k.replace('SPEAKER_', 'SPK')}={v}" for k, v in addr.items())
        return f'xưng "{self_p}", gọi {addr_str}'
    return f'xưng "{self_p}"'


def build_translation_prompt(
    *,
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    context_before: Optional[list[dict]] = None,
    topic_hint: Optional[str] = None,
    glossary_block: Optional[str] = None,
    speaker_genders: Optional[dict] = None,
    speaker_relationships: Optional[dict] = None,
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
    # Ưu tiên speaker_relationships (Pass-1 result) → anchor mạnh nhất
    # Fallback speaker_genders → pronoun hint theo gender
    has_relationships = bool(speaker_relationships and speaker_relationships.get("speakers"))
    has_speakers = bool(speaker_genders) and any(seg.get("speaker") for seg in segments)
    seg_lines = []
    for seg in segments:
        text = (seg.get("original_text") or "").strip()
        if not text:
            continue
        budget = _max_chars(seg)

        if has_relationships and seg.get("speaker"):
            anchor = _per_segment_anchor(seg, speaker_relationships)
            if anchor:
                prefix = f'[{seg["speaker"]}: {anchor}, max {budget} chars]'
            else:
                prefix = f'[{seg["speaker"]}, max {budget} chars]'
        elif has_speakers and seg.get("speaker"):
            spk = seg["speaker"]
            g = (speaker_genders or {}).get(spk, "unknown")
            pronoun_hint = _pronoun_hint_for_gender(g)
            if pronoun_hint:
                prefix = f'[{spk}, {g}, {pronoun_hint}, max {budget} chars]'
            else:
                prefix = f'[{spk}, {g}, max {budget} chars]'
        else:
            prefix = f'[max {budget} chars]'

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

    # SPEAKER MAP anchor block (từ Pass-1) — đặt lên ĐẦU system prompt
    # để LLM thấy NGAY TRƯỚC mọi rule khác. Đây là rule MẠNH NHẤT.
    speaker_anchor_block = ""
    if has_relationships:
        speaker_anchor_block = "\n" + _format_speaker_anchor_block(speaker_relationships) + "\n"

    # System message — đặt 3 LỖI HAY GẶP lên đầu (sau SPEAKER MAP) vì
    # đây là chỗ LLM hay sai nhất. Ví dụ cụ thể từ test thực tế.
    system = f"""Bạn là dịch giả phim chuyên nghiệp 10+ năm cho VTV/HTV.
NHIỆM VỤ: dịch lời thoại từ {src_name} → {tgt_name} cho lồng tiếng/phụ đề.
{speaker_anchor_block}
═══════════════════════════════════════════════════════════════
🚨 3 LỖI XƯNG HÔ HAY GẶP — TUYỆT ĐỐI TRÁNH
═══════════════════════════════════════════════════════════════

🔴 LỖI #1 — DỊCH VOCATIVE-TAIL LITERAL (cuối câu gọi "chồng/vợ/bé")

   Tiếng Trung có thói quen ĐẶT từ xưng hô CUỐI CÂU (vocative tail):
   "你今天加班吗 老公?" — chữ "老公" cuối là cách VỢ gọi CHỒNG.

   ❌ SAI: "Hôm nay anh tăng ca à, chồng?" (dịch chữ "老公" thành "chồng")
   ✅ ĐÚNG: "Hôm nay anh tăng ca à, anh?" (dùng pronoun từ SPEAKER MAP)
            HOẶC: "Hôm nay anh tăng ca à?" (bỏ tail nếu thừa)

   BẢNG MAPPING vocative-tail (Trung → Việt):
   • 老公 → "anh" / "anh ơi" (vợ gọi chồng)
   • 老婆 → "em" / "em ơi" (chồng gọi vợ)
   • 亲爱的 → "anh"/"em"/"cưng" (theo SPEAKER MAP)
   • 宝贝 (cha/mẹ gọi con) → "con yêu"/"cục cưng"/"con"
   • 宝贝 (yêu nhau) → "em yêu"/"anh yêu"
   • 哥/哥哥 (gọi anh) → "anh"
   • 姐/姐姐 (gọi chị) → "chị"
   • 妈/娘 → "mẹ"/"má"
   • 爹/爸 → "bố"/"ba"

🔴 LỖI #2 — 他/她 (ĐẠI TỪ THỨ 3) DÙNG SAI NHƯ VOCATIVE

   他/她/它/他们 = ĐẠI TỪ NGÔI 3 (he/she/it/they) — khác hoàn toàn
   với 你/你们 = NGÔI 2 (you).

   Khi vợ NÓI VỚI chồng VỀ CON: "他想你" — "他" là NGÔI 3 (chỉ con).
   SPEAKER MAP nói "vợ gọi con là bé" — đây là VOCATIVE (vợ nói TRỰC TIẾP
   với con). Khi vợ nói VỀ con cho chồng → KHÔNG dùng vocative "bé".

   ❌ SAI: "他想你" → "bé nhớ anh" (sai — dùng vocative cho 3rd-person)
   ✅ ĐÚNG: "他想你" → "con nhớ anh" (3rd-person dùng từ vai trò)

   QUY TẮC:
   • 你 (ngôi 2) → dùng từ SPEAKER MAP "addresses[target]"
     VD: vợ gọi chồng "你 hôm nay..." → "anh hôm nay..."
   • 他/她 (ngôi 3) → dùng từ VAI TRÒ của người được nhắc
     - 他 = con → "con" / "thằng bé" / "nó"
     - 他 = anh/chú/chồng-người-khác → "anh ấy"
     - 她 = mẹ/chị/cô → "cô ấy" / "bà ấy" / "chị ấy"
   • PHÂN BIỆT: "你来" (ngôi 2) vs "他来" (ngôi 3) khác hoàn toàn!

🔴 LỖI #3 — TÊN THÂN MẬT (小X/阿X/大X) DỊCH THÀNH "nhóc"/"bé"/"con yêu"

   Trong tiếng Trung, prefix 小/阿/大 + tên = TÊN THÂN MẬT, đây là
   DANH TỪ RIÊNG (tên gọi), KHÔNG phải nickname chung chung.

   ❌ SAI hoàn toàn:
   • 小宝 → "nhóc" / "bé" / "con yêu" / "cục cưng" (dùng pronoun chung)
   • 我想小宝 → "Anh nhớ con" (mất tên 小宝)

   ✅ ĐÚNG:
   • 小宝 → "Tiểu Bảo" (Hán-Việt, giữ là TÊN)
   • 我想小宝 → "Anh nhớ Tiểu Bảo"
   • 小宝 爸爸抱抱 → "Tiểu Bảo, ba ôm cái nào!"

   ⚡ RULE TUYỆT ĐỐI:
   Nếu CÂU GỐC chứa chữ 小X / 阿X / 大X / 老X (X là 1 chữ Hán) →
   OUTPUT BẮT BUỘC phải có "Tiểu X" / "A X" / "Đại X" / "Lão X".
   KHÔNG được thay bằng từ trong "addresses" của SPEAKER MAP.
   "addresses" chỉ áp dụng khi câu gốc dùng 你/anh/em chung — KHÔNG khi
   gốc dùng TÊN cụ thể.

   QUY TẮC PHIÊN ÂM:
   • 小X → "Tiểu X" (小宝 → Tiểu Bảo, 小明 → Tiểu Minh, 小红 → Tiểu Hồng)
   • 阿X → "A X" (阿强 → A Cường, 阿珍 → A Trân)
   • 大X → "Đại X" (大牛 → Đại Ngưu, 大伟 → Đại Vĩ)
   • 老X (gọi người lớn tuổi) → "Lão X" (老王 → Lão Vương)

   NGOẠI LỆ (KHÔNG apply rule, vì là từ chung):
   • 小孩 = đứa trẻ (không phải tên)
   • 小姐 = cô / tiểu thư (tước vị)
   • 小心 = cẩn thận (động từ)
   • 小时 = giờ (đơn vị thời gian)
   • 大家 = mọi người (không phải tên)
   • 大概 = đại khái
   • 老板 = sếp / ông chủ
   • 老婆/老公 = vợ/chồng (xem LỖI #1)

═══════════════════════════════════════════════════════════════
📏 TIMING BUDGET — BẮT BUỘC TUÂN THỦ
═══════════════════════════════════════════════════════════════

Mỗi line có `[max N chars]` = số ký tự TỐI ĐA cho dub đúng nhịp.
• Tiếng Việt thường dài hơn Trung 30% nếu literal → vượt slot → dub dồn.
• Phải RÚT GỌN: cắt filler ("thì là", "vậy đó"), dùng từ ngắn.
• Ưu tiên: ý chính > nuance > literal completeness.
• HARD RULE: KHÔNG vượt max N chars cho bất kỳ line nào.

═══════════════════════════════════════════════════════════════
🔤 TÊN RIÊNG NHÂN VẬT
═══════════════════════════════════════════════════════════════
{_name_translation_rule(source_lang)}
═══════════════════════════════════════════════════════════════
🎬 GENRE / REGISTER
═══════════════════════════════════════════════════════════════
{genre_block if genre_block else '''
   Đọc context để chọn xưng hô (nếu Pass-1 chưa cover):
   • Vợ chồng / yêu nhau: "anh/em" — KHÔNG "tôi/bạn"
   • Mẹ-con: "mẹ/con". Cha-con: "ba|bố|cha/con"
   • Anh-chị-em ruột: theo tuổi
   • Bạn thân: "tao/mày" hoặc "tớ/cậu"
   • Đồng nghiệp: "tôi/anh", "tôi/chị"
   • Cổ trang: "ta/nàng/chàng/khanh/trẫm/thiếp"
   • Người LẠ: "tôi/bạn"
'''}
═══════════════════════════════════════════════════════════════
📦 ANCHOR ENTITIES — TỪ KHOÁ BẮT BUỘC GIỮ
═══════════════════════════════════════════════════════════════
   Các từ KEY trong gốc PHẢI xuất hiện trong dịch:
   • Vật dụng: 钻石→kim cương, 婚戒→nhẫn cưới, 戒指→nhẫn, 手机→điện thoại
   • Quan hệ: 妈妈→mẹ, 爸爸→ba/bố, 姐姐→chị, 老板→sếp/ông chủ
   • Ăn uống: 咖啡→cà phê, 牛奶→sữa, 果汁→nước trái cây

═══════════════════════════════════════════════════════════════
✍️ STYLE — VIẾT NHƯ DỊCH GIẢ VTV
═══════════════════════════════════════════════════════════════
   • Mượt như phim truyền hình — KHÔNG word-by-word literal
   • Match emotion: angry→gắt, whisper→nhỏ, happy→tươi, sad→buồn
   • Tiếng Việt tự nhiên: chêm "nhé/à/vậy/đấy" hợp ngữ cảnh
   • Bỏ chủ ngữ rườm rà nếu nghĩa vẫn rõ
{extra_block}{context_section}
═══════════════════════════════════════════════════════════════
🎯 SELF-VERIFY GENDER (tự kiểm tra giới tính speaker)
═══════════════════════════════════════════════════════════════
   Pipeline đoán gender qua F0 pitch — có thể sai. LLM check lại từ context:
   • Tự xưng "bố/cha/anh/ông" → male
   • Tự xưng "mẹ/má/chị/cô" → female
   • Người khác gọi "anh ơi" → male; "em ơi/chị ơi" → female
   Output kèm "speaker_genders" — backend sẽ override pipeline nếu rõ.

═══════════════════════════════════════════════════════════════
📤 OUTPUT — JSON SCHEMA BẮT BUỘC
═══════════════════════════════════════════════════════════════
EMOTION TAGS hợp lệ: neutral, happy, sad, angry, whisper, surprised, fearful

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
• "speech": tối ưu TTS — thêm "..." giữa cụm cho ngắt nhịp tự nhiên
• "emotion": 1 trong 7 tag trên
• "speaker_genders": với MỖI SPKx, gender + evidence ngắn

CHECKLIST trước khi xuất:
[ ] Mọi line ≤ max_chars?
[ ] Theo SPEAKER MAP (xưng hô đúng)?
[ ] Không dịch literal vocative-tail (老公→anh, không phải "chồng")?
[ ] 他/她 (ngôi 3) dùng vai trò, không phải vocative?
[ ] Tên 小X/阿X → Tiểu X/A X (không phải "nhóc")?
[ ] Anchor entities đầy đủ?
[ ] speaker_genders đủ mọi SPKx?
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
