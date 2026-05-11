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
    max_lines: int = 200,
) -> dict:
    """Pass-0: phân tích quan hệ giữa SPEAKER_XX → JSON map."""
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

    system = f"""Bạn là chuyên gia phân tích kịch bản phim. Đọc hội thoại từ {src_name}
và XÁC ĐỊNH QUAN HỆ giữa các SPEAKER.

NHIỆM VỤ với MỖI speaker:
• gender (male/female/unsure)
• role (chồng/vợ/cha/mẹ/con/sếp/bạn/đồng nghiệp/...)
• self_pronoun — cách họ tự xưng (anh/em/tôi/ba/mẹ/con/ta/thiếp...)
• addresses — vocative khi nói TRỰC TIẾP (你) với mỗi speaker khác
• third_person_label — khi NGƯỜI KHÁC nhắc tới speaker này ở NGÔI 3 (他/她)
  VD: con trai → "con"/"thằng bé"; chồng → "anh ấy"; sếp → "ông ấy"

EVIDENCE để suy:
• Tự gọi "anh/bố/ba/chồng/ông" → NAM; "em/mẹ/má/vợ/chị/cô" → NỮ
• Người khác gọi "anh ơi/cậu ơi/sếp ơi" → NAM; "em ơi/chị ơi" → NỮ

CẢNH BÁO:
❌ "Con" KHÔNG dùng giữa vợ chồng. Cha/mẹ tự xưng "ba/mẹ" (KHÔNG "con").
❌ Cha/mẹ gọi con "con" (vocative). Con tự xưng "con", gọi cha mẹ "ba/mẹ".
{genre_hint}
OUTPUT JSON duy nhất:
{{
  "scene_context": "1-2 câu mô tả",
  "register": "modern/cổ trang/business/family",
  "speakers": {{
    "SPEAKER_00": {{
      "gender": "male", "role": "chồng", "self_pronoun": "anh",
      "addresses": {{"SPEAKER_01": "em"}},
      "third_person_label": "anh ấy",
      "evidence": "Line 3: gọi vợ 'em'"
    }}
  }}
}}

QUY TẮC: mỗi SPEAKER có 1 entry, tiếng Việt, không đủ evidence → "unsure".
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
    """Format speaker map thành text block cho prompt."""
    if not relationships or not relationships.get("speakers"):
        return ""
    lines = ["🎯 SPEAKER MAP (BẮT BUỘC tuân theo):"]
    ctx = relationships.get("scene_context")
    reg = relationships.get("register")
    if ctx:
        lines.append(f"   Bối cảnh: {ctx}")
    if reg:
        lines.append(f"   Register: {reg}")
    lines.append("")
    for spk_id, info in relationships["speakers"].items():
        role = info.get("role", "?")
        g = info.get("gender", "?")
        self_p = info.get("self_pronoun", "tôi")
        addr = info.get("addresses", {})
        tpl = info.get("third_person_label", "")
        parts = [f'   • {spk_id} ({role}, {g}): tự xưng "{self_p}"']
        if addr:
            parts.append("(với) " + ", ".join(f'{k}→"{v}"' for k, v in addr.items()))
        if tpl:
            parts.append(f'(ngôi 3 nhắc tới)→"{tpl}"')
        lines.append(" | ".join(parts))
    lines.append("")
    lines.append("⚠️ 你 (ngôi 2) → vocative trong addresses.")
    lines.append("⚠️ 他/她 (ngôi 3) → third_person_label.")
    return "\n".join(lines)


def _per_segment_anchor(seg: dict, relationships: dict) -> str:
    """Anchor inline cho 1 segment — format explicit 我/你/他 mapping.

    Định dạng:
      我→"em" | 你→{SPK_01="anh", SPK_02="con"} | 他/她→tùy ngữ cảnh
    LLM thấy ngay: 我 trong câu → self_pronoun, 你 → addresses[X].
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
    addr = info.get("addresses") or {}
    if not self_p:
        return ""
    parts = [f'我→"{self_p}"']
    if addr:
        if len(addr) == 1:
            v = next(iter(addr.values()))
            parts.append(f'你→"{v}"')
        else:
            addr_str = ", ".join(f'{k.replace("SPEAKER_", "SPK_")}="{v}"' for k, v in addr.items())
            parts.append(f'你→{{{addr_str}}}')
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
🚨 RULE MAPPING ĐẠI TỪ (CỰC QUAN TRỌNG — đọc kỹ trước khi dịch):

Mỗi line có anchor `[SPEAKER_XX: 我→"X" | 你→"Y"]`. Ý nghĩa:
   • 我/我们 trong gốc → DÙNG "X" (self_pronoun của speaker đang nói)
   • 你/你们 trong gốc → DÙNG "Y" (addresses, từ speaker dùng để gọi addressee)
   • 他/她/它 trong gốc → DÙNG third_person_label của người được nhắc tới

❌ SAI HAY GẶP NHẤT — ĐẢO 我/你:
   Speaker là vợ (xưng "em"). Vợ nói "你今天又加班吗 老公" với chồng.
   你 trong câu này CHỈ CHỒNG (không phải vợ).
   → 你 phải dịch "anh" (addresses[chồng]), KHÔNG phải "em".

   ❌ "Hôm nay EM lại tăng ca à?"  ← SAI: dùng self_pronoun cho 你
   ✅ "Hôm nay ANH lại tăng ca à?" ← ĐÚNG: 你 → addresses

   Ghi nhớ: 我 = NGƯỜI ĐANG NÓI, 你 = NGƯỜI ĐƯỢC HỎI/GỌI. KHÔNG ĐƯỢC ĐẢO.

📝 VÍ DỤ CỤ THỂ:

Speaker SPEAKER_00 (vợ, anchor 我→"em" | 你→"anh"):
   "我也想你"     → "Em cũng nhớ anh"          ← 我=em, 你=anh
   "你回来了"     → "Anh về rồi"                ← 你=anh
   "他想你"       → "Con nhớ anh"               ← 他=con, 你=anh

Speaker SPEAKER_01 (chồng, anchor 我→"anh" | 你→"em"):
   "我也想小宝"   → "Anh cũng nhớ Tiểu Bảo"     ← 我=anh
   "你别担心"     → "Em đừng lo"                ← 你=em
   "我带他去"     → "Anh đưa con đi"            ← 我=anh, 他=con

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

INPUT: mỗi line có literal translation đã ĐÚNG pronoun + ĐÚNG nghĩa.
NHIỆM VỤ: polish thành câu PHIM thật — KHÔNG đổi pronoun, KHÔNG đổi nghĩa,
chỉ làm cho TỰ NHIÊN + CÓ CẢM XÚC hơn.

{scene_block}
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
