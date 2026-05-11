"""Prompt builders cho dịch phim — kiến trúc 3-pass.

Pass-0 (analyze):  Đọc transcript → output JSON speaker relationships.
                   Skip nếu chỉ 1 speaker.
Pass-1 (translator): Dịch literal nhưng ĐÚNG pronoun + Hán-Việt + budget.
                     Prompt ngắn, chỉ tập trung accuracy. Output JSON.
Pass-2 (editor):   Nhận literal translation → polish thành film style.
                   Prompt chỉ về style, KHÔNG lo pronoun (translator đã làm).
                   Few-shot examples mạnh.

Tách concerns → prompt mỗi pass ngắn → LLM follow chuẩn hơn + không hang
+ dễ tune từng pass riêng biệt.

Public API:
  Pass-0:
    build_speaker_analysis_prompt(segments, source_lang) → {system, user}
    parse_speaker_analysis(text) → relationships dict

  Pass-1:
    build_translator_prompt(segments, target, source, relationships) → {system, user}
    parse_translator_response(text, n) → list[dict]

  Pass-2:
    build_editor_prompt(items, target, relationships) → {system, user}
    parse_editor_response(text, n) → list[dict]
"""
from __future__ import annotations

import json
import re
from typing import Optional


# ═══════════════════════════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════════════════════════

VN_SPEECH_RATE = 11.5  # chars/s — Việt thoải mái, ép xuống để dub có headroom


def _max_chars(seg: dict) -> int:
    """Budget chars cho seg dựa trên duration."""
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


def _name_translation_rule(source_lang: Optional[str]) -> str:
    """Tên riêng convention theo source language."""
    src = (source_lang or "").lower().strip()
    if src in ("zh", "chinese", "zh-cn", "zh-tw", "mandarin"):
        return """TÊN RIÊNG (zh → vi): PHIÊN ÂM HÁN-VIỆT.
   • 文汐 → Văn Tịch, 商奕 → Thương Dịch, 慕容 → Mộ Dung
   • Họ: 张→Trương, 王→Vương, 李→Lý, 林→Lâm, 陈→Trần
   • Tên thân mật: 小X→Tiểu X (小宝→Tiểu Bảo), 阿X→A X, 大X→Đại X
   • Tước vị: 陛下→Bệ hạ, 殿下→Điện hạ, 公子→Công tử, 小姐→Tiểu thư
   • TUYỆT ĐỐI KHÔNG để pinyin ra output."""
    if src in ("ko", "korean", "kor"):
        return """TÊN RIÊNG (ko → vi): PHIÊN ÂM HÁN-VIỆT.
   VD: 이민호 → Lý Mẫn Hạo, 김태희 → Kim Thái Hi."""
    if src in ("ja", "japanese", "jpn"):
        return """TÊN RIÊNG (ja → vi): GIỮ Romaji nguyên dạng.
   VD: 田中 → Tanaka, 桜 → Sakura."""
    return "TÊN RIÊNG: GIỮ NGUYÊN (Tom → Tom, Marie → Marie)."


def _parse_json_robust(text: str) -> Optional[dict]:
    """Parse JSON robust với markdown wrapper, partial."""
    text = (text or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


# ═══════════════════════════════════════════════════════════════
# Pass-0: Speaker Analysis
# ═══════════════════════════════════════════════════════════════

def build_speaker_analysis_prompt(
    *,
    segments: list[dict],
    source_lang: str,
    film_genre: Optional[str] = None,
    visual_context: Optional[dict] = None,
    max_lines: int = 200,
) -> dict:
    """Pass-0: phân tích quan hệ giữa SPEAKER_XX → JSON map.

    Nếu có visual_context (từ VLM Pass-(-1)) → inject làm GROUND TRUTH.
    LLM dùng để confirm gender + role thay vì đoán từ text alone.
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
        genre_hint = f"\n• Thể loại detect: {film_genre} → pick register phù hợp.\n"

    # Visual context block (nếu có) — đặt lên đầu prompt làm anchor mạnh
    visual_block = ""
    if visual_context:
        visual_block = "\n" + format_visual_context_for_audio_analyze(visual_context) + "\n"

    system = f"""Bạn là chuyên gia phân tích kịch bản phim. Đọc hội thoại từ {src_name}
và XÁC ĐỊNH QUAN HỆ giữa các SPEAKER.
{visual_block}

NHIỆM VỤ với MỖI speaker:
• character_name — TÊN THẬT nếu detect được trong text (KHÔNG phải SPEAKER_XX)
  Hán-Việt theo source: 叶辰→"Diệp Thần", 秦夏→"Tần Hạ", 林从安→"Lâm Tòng An"
  Detect từ vocative trong dialogue: "Diệp Thần, anh đừng..." → speaker đó tên Diệp Thần
  Nếu không detect được → để rỗng ""
• gender (male/female/unsure)
• age (child/adult/elder) — đoán theo lời thoại
  VD: xưng "con" + gọi "mẹ/ba" → child; xưng "anh/em" + nói chuyện vợ chồng → adult;
      gọi "cụ/ông cụ" → elder
• role (chồng/vợ/cha/mẹ/con gái/con trai/sếp/bạn/đồng nghiệp/trợ lý/...)
• self_pronoun — cách họ tự xưng (anh/em/tôi/ba/mẹ/con/ta/thiếp...)
• addresses — vocative khi nói TRỰC TIẾP (你) với mỗi speaker khác
• third_person_label — khi NGƯỜI KHÁC nhắc tới speaker này ở NGÔI 3 (他/她)
  VD: con trai → "con"/"thằng bé"; chồng → "anh ấy"; sếp → "ông ấy"

EVIDENCE để suy:
• Tự gọi "anh/bố/ba/chồng/ông" → NAM; "em/mẹ/má/vợ/chị/cô" → NỮ
• Người khác gọi "anh ơi/cậu ơi/sếp ơi" → NAM; "em ơi/chị ơi" → NỮ

⚠️ scene_context CỰC QUAN TRỌNG — đặc biệt RELATIONSHIP STATUS của cặp đôi:
   • Vợ chồng bình thường → pronoun "anh/em"
   • Vợ chồng đang LY HÔN / xung đột → có thể "tôi/cô" (lạnh nhạt) — TRUST context
   • Con cái yêu cha mẹ → "bố/mẹ" + xưng "con"
   • Con cái ghét cha mẹ tột độ → có thể "ông/bà" (hạ vai thành người dưng)
   → KHÔNG cứng nhắc rule pronoun, để LLM Pass-1/2 đọc context → pick phù hợp

⚠️ TUYỆT ĐỐI ra TIẾNG VIỆT cho self_pronoun/addresses/third_person_label.
KHÔNG để chữ Trung gốc (在下, 寡人, 郡主...) trong output JSON.

🔤 BẢNG DỊCH HÁN-VIỆT (CỔ TRANG):
   Tự xưng:
   • 在下/晚辈 → "tại hạ"
   • 寡人/朕 → "trẫm" (vua)
   • 本宫 → "bổn cung" (hoàng hậu/quý phi)
   • 微臣/臣 → "thần" (quan với vua)
   • 儿臣 → "nhi thần" (hoàng tử với vua)
   • 臣弟 → "thần đệ"
   • 妾身/臣妾 → "thiếp" (phi/vợ với chồng cổ trang)
   • 我 (cổ trang) → "ta"
   Gọi người khác:
   • 郡主 → "quận chúa"
   • 公主 → "công chúa"
   • 公子 → "công tử"
   • 小姐 → "tiểu thư"
   • 父皇/父王 → "phụ hoàng"
   • 母后 → "mẫu hậu"
   • 皇兄/皇弟 → "hoàng huynh/đệ"
   • 王爷 → "vương gia"
   • 殿下 → "điện hạ" (thái tử/hoàng tử)
   • 陛下 → "bệ hạ" (vua)
   • 大人 → "đại nhân"
   • 先生 → "tiên sinh"
   • 爹/爹爹 → "cha"
   • 娘 → "mẹ"

🔤 BẢNG DỊCH (HIỆN ĐẠI):
   Tự xưng: 我 → "tôi"/"anh"/"em"/"ta"/"tao" (theo context)
   Gọi:
   • 老公 → "anh" (vợ gọi chồng)
   • 老婆 → "em" (chồng gọi vợ)
   • 爸爸/爸 → "ba"/"bố"
   • 妈妈/妈 → "mẹ"/"má"
   • 哥/哥哥 → "anh"
   • 姐/姐姐 → "chị"
   • 弟弟/妹妹 → "em"
   • 宝贝 → "con yêu"/"em"

CẢNH BÁO:
❌ "Con" KHÔNG dùng giữa vợ chồng. Cha/mẹ tự xưng "ba/mẹ" (KHÔNG "con").
❌ Cha/mẹ gọi con "con" (vocative). Con tự xưng "con", gọi cha mẹ "ba/mẹ".
{genre_hint}
OUTPUT JSON duy nhất:
{{
  "scene_context": "Vợ chồng đang LY HÔN — vợ đã chuẩn bị giấy ly hôn, muốn cưới người khác. Con gái bị tẩy não, ghét cha. Chồng quyết định ra trận.",
  "register": "modern/cổ trang/business/family",
  "speakers": {{
    "SPEAKER_00": {{
      "character_name": "Diệp Thần",
      "age": "adult",
      "gender": "male", "role": "chồng", "self_pronoun": "tôi/anh (tuỳ tone)",
      "addresses": {{"SPEAKER_01": "cô/em (tuỳ tone)", "SPEAKER_02": "con"}},
      "third_person_label": "anh ấy",
      "evidence": "Line 8: 'bố không bắt nạt chú Lâm'"
    }},
    "SPEAKER_02": {{
      "character_name": "Nguyệt Nhi",
      "age": "child",
      "gender": "female", "role": "con gái",
      "self_pronoun": "con",
      "addresses": {{"SPEAKER_01": "mẹ", "SPEAKER_00": "bố/ông (giận → ông)"}},
      "third_person_label": "con bé",
      "evidence": "Line 1: 'Mẹ ơi, con muốn...'"
    }}
  }}
}}

QUY TẮC: mỗi SPEAKER có 1 entry, tiếng Việt, không đủ evidence → "unsure".
character_name + age là field bắt buộc. age default = "adult" nếu không chắc.
"""
    user_input = "HỘI THOẠI:\n\n" + "\n".join(sample_lines)
    return {"system": system, "user": user_input}


def parse_speaker_analysis(response_text: str) -> dict:
    """Parse Pass-0 JSON output."""
    parsed = _parse_json_robust(response_text)
    if not isinstance(parsed, dict):
        return {}
    speakers_raw = parsed.get("speakers") or {}
    if not isinstance(speakers_raw, dict):
        return {}

    valid_genders = {"male", "female", "unsure", "unknown"}
    valid_ages = {"child", "adult", "elder"}
    speakers = {}
    for spk_id, info in speakers_raw.items():
        if not isinstance(info, dict):
            continue
        g = (info.get("gender") or "unsure").lower().strip()
        if g not in valid_genders:
            g = "unsure"
        age = (info.get("age") or "adult").lower().strip()
        if age not in valid_ages:
            age = "adult"
        addr = info.get("addresses") or {}
        if not isinstance(addr, dict):
            addr = {}
        speakers[spk_id] = {
            "character_name": (info.get("character_name") or "").strip()[:40],
            "age": age,
            "gender": g,
            "role": (info.get("role") or "unknown").strip()[:40],
            "self_pronoun": (info.get("self_pronoun") or "tôi").strip()[:40],
            "addresses": {k: str(v).strip()[:40] for k, v in addr.items() if v},
            "third_person_label": (info.get("third_person_label") or "").strip()[:30],
            "evidence": (info.get("evidence") or "").strip()[:200],
        }
    return {
        "scene_context": (parsed.get("scene_context") or "").strip()[:300],
        "register": (parsed.get("register") or "").strip()[:40],
        "speakers": speakers,
    }


def _format_speaker_anchor_block(relationships: dict) -> str:
    """Format speaker map thành text block cho prompt.

    Bao gồm character_name + age + pronoun guidance + scene_context
    để Pass-1/2 đọc và pick pronoun theo CONTEXT (không cứng nhắc rule).
    """
    if not relationships or not relationships.get("speakers"):
        return ""
    lines = ["🎯 SPEAKER MAP (đọc kỹ context trước khi pick pronoun):"]
    ctx = relationships.get("scene_context")
    reg = relationships.get("register")
    if ctx:
        lines.append(f"   📌 Bối cảnh: {ctx}")
    if reg:
        lines.append(f"   📌 Register: {reg}")
    lines.append("")
    for spk_id, info in relationships["speakers"].items():
        name = info.get("character_name") or ""
        role = info.get("role", "?")
        g = info.get("gender", "?")
        age = info.get("age", "adult")
        self_p = info.get("self_pronoun", "tôi")
        addr = info.get("addresses", {})
        tpl = info.get("third_person_label", "")

        label = f'{spk_id}'
        if name:
            label += f' ({name})'
        label += f' [{role}, {g}, {age}]'

        parts = [f'   • {label}: xưng "{self_p}"']
        if addr:
            parts.append("(với) " + ", ".join(f'{k}→"{v}"' for k, v in addr.items()))
        if tpl:
            parts.append(f'(ngôi 3)→"{tpl}"')
        lines.append(" | ".join(parts))
    lines.append("")
    lines.append("⚠️ 你 (ngôi 2) → vocative trong addresses. 他/她 (ngôi 3) → third_person_label.")
    lines.append("⚠️ TIN context — xung đột/ly hôn → pronoun có thể lạnh hơn (tôi/cô).")
    lines.append("⚠️ KHÔNG cứng nhắc rule — đọc context để pick phù hợp emotion.")
    return "\n".join(lines)


# Vocative-only markers (Trung) — terms of direct address.
# CHỈ tính khi marker ở ĐẦU hoặc CUỐI câu (vocative position).
# Mention ở giữa câu (儿子 trong "你不管儿子") KHÔNG tính.
_VOCATIVE_MARKERS = {
    # Vợ chồng
    "老公": ["chồng", "anh", "ông xã"],
    "夫君": ["chồng", "chàng"],
    "相公": ["chồng", "chàng"],
    "老婆": ["vợ", "em", "bà xã"],
    "媳妇": ["vợ", "em"],
    "夫人": ["vợ", "phu nhân"],
    "太太": ["vợ", "bà"],
    # Cha mẹ
    "爸爸": ["ba", "bố", "cha"],
    "爸": ["ba", "bố", "cha"],
    "爹": ["ba", "cha"],
    "老爸": ["ba", "bố"],
    "父亲": ["cha", "phụ thân"],
    "妈妈": ["mẹ", "má"],
    "妈": ["mẹ", "má"],
    "娘": ["mẹ"],
    "老妈": ["mẹ", "má"],
    "母亲": ["mẹ", "mẫu thân"],
    # Anh chị em
    "哥哥": ["anh"],
    "哥": ["anh"],
    "大哥": ["anh", "anh cả"],
    "姐姐": ["chị"],
    "姐": ["chị"],
    "大姐": ["chị", "chị cả"],
    "弟弟": ["em"],
    "妹妹": ["em"],
    # Con/em yêu (cha mẹ gọi con, vợ chồng gọi nhau)
    "宝贝": ["con", "em", "cục cưng"],  # parent→child OR lovers
    "宝宝": ["con", "em"],
    "小宝贝": ["con", "em yêu"],
    # Sếp / khác
    "老板": ["sếp", "ông chủ"],
    "老师": ["thầy", "cô"],
    "师父": ["sư phụ"],
    "陛下": ["bệ hạ"],
    "殿下": ["điện hạ"],
}


def _detect_vocative_pronouns(text: str) -> list[str]:
    """Trả list pronoun Việt có thể dùng cho 你 trong text.

    Vocative thường ở vị trí ĐẶC BIỆT:
    - Đầu câu (老公...)
    - Cuối câu (...老公?)
    - Sau dấu phẩy / sau từ cảm thán (对啊 老婆 ..., 对啊, 老婆)
    Mention ở giữa câu (你不管儿子) KHÔNG tính.
    """
    if not text:
        return []
    t = text.strip()
    matches = []
    sorted_markers = sorted(_VOCATIVE_MARKERS.keys(), key=len, reverse=True)
    seen = set()

    for marker in sorted_markers:
        if marker in seen:
            continue
        pronouns = _VOCATIVE_MARKERS[marker]
        m_esc = re.escape(marker)
        is_vocative = False

        # 1. Đầu câu
        if t.startswith(marker):
            is_vocative = True
        # 2. Cuối câu (với optional particle/punctuation)
        elif re.search(rf"{m_esc}\s*[啊呀吧呢哦]?\s*[?!。，,.…]?\s*$", t):
            is_vocative = True
        # 3. Sau dấu cách + sau từ cảm thán/đồng ý (对啊 老婆, 嗯 妈妈, 哎 哥)
        elif re.search(
            rf"(^|[，,。.！!？?\s])(?:对啊|对|嗯|哎|呃|啊|哦|喂|是)\s+{m_esc}(?=[\s，,。.！!？?]|$)",
            t,
        ):
            is_vocative = True

        if is_vocative:
            matches.extend(pronouns)
            seen.add(marker)

    # Tên thân mật 小X / 阿X ở đầu câu HOẶC cuối câu (gọi con/em)
    if re.match(r"^[小阿][一-龥][\s，,]", t) or re.search(r"[\s，,][小阿][一-龥]\s*[?!。，,.…]?\s*$", t):
        if "con" not in matches:
            matches.append("con")

    # Dedup giữ thứ tự
    dedup = []
    seen2 = set()
    for m in matches:
        if m not in seen2:
            seen2.add(m)
            dedup.append(m)
    return dedup


def _resolve_addressee(
    speaker_id: str,
    relationships: dict,
    text: str,
) -> Optional[tuple[str, str]]:
    """Tìm (addressee_spk_id, pronoun) cho 你 trong text.

    Match vocative trong text với addresses của speaker → tìm chính xác
    addressee nào. Returns None nếu không resolve được.
    """
    speakers = relationships.get("speakers", {})
    own = speakers.get(speaker_id, {})
    addresses = own.get("addresses", {})
    if not addresses:
        return None

    vocative_prons = _detect_vocative_pronouns(text)
    if not vocative_prons:
        return None

    # Match vocative pronoun với addresses values
    for vp in vocative_prons:
        for addr_spk, addr_pn in addresses.items():
            if vp.lower() == addr_pn.lower() or vp.lower() in addr_pn.lower():
                return (addr_spk, addr_pn)
    return None


def _per_segment_anchor(seg: dict, relationships: dict) -> str:
    """Anchor inline — PRE-RESOLVE 你 từ vocative trong text.

    Anchor format:
      [Vợ → Chồng | 我="em", 你="anh"]
    Đã resolve xong 你 → không cần LLM đoán. Còn 他/她 LLM tự xử lý theo
    third_person_label của speaker được nhắc.
    """
    if not relationships or not relationships.get("speakers"):
        return ""
    spk = seg.get("speaker")
    if not spk:
        return ""
    info = (relationships["speakers"] or {}).get(spk)
    if not info:
        return ""

    self_p = info.get("self_pronoun", "")
    role = info.get("role", "")
    name = info.get("character_name") or ""
    age = info.get("age", "")
    addr = info.get("addresses") or {}
    if not self_p:
        return ""

    text = (seg.get("original_text") or "").strip()
    resolved = _resolve_addressee(spk, relationships, text)

    speaker_label = role or spk
    if name:
        speaker_label = f"{name}({role})" if role else name
    if age and age != "adult":
        speaker_label += f"[{age}]"
    parts = [f'{speaker_label}: 我="{self_p}"']

    if resolved:
        target_id, target_pn = resolved
        target_role = relationships["speakers"].get(target_id, {}).get("role", "")
        parts.append(f'→ {target_role or target_id}: 你="{target_pn}"')
    elif len(addr) == 1:
        target_id, target_pn = next(iter(addr.items()))
        target_role = relationships["speakers"].get(target_id, {}).get("role", "")
        parts.append(f'→ {target_role or target_id}: 你="{target_pn}"')
    elif addr:
        addr_str = "; ".join(
            f'{relationships["speakers"].get(k, {}).get("role", k)}="{v}"'
            for k, v in addr.items()
        )
        parts.append(f'你 ∈ {{{addr_str}}}')

    return " | ".join(parts)


# ═══════════════════════════════════════════════════════════════
# Pass-1: TRANSLATOR — literal nhưng pronoun đúng + budget
# ═══════════════════════════════════════════════════════════════

def build_translator_prompt(
    *,
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    speaker_relationships: Optional[dict] = None,
    context_before: Optional[list[dict]] = None,
    topic_hint: Optional[str] = None,
    glossary_block: Optional[str] = None,
    film_genre: Optional[str] = None,
    engine: str = "gemini",
) -> dict:
    """Pass-1: dịch literal NHƯNG ĐÚNG pronoun + Hán-Việt + budget.

    KHÔNG lo style/emotion (Editor pass sẽ polish). Mục tiêu duy nhất:
    nghĩa đúng + pronoun đúng + tên riêng đúng + không vượt budget.
    """
    tgt_name = _lang_display_name(target_lang)
    src_name = _lang_display_name(source_lang)

    # Build seg lines với anchor
    has_rels = bool(speaker_relationships and speaker_relationships.get("speakers"))
    seg_lines = []
    for seg in segments:
        text = (seg.get("original_text") or "").strip()
        if not text:
            continue
        budget = _max_chars(seg)
        if has_rels and seg.get("speaker"):
            anchor = _per_segment_anchor(seg, speaker_relationships)
            prefix = f'[{seg["speaker"]}: {anchor}, max {budget} chars]' if anchor \
                     else f'[{seg["speaker"]}, max {budget} chars]'
        else:
            prefix = f'[max {budget} chars]'
        seg_lines.append(f'{seg["index"] + 1}. {prefix} {text}')

    anchor_block = ""
    if has_rels:
        anchor_block = "\n" + _format_speaker_anchor_block(speaker_relationships) + "\n"

    extra_block = ""
    if topic_hint:
        extra_block += f"\n📌 Topic: {topic_hint}\n"
    if glossary_block:
        extra_block += f"\n📖 Glossary:\n{glossary_block}\n"

    context_section = ""
    if context_before:
        ctx_lines = [f'  {c["index"]}. {c["original"]} → {c["translated"]}'
                     for c in context_before]
        context_section = "\nDIALOGUE TRƯỚC (chỉ tham khảo):\n" + "\n".join(ctx_lines)

    system = f"""Bạn là TRANSLATOR phim chuyên nghiệp. Dịch lời thoại {src_name} → {tgt_name}.

NHIỆM VỤ DUY NHẤT của Pass này:
1. Nghĩa ĐÚNG (không paraphrase quá xa, không bịa)
2. Pronoun ĐÚNG (theo SPEAKER MAP nếu có)
3. Tên riêng ĐÚNG (Hán-Việt)
4. KHÔNG vượt max_chars

KHÔNG cần lo style cinematic — Editor pass sẽ polish.
{anchor_block}
🎭 PRONOUN PHỤ THUỘC CONTEXT — CHỈ ĐỔI KHI scene_context RÕ RÀNG:

⚡ DEFAULT cho vợ chồng / yêu nhau: LUÔN "anh/em" (90% trường hợp).
   KHÔNG được tự ý đổi sang "tôi/cô" khi không có bằng chứng rõ.

CHỈ đổi sang "tôi/cô" / "tôi/anh" lạnh nhạt KHI scene_context CHỨA RÕ:
   • "ly hôn" / "ly thân" / "chuẩn bị giấy ly hôn"
   • "muốn cưới người khác" / "đã yêu người khác"
   • "căm thù" / "thù hận"
   • Speaker chính đang nói rõ: "tôi/cô" (không phải dịch giả tự thêm)
   Cãi vã thông thường (vợ chồng giận nhau, ghen tuông, hiểu lầm tạm thời)
   → VẪN dùng "anh/em" (cãi yêu cũng dùng anh/em, không lạnh đến mức tôi/cô).

🔹 Cha/mẹ ↔ con (tương tự):
   DEFAULT: con xưng "con", gọi "bố/mẹ"
   CHỈ "ông/bà" khi scene_context rõ: "con cực giận từ chối làm con",
   "đoạn tuyệt quan hệ", hoặc lời thoại con NÓI THẲNG ("không phải bố tôi").

🔹 NGUYÊN TẮC: theo SPEAKER MAP làm DEFAULT. KHÔNG override trừ khi
scene_context có keyword rõ ràng. KHÔNG được "đoán" emotion từ 1-2 câu cãi.

🚨 RULE MAPPING ĐẠI TỪ (CỰC QUAN TRỌNG — đọc kỹ TRƯỚC khi dịch):

Mỗi line có anchor `[Role: 我="X" | → Target: 你="Y"]`. Ý nghĩa:
   • 我/我们 trong gốc → DÙNG "X" (self_pronoun của speaker đang nói)
   • 你/你们 trong gốc → DÙNG "Y" (đã pre-resolve)
   • 他/她/它 trong gốc → DÙNG third_person_label của người đó (KHÔNG phải vocative)

Nếu anchor `你 ∈ {{role_a="X"; role_b="Y"}}` (chưa resolve được) → LLM tự
chọn theo context (xem vocative trong text, hoặc câu trước/sau).

❌ SAI HAY GẶP NHẤT — ĐẢO 我/你:
   Anchor [vợ: 我="em" | → chồng: 你="anh"], text "你今天又加班吗".
   你 trong câu chỉ CHỒNG (người được hỏi). → "anh", KHÔNG phải "em".

   ❌ "Hôm nay EM lại tăng ca à?"  ← SAI: dùng 我 mapping cho 你
   ✅ "Hôm nay ANH lại tăng ca à?" ← ĐÚNG: 你 → "anh"

   Ghi nhớ: 我 = NGƯỜI ĐANG NÓI (speaker), 你 = NGƯỜI ĐƯỢC HỎI/GỌI (addressee).
   KHÔNG ĐƯỢC ĐẢO. Mỗi line đọc lại anchor riêng.

📝 VÍ DỤ CỤ THỂ (anchor → output):

Anchor [vợ: 我="em" | → chồng: 你="anh"]:
   "我也想你"  → "Em cũng nhớ anh"           ← 我="em", 你="anh"
   "你回来了"  → "Anh về rồi"                ← 你="anh"
   "他想你"    → "Con nhớ anh"               ← 他→con, 你="anh"

Anchor [chồng: 我="anh" | → vợ: 你="em"]:
   "我也想小宝" → "Anh cũng nhớ Tiểu Bảo"    ← 我="anh", 小宝=Tiểu Bảo
   "你别担心"   → "Em đừng lo"                ← 你="em"
   "我带他去"   → "Anh đưa con đi"            ← 我="anh", 他→con

Anchor [con trai: 我="con" | → chồng: 你="ba"]:
   "爸爸 你回来了" → "Ba ơi, ba về rồi"      ← 你="ba" (vocative 爸爸 confirms)
   "我想跟你玩"   → "Con muốn chơi với ba"    ← 我="con", 你="ba"

🚨 3 LỖI XƯNG HÔ KHÁC — TUYỆT ĐỐI TRÁNH:

LỖI A: VOCATIVE-TAIL literal (老公→"chồng"). PHẢI: 老公→"anh" (theo MAP) hoặc bỏ.
   ❌ "Hôm nay anh tăng ca à, anh?" (lặp anh)
   ✅ "Hôm nay anh lại tăng ca à?" (1 chỗ)
   Mapping: 老公→anh, 老婆→em, 宝贝(con)→con, 哥→anh, 姐→chị, 妈→mẹ, 爸→ba

LỖI B: 他/她 (NGÔI 3) ≠ 你 (NGÔI 2). KHÔNG dùng vocative cho 3rd-person.
   ❌ "他想你" → "bé nhớ anh" (vocative "bé" cho 3rd-person)
   ✅ "他想你" → "con nhớ anh" (3rd-person dùng role/third_person_label)

LỖI C: 小X/阿X/大X = TÊN THÂN MẬT → Tiểu X/A X/Đại X (Hán-Việt).
   ❌ 小宝 → "nhóc"/"con yêu"; ✅ 小宝 → "Tiểu Bảo"
   RULE: gốc có 小X → output PHẢI có Tiểu X (override SPEAKER MAP addresses).
   NGOẠI LỆ: 小孩/小姐/小心/小时/老板/老婆/老公 = từ chung, KHÔNG apply.

📏 BUDGET: mỗi line có [max N chars] = số char TỐI ĐA. Cắt filler, từ ngắn.
   Việt dài hơn Trung ~30% nếu literal → phải rút gọn.

🔤 {_name_translation_rule(source_lang)}
{extra_block}{context_section}
OUTPUT JSON DUY NHẤT (không markdown):
{{
  "translations": [
    {{"index": 1, "translated": "...", "emotion": "neutral"}},
    {{"index": 2, "translated": "...", "emotion": "happy"}}
  ]
}}
• "translated": câu Việt đúng pronoun + ≤ max_chars
• "emotion": neutral/happy/sad/angry/whisper/surprised/fearful
"""

    user_input = "DIALOGUE CẦN DỊCH:\n" + "\n".join(seg_lines)
    return {"system": system, "user": user_input, "n_segments": len(segments)}


def parse_translator_response(response_text: str, n_segments: int) -> list[dict]:
    """Parse Pass-1 output → list[{translated_text, emotion}]."""
    results = [{"translated_text": "", "emotion": "neutral"} for _ in range(n_segments)]
    parsed = _parse_json_robust(response_text)
    if not parsed:
        return results

    items = []
    if isinstance(parsed, dict):
        items = parsed.get("translations") or parsed.get("data") or []
    elif isinstance(parsed, list):
        items = parsed
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
        emotion = (item.get("emotion") or "neutral").lower()
        if emotion not in valid_emotions:
            emotion = "neutral"
        if translated:
            results[idx] = {
                "translated_text": translated,
                "emotion": emotion,
            }
    return results


# ═══════════════════════════════════════════════════════════════
# Pass-2: EDITOR — polish literal → VTV film style
# ═══════════════════════════════════════════════════════════════

def build_editor_prompt(
    *,
    items: list[dict],
    target_lang: str,
    source_lang: str,
    speaker_relationships: Optional[dict] = None,
) -> dict:
    """Pass-2: polish literal translation thành lời thoại phim VTV.

    Args:
      items: list[{index, speaker, original, literal, max_chars, role?}]
      Còn lại để có context cho LLM polish.

    Output JSON: {"polished": [{"index", "translated", "emotion"}]}
    """
    tgt_name = _lang_display_name(target_lang)

    # Role lookup
    role_map = {}
    if speaker_relationships and speaker_relationships.get("speakers"):
        for spk_id, info in speaker_relationships["speakers"].items():
            role_map[spk_id] = info.get("role", "")

    register = ""
    scene = ""
    if speaker_relationships:
        register = speaker_relationships.get("register", "")
        scene = speaker_relationships.get("scene_context", "")

    # Build item lines: # | speaker(role) | original | literal | max
    item_lines = []
    for it in items:
        idx = it["index"]
        spk = it.get("speaker") or ""
        role = role_map.get(spk, "")
        spk_label = f"{spk}({role})" if role else (spk or "?")
        orig = (it.get("original") or "").strip()
        lit = (it.get("literal") or "").strip()
        max_c = it.get("max_chars", 50)
        item_lines.append(
            f"{idx + 1}. [{spk_label}, max {max_c}] gốc: {orig!r} | literal: {lit!r}"
        )

    scene_block = ""
    if scene or register:
        parts = []
        if scene:
            parts.append(f"Bối cảnh: {scene}")
        if register:
            parts.append(f"Register: {register}")
        scene_block = "\n".join("   " + p for p in parts) + "\n"

    system = f"""Bạn là EDITOR phim chuyên dub VTV — chuyển lời dịch literal thành
lời thoại phim CÓ HỒN, tự nhiên, biểu cảm.

INPUT: mỗi line có literal translation đã ĐÚNG nghĩa.
NHIỆM VỤ: polish thành câu PHIM thật — TỰ NHIÊN + CÓ CẢM XÚC + match emotion
với scene_context. CHO PHÉP đổi pronoun nếu literal sai emotion (ví dụ:
vợ chồng đang ly hôn mà literal dùng "anh/em" thân mật → đổi sang "tôi/cô" lạnh).

{scene_block}
🎭 PRONOUN THEO EMOTION — GIỮ literal pronoun làm DEFAULT:

⚡ KHÔNG TỰ Ý ĐỔI pronoun khỏi literal. Pass-1 đã pick đúng cho context.
Chỉ đổi nếu literal SAI emotion RÕ RÀNG (vd literal "anh/em" mà scene
context ghi rõ "ly hôn" — hiếm khi Pass-1 sai).

90% case: GIỮ NGUYÊN pronoun, chỉ polish style (thêm tiểu từ, đảo từ).

Cãi vã thường (vợ chồng yêu nhau cãi nhau, ghen tuông) → "anh/em" KHÔNG
đổi sang "tôi/cô". Vợ chồng phim tình cảm cãi nhau VẪN dùng "anh/em".


🎬 PATTERNS CẤM (literal hay gặp):
❌ "Đúng vậy"/"Đúng rồi" cho 对啊 → DÙNG: "Ừ"/"Phải rồi"/"Ờ"
❌ "Vâng" cho 嗯 → "Ừ" (thân mật), "Vâng ạ" (lễ phép)
❌ Pronoun trùng đầu+cuối: "anh ABC, anh?" → 1 chỗ thôi
❌ "Quá" lặp nhiều: "nhiều việc quá" → "nhiều việc lắm"
❌ Câu reo mừng mà phẳng: "Ba ơi, ba về rồi!" → "Ba! Ba về rồi à!"
❌ Ra lệnh thay vì mềm: "ba ôm cái nào!" → "lại đây ba ôm nào!"

🎭 NÊN DÙNG (Việt phim mượt):
• Tiểu từ cuối câu: nhỉ/thế/đấy/lắm/cơ/chứ/mà
   - "...nhỉ?" = soft question
   - "...thế?" = ngạc nhiên nhẹ
   - "...lắm/lắm đấy" = nhấn cảm xúc
   - "...cơ" = làm nũng/phản đối nhẹ
   - "...chứ" = confirmation
• Filler chuyển tone: "Thật ra...", "Đúng là...", "Hóa ra...", "Mà..."
• Ngôi 3: "anh ấy/cô ấy/nó" (Pass-1 đã đặt — KHÔNG đổi)
• Cảm thán: "ơi"/"à!"/"đấy!"/"rồi à!" thay vì câu phẳng

📝 VÍ DỤ TRƯỚC/SAU thực tế:

1. literal: "Hôm nay anh lại tăng ca à, anh?"
   polished: "Hôm nay anh lại tăng ca à?"

2. literal: "Đúng vậy, em. Công ty dạo này nhiều việc quá."
   polished: "Ừ em, dạo này công ty nhiều việc lắm."

3. literal: "Anh không quan tâm đến con nữa à? Con nhớ anh."
   polished: "Anh chẳng còn quan tâm đến con nữa, con nhớ anh lắm đấy."

4. literal: "Anh cũng nhớ Tiểu Bảo."
   polished: "Anh cũng nhớ Tiểu Bảo lắm."

5. literal: "Ba ơi, ba về rồi!"
   polished: "Ba! Ba về rồi à!"

6. literal: "Tiểu Bảo, ba ôm cái nào!"
   polished: "Tiểu Bảo, lại đây ba ôm nào!"

7. literal: "Ba ơi, con muốn chơi game với ba."
   polished: "Ba ơi, con muốn chơi game với ba cơ."

8. literal: "Cục cưng, ăn cơm trước nhé?"
   polished: "Cục cưng ơi, ăn cơm đã rồi chơi nhé."

🎯 NGUYÊN TẮC:
1. ĐỌC original + literal → cảm nhận emotion thực sự (vui/buồn/giận/làm nũng).
2. GIỮ pronoun y nguyên (Pass-1 đã chọn đúng).
3. GIỮ tên riêng y nguyên (Tiểu Bảo, Văn Tịch...).
4. KHÔNG vượt max_chars.
5. Polished phải gọn + có hồn + tự nhiên hơn literal.

OUTPUT JSON DUY NHẤT:
{{
  "polished": [
    {{"index": 1, "translated": "câu mượt", "emotion": "neutral"}},
    {{"index": 2, "translated": "câu reo", "emotion": "happy"}}
  ]
}}
"""
    user_input = f"DỊCH SANG {tgt_name} — LITERAL CẦN POLISH:\n\n" + "\n".join(item_lines)
    return {"system": system, "user": user_input, "n_items": len(items)}


def parse_editor_response(response_text: str, n_items: int) -> list[dict]:
    """Parse Pass-2 output → list[{translated_text, emotion}]."""
    results = [{"translated_text": "", "emotion": "neutral"} for _ in range(n_items)]
    parsed = _parse_json_robust(response_text)
    if not parsed:
        return results

    items = []
    if isinstance(parsed, dict):
        items = parsed.get("polished") or parsed.get("translations") or []
    elif isinstance(parsed, list):
        items = parsed
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
        if not (0 <= idx < n_items):
            continue
        translated = (item.get("translated") or item.get("polished") or "").strip()
        emotion = (item.get("emotion") or "neutral").lower()
        if emotion not in valid_emotions:
            emotion = "neutral"
        if translated:
            results[idx] = {
                "translated_text": translated,
                "emotion": emotion,
            }
    return results


# ═══════════════════════════════════════════════════════════════
# Pass (-1): VISUAL CONTEXT ANALYSIS (VLM)
# Đọc keyframe video → JSON {genre, register, characters, relationships}.
# Output feed Pass-0 audio analyze làm ground truth → giảm đoán mò.
# ═══════════════════════════════════════════════════════════════

def build_visual_context_prompt(
    *,
    source_lang: str = "auto",
    n_frames: int = 8,
) -> str:
    """Prompt cho VLM phân tích keyframe video → JSON context.

    KHÔNG có user message — VLM nhận frames + system prompt này.
    Returns raw prompt string (caller bundle với images).
    """
    src_name = _lang_display_name(source_lang)
    return f"""Bạn là chuyên gia phân tích phim. Xem {n_frames} keyframe từ video
(ngôn ngữ gốc: {src_name}) và XÁC ĐỊNH BỐI CẢNH để dub.

NHIỆM VỤ:
1. Genre + register (cổ trang/hiện đại/business/family/action/romcom...)
2. Danh sách nhân vật chính (mô tả ngắn, tuổi ước lượng, gender từ MẶT)
3. Quan hệ giữa nhân vật (cặp đôi/cha con/đồng nghiệp/...)
4. Trang phục/bối cảnh → register (formal/casual/cổ trang/...)

OUTPUT JSON DUY NHẤT (không markdown, không giải thích):
{{
  "genre": "modern_drama / cổ trang / business / family / action / romcom / ...",
  "register": "modern / cổ trang / business / casual / formal",
  "scene_summary": "1-2 câu mô tả bối cảnh + ai có mặt",
  "characters": [
    {{
      "id": "char_01",
      "description": "Phụ nữ ~30, áo trắng",
      "gender": "female",
      "estimated_age": "30s",
      "likely_role": "vợ / mẹ / cô / chị / ...",
      "appears_in_frames": [1, 3, 5]
    }}
  ],
  "relationships": [
    "char_01 và char_02 = vợ chồng (cảnh ôm/ăn cơm chung)",
    "char_03 = con của char_01 và char_02 (bé trai ~6 tuổi)"
  ]
}}

QUY TẮC:
• Gender đoán từ KHUÔN MẶT, KHÔNG đoán từ trang phục.
• Role là HYPOTHESIS — backend sẽ kết hợp với audio diarization để confirm.
• Nếu không đủ tự tin → gender = "unsure", role = "unknown".
• KHÔNG bịa scene không thấy trong frame.
"""


def parse_visual_context(response_text: str) -> dict:
    """Parse JSON từ VLM. Returns {} nếu fail."""
    parsed = _parse_json_robust(response_text)
    if not isinstance(parsed, dict):
        return {}

    characters = []
    for c in parsed.get("characters") or []:
        if not isinstance(c, dict):
            continue
        g = (c.get("gender") or "unsure").lower().strip()
        if g not in {"male", "female", "unsure", "unknown"}:
            g = "unsure"
        characters.append({
            "id": (c.get("id") or "").strip()[:20],
            "description": (c.get("description") or "").strip()[:200],
            "gender": g,
            "estimated_age": (c.get("estimated_age") or "").strip()[:20],
            "likely_role": (c.get("likely_role") or "").strip()[:40],
            "appears_in_frames": c.get("appears_in_frames") or [],
        })

    rels = parsed.get("relationships") or []
    if isinstance(rels, list):
        rels = [str(r).strip()[:200] for r in rels if r]
    else:
        rels = []

    return {
        "genre": (parsed.get("genre") or "").strip()[:40],
        "register": (parsed.get("register") or "").strip()[:40],
        "scene_summary": (parsed.get("scene_summary") or "").strip()[:400],
        "characters": characters,
        "relationships": rels,
    }


def format_visual_context_for_audio_analyze(visual_ctx: dict) -> str:
    """Format visual context thành text block inject vào Pass-0 audio analyze
    prompt. Pass-0 LLM sẽ dùng làm ground truth khi link với diarization.
    """
    if not visual_ctx:
        return ""
    lines = ["📹 VISUAL CONTEXT (từ VLM phân tích keyframe video — ground truth):"]
    if visual_ctx.get("genre"):
        lines.append(f"   Genre: {visual_ctx['genre']}")
    if visual_ctx.get("register"):
        lines.append(f"   Register: {visual_ctx['register']}")
    if visual_ctx.get("scene_summary"):
        lines.append(f"   Scene: {visual_ctx['scene_summary']}")
    if visual_ctx.get("characters"):
        lines.append("   Nhân vật detected:")
        for c in visual_ctx["characters"]:
            desc = f"     • {c['id']}: {c['description']} — gender={c['gender']}, role≈{c['likely_role']}"
            lines.append(desc)
    if visual_ctx.get("relationships"):
        lines.append("   Quan hệ detected:")
        for r in visual_ctx["relationships"]:
            lines.append(f"     • {r}")
    lines.append("⚠️ DÙNG visual context này để CONFIRM gender + role khi link SPEAKER_XX với character.")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# Retry addendum (dùng chung Pass-1/Pass-2 khi validate fail)
# ═══════════════════════════════════════════════════════════════

def build_retry_addendum(errors: list[dict]) -> str:
    """Feedback cụ thể cho LLM khi line cũ fail validation."""
    if not errors:
        return ""
    lines = ["", "⚠️ LẦN TRƯỚC CÓ LỖI — SỬA NGAY:"]
    for e in errors:
        idx = e["global_index"] + 1
        reasons = "; ".join(e["reasons"])
        prev = e.get("translated", "")
        lines.append(f"  • Line {idx}: {reasons}")
        if prev:
            lines.append(f"    Trước: {prev!r}")
    lines.append("Fix các line trên. KHÔNG lặp lỗi cũ.")
    lines.append("")
    return "\n".join(lines)
