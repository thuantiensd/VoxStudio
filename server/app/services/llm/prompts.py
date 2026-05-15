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

from .few_shot_examples import build_few_shot_block


# ═══════════════════════════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════════════════════════

VN_SPEECH_RATE = 10.5  # chars/s — siết budget để LLM dịch súc tích hơn,
# tránh TTS overflow (cũ 11.5 → 50-60% segments bleed sang slot sau).
# Vietnamese TTS thực tế ~13 chars/s, ép xuống 10.5 = 80% → có headroom
# cho atempo speedup (cap 1.30x) khớp slot nguồn.


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
        "spanish": "Español", "es": "Español",
        "french": "Français", "fr": "Français",
        "german": "Deutsch", "de": "Deutsch",
        "portuguese": "Português", "pt": "Português",
        "russian": "Русский", "ru": "Русский",
        "thai": "ภาษาไทย", "th": "ภาษาไทย",
        "indonesian": "Bahasa Indonesia", "id": "Bahasa Indonesia",
        "italian": "Italiano", "it": "Italiano",
        "auto": "auto-detect",
    }
    return names.get((lang or "").lower(), lang or "auto")


def _is_vietnamese(lang: str) -> bool:
    return (lang or "").lower().strip() in ("vietnamese", "vi", "vn")


# Classical Chinese / cổ trang trigger markers — nếu source text chứa ≥ 2
# marker này, hoặc ≥ 1 marker mạnh, kích hoạt classical mode trong Pass-1/2
# bất kể register Pass-0 trả về là gì (Pass-0 đôi khi miss khi text ngắn).
_CLASSICAL_MARKERS_STRONG = (
    "朕", "陛下", "殿下", "皇上", "皇后", "贵妃", "本宫", "微臣", "臣妾",
    "在下", "兒臣", "儿臣", "王爷", "王妃", "公主", "郡主", "太子", "亲王",
    "侯爷", "丞相", "尚书", "御史",
    "师父", "师傅", "师兄", "师姐", "师弟", "师妹", "掌门",
    "仙门", "仙子", "修仙", "修真", "修行", "渡劫", "飞升", "灵气", "灵剑",
    "丹药", "炼丹", "法宝", "金丹", "元婴", "化神", "渡情", "斩仙",
    "江湖", "侠客", "武林", "剑客", "刺客",
    "府上", "府邸", "客栈", "酒楼", "茶馆", "马车", "驿站",
    "处斩", "处死", "斩首", "诛九族", "凌迟",
)
_CLASSICAL_MARKERS_WEAK = (
    # Chỉ giữ markers RÕ cổ trang (modern Trung không dùng):
    "姑娘",    # cô nương — cổ trang
    "娘子",    # nương tử — cổ trang (modern: 老婆)
    "相公",    # phu quân — cổ trang (modern: 老公)
    "官人",    # phu quân — cổ trang
    "夫君",    # phu quân — cổ trang
    "爹爹", "娘亲",  # cha mẹ cổ trang (modern: 爸爸/妈妈)
    "儿臣", "下官",  # khiêm xưng cổ trang
    "拜见", "告退", "失礼",  # nghi lễ cổ trang
    "敢问", "敢不", "不敢", "万万不可",  # ngữ khí cổ trang
    # ĐÃ BỎ: 小姐 / 大人 / 老爷 / 先生 / 公子 / 夫人 — ambiguous,
    # cả modern lẫn classical đều dùng (vd 'Tống Tiểu Thư' trong
    # CEO drama hiện đại, 'Tổng giám đốc Lý 老爷'). False-positive cao.
)

# Modern BUSINESS markers — nếu thấy ≥2 cái → CHẮC CHẮN phim hiện đại,
# override cả weak classical markers (vd 小姐 cũ nhưng đây là Miss
# trong company setting).
_MODERN_BUSINESS_MARKERS = (
    "公司", "集团", "总裁", "总经理", "经理", "老总", "老板",
    "项目", "合同", "股东", "财务", "投资", "上市",
    "亿", "万", "百亿", "千万",  # tiền hiện đại (cổ trang dùng 两 銀)
    "手机", "电脑", "微信", "电话",  # tech modern
    "公寓", "豪宅", "汽车", "酒店",  # modern setting
    "酒吧", "咖啡", "餐厅", "西餐",  # modern places
)


def _detect_classical(register: str, source_text: str) -> bool:
    """Auto-detect classical register từ register field + source text scan.

    Hai con đường:
    1. Pass-0 đã trả về register=cổ trang/historical/wuxia/xianxia → True
    2. Source text chứa ≥1 strong marker hoặc ≥3 weak markers → True
    3. NHƯNG modern business markers (≥2) → OVERRIDE về False
       (phim CEO/business hiện đại có 小姐/大人 cổ-có-vẻ nhưng thực ra modern)
    """
    reg = (register or "").lower()
    if any(kw in reg for kw in ("cổ trang", "co trang", "historical", "wuxia",
                                 "xianxia", "cổ_trang", "kiếm_hiệp",
                                 "tiên_hiệp", "kiem_hiep", "tien_hiep")):
        return True

    if not source_text:
        return False

    # Modern business override: nếu ≥2 markers business → phim modern
    # KỂ CẢ có markers cổ trang weak (vì 小姐/大人 ambiguous)
    modern_count = sum(source_text.count(m) for m in _MODERN_BUSINESS_MARKERS)
    if modern_count >= 2:
        return False

    # Strong markers — chỉ 1 cái xuất hiện là đủ kích hoạt
    if any(m in source_text for m in _CLASSICAL_MARKERS_STRONG):
        return True

    # Weak markers — cần ≥3 lần để tránh false-positive
    weak_count = sum(source_text.count(m) for m in _CLASSICAL_MARKERS_WEAK)
    return weak_count >= 3


# Genre → register hints. Vietnamese trả về tiếng Việt chi tiết để LLM bám sát
# style phim Việt; ngôn ngữ khác trả về English neutral để LLM tự áp dụng
# convention của target language (politeness levels, contractions, T-V…).
_GENRE_GUIDE_VN: dict[str, str] = {
    "romance": (
        "🌹 NGÔN TÌNH/LÃNG MẠN: xưng hô mật thiết \"anh/em\". Tiểu từ tình tứ "
        "\"nhỉ/à/cơ/đấy\". Tránh từ ngữ thô. Nhịp câu mềm, đôi khi ngập ngừng. "
        "Cảm xúc thể hiện qua câu ngắn + tiểu từ, không miêu tả tâm trạng kiểu kịch."
    ),
    "drama": (
        "🎭 TÂM LÝ/DRAMA: thoại tự nhiên đời thường. Ưu tiên câu ngắn-vừa, "
        "tiểu từ giúp tone (lắm/thế/nhỉ). Conflict thể hiện qua từ ngữ chứ "
        "không chỉ qua đại từ — pronoun GIỮ nhất quán."
    ),
    "comedy": (
        "😂 HÀI: tone vui, sleng nhẹ (\"trời ơi/khổ thân/biết rồi mà\"). "
        "Câu ngắt nhịp gấp, cảm thán mạnh (\"ha/ơ kìa/úi giời\"). "
        "Tránh dùng từ Hán-Việt nặng nề."
    ),
    "action": (
        "💥 HÀNH ĐỘNG: câu CỰC NGẮN, mệnh lệnh thức. Bỏ tiểu từ thừa. "
        "Nhịp gấp, từ ngữ punchy (\"Đi!\"/\"Coi chừng!\"/\"Cẩn thận sau!\"). "
        "Không có chỗ cho lời thoại văn vẻ."
    ),
    "thriller": (
        "🔪 GIẬT GÂN: nhịp nén, câu cụt. Whisper/threat: voice mềm nhưng từ ngữ "
        "lạnh. Không tiểu từ vui (\"nhỉ/cơ/đấy\"). Pause/ngắt dòng đậm."
    ),
    "horror": (
        "👻 KINH DỊ: pacing chậm + ngắt nhịp ngắn xen kẽ. Câu hỏi rỗng "
        "(\"Cái gì vậy?\"/\"Ai đó?\"). Whisper register. Tránh giải thích thừa."
    ),
    "historical": (
        "🏯 CỔ TRANG: xưng hô trang trọng (\"thần/khanh/bệ hạ/điện hạ/tướng quân\"). "
        "Từ Hán-Việt nhiều. \"Tại hạ/các hạ/đại nhân/tiểu nhân\" thay \"tôi/anh\". "
        "Tránh từ hiện đại (\"OK/ờm/đi luôn\"). Câu dài, nhịp uyển chuyển."
    ),
    "wuxia": (
        "⚔️ KIẾM HIỆP/TIÊN HIỆP: \"tại hạ/cô nương/đạo hữu/sư phụ/đệ tử\". "
        "Từ võ thuật giữ Hán-Việt (\"nội lực/chân khí/kinh mạch\"). "
        "Phong thái cao ngạo hoặc lễ độ tuỳ nhân vật."
    ),
    "scifi": (
        "🚀 KHOA HỌC VIỄN TƯỞNG: giữ thuật ngữ kỹ thuật (\"AI/máy chủ/quark/"
        "trọng lực\"). Tránh Việt hoá quá đà. Speech neutral, ít cảm xúc dư."
    ),
    "fantasy": (
        "🧙 HUYỀN HUYỄN: thuật ngữ huyền bí giữ Hán-Việt (\"pháp thuật/linh hồn/"
        "nguyền rủa\"). Register hơi cổ điển, nhưng không nặng như cổ trang."
    ),
    "documentary": (
        "📺 TÀI LIỆU: tone narrator trung tính, trang trọng vừa phải. "
        "Dùng \"chúng ta/quý vị\" cho khán giả. Không tiểu từ thân mật. "
        "Câu dài có cấu trúc rõ."
    ),
    "news": (
        "📰 TIN TỨC: register formal. Không slang, không tiểu từ. "
        "Câu chủ-vị-bổ rõ. Số liệu/danh từ riêng giữ nguyên."
    ),
    "kids": (
        "🧸 THIẾU NHI: từ vựng đơn giản, câu ngắn. Tiểu từ vui "
        "(\"nè/đó/ha\"). Tránh từ phức tạp + ý niệm trừu tượng. "
        "Cảm thán nhiều (\"ồ/ô hô/wow\")."
    ),
}

_GENRE_GUIDE_GENERIC: dict[str, str] = {
    "romance": (
        "ROMANCE: tender, emotionally honest register. Use softer phrasing and "
        "natural intimate forms of address (target language's equivalent of "
        "terms of endearment / informal pronouns). Avoid clinical or stiff wording."
    ),
    "drama": (
        "DRAMA: realistic everyday speech. Conflict shown through word choice, "
        "not pronoun swapping. Keep each character's register consistent."
    ),
    "comedy": (
        "COMEDY: light tone, use contractions and casual register where natural. "
        "Punchy timing. Preserve jokes' rhythm — don't over-explain."
    ),
    "action": (
        "ACTION: SHORT sentences. Imperative mood. Drop filler. Urgent rhythm "
        "(\"Move!\" / \"Behind you!\"). No flowery phrasing."
    ),
    "thriller": (
        "THRILLER: compressed pacing, terse lines. Threats spoken low — words "
        "cold even when voice is calm. Heavy use of pauses."
    ),
    "horror": (
        "HORROR: slow pacing with sudden short bursts. Empty/unanswered questions "
        "(\"What was that?\"). Whisper register. Leave space for dread."
    ),
    "historical": (
        "HISTORICAL/PERIOD: use period-appropriate register. Honorific forms "
        "(target language's archaic or formal equivalents). Avoid modernisms."
    ),
    "wuxia": (
        "WUXIA/XIANXIA: martial-arts setting. Preserve technical terms (qi, "
        "meridians, sect, cultivation). Formal/archaic register for elder figures."
    ),
    "scifi": (
        "SCI-FI: preserve technical jargon (AI, quantum, neural net). Speech "
        "leans neutral and precise."
    ),
    "fantasy": (
        "FANTASY: preserve world-specific terminology (spells, races, realms). "
        "Slightly elevated register, but not as archaic as period historical."
    ),
    "documentary": (
        "DOCUMENTARY: neutral narrator voice. Formal-but-accessible register. "
        "Address the audience using target language's standard documentary form."
    ),
    "news": (
        "NEWS: formal register. No slang, no contractions. Clear "
        "subject-verb-object. Preserve proper nouns and numbers exactly."
    ),
    "kids": (
        "KIDS: simple vocabulary, short sentences. Avoid abstract concepts. "
        "Use frequent exclamations natural to target language."
    ),
}


def _genre_style_guide(genre: Optional[str], target_lang: str) -> str:
    """Return genre-specific register hints. Vietnamese gets detailed VN guide;
    other targets get a concise English-described style guide."""
    if not genre:
        return ""
    key = genre.lower().strip().replace("-", "_")
    # Aliases
    aliases = {
        "romance_drama": "romance", "ngôn_tình": "romance", "ngon_tinh": "romance",
        "tâm_lý": "drama", "tam_ly": "drama",
        "hài": "comedy", "hai": "comedy", "sitcom": "comedy",
        "hành_động": "action", "hanh_dong": "action",
        "kinh_dị": "horror", "kinh_di": "horror",
        "cổ_trang": "historical", "co_trang": "historical", "period": "historical",
        "kiếm_hiệp": "wuxia", "kiem_hiep": "wuxia", "xianxia": "wuxia",
        "tiên_hiệp": "wuxia", "tien_hiep": "wuxia",
        "khoa_học": "scifi", "khoa_hoc": "scifi", "sci_fi": "scifi", "scifi": "scifi",
        "huyền_huyễn": "fantasy", "huyen_huyen": "fantasy",
        "tài_liệu": "documentary", "tai_lieu": "documentary",
        "tin_tức": "news", "tin_tuc": "news",
        "thiếu_nhi": "kids", "thieu_nhi": "kids", "children": "kids",
    }
    key = aliases.get(key, key)
    if _is_vietnamese(target_lang):
        guide = _GENRE_GUIDE_VN.get(key)
    else:
        guide = _GENRE_GUIDE_GENERIC.get(key)
    return f"\n🎬 THỂ LOẠI: {guide}\n" if guide else ""


# Per-target-language convention hints — short pro-tier notes about
# native register conventions LLM must respect when translating dialogue.
_TARGET_LANG_NOTES: dict[str, str] = {
    "english": (
        "ENGLISH dialogue: use contractions in informal scenes (\"I'm/don't/you're\"). "
        "Drop unnecessary subject pronouns only when natural. Avoid translationese — "
        "rewrite for natural English cadence, not word-for-word."
    ),
    "japanese": (
        "JAPANESE dialogue: respect speech levels (敬語/丁寧語/タメ口). "
        "Pick sentence-ending particles (よ/ね/わ/だ) and pronoun (私/僕/俺/あたし) "
        "matching speaker's age, gender, status. DROP pronouns when subject is clear."
    ),
    "korean": (
        "KOREAN dialogue: respect speech level (해체/해요체/하십시오체). "
        "Drop subject when clear from context. Use 형/오빠/언니/누나 appropriately. "
        "Match 반말/존댓말 to character relationships."
    ),
    "chinese": (
        "CHINESE dialogue: use natural spoken rhythm (口语). Particles "
        "(吗/呢/吧/啊/了) for tone. Drop redundant pronouns. Pick 你/您 by formality."
    ),
    "spanish": (
        "SPANISH dialogue: choose tú/usted (or vos in regional) by formality + "
        "relationship. Use natural ellipsis. Match regional register to setting "
        "if specified (LatAm vs Iberian)."
    ),
    "french": (
        "FRENCH dialogue: tu vs vous critical — match to relationship. "
        "Use natural ellipsis and informal contractions (\"j'sais pas\") in casual "
        "scenes. Avoid translationese register mix."
    ),
    "german": (
        "GERMAN dialogue: du vs Sie critical. Natural word order ≠ literal. "
        "Modal particles (doch/mal/halt/ja) add tone — use them."
    ),
    "thai": (
        "THAI dialogue: choose pronouns (ผม/ฉัน/กู/หนู) + politeness particles "
        "(ครับ/ค่ะ) by speaker gender + register. Drop pronouns when clear."
    ),
    "indonesian": (
        "INDONESIAN dialogue: choose aku/saya/gue by formality + region. "
        "Particles (sih/dong/kok/lho) carry tone — use naturally."
    ),
    "russian": (
        "RUSSIAN dialogue: ты vs вы by formality. Aspect (perfective/imperfective) "
        "matters for tone. Match diminutives to intimacy level."
    ),
    "portuguese": (
        "PORTUGUESE dialogue: tu vs você (or o senhor/a senhora) by region + "
        "register. Brazilian vs European spelling/lexicon — match setting."
    ),
    "italian": (
        "ITALIAN dialogue: tu vs Lei by formality. Use natural ellipsis and "
        "regional flavor only if setting requires."
    ),
}


def _target_language_notes(target_lang: str) -> str:
    key = (target_lang or "").lower().strip()
    # Normalize ISO codes to full name
    code_map = {
        "en": "english", "ja": "japanese", "ko": "korean", "zh": "chinese",
        "es": "spanish", "fr": "french", "de": "german", "th": "thai",
        "id": "indonesian", "ru": "russian", "pt": "portuguese", "it": "italian",
    }
    key = code_map.get(key, key)
    note = _TARGET_LANG_NOTES.get(key)
    return f"\n📌 TARGET LANGUAGE NOTES: {note}\n" if note else ""


def _name_translation_rule(source_lang: Optional[str]) -> str:
    """Tên riêng convention theo source language."""
    src = (source_lang or "").lower().strip()
    if src in ("zh", "chinese", "zh-cn", "zh-tw", "mandarin"):
        return """TÊN RIÊNG (zh → vi): BẮT BUỘC PHIÊN ÂM HÁN-VIỆT — TUYỆT ĐỐI KHÔNG PINYIN.

   ❌ KHÔNG bao giờ: "Chen Yu Yan" / "Wang Xiao Ming" / "Li Wei" / "Xin Mei"
   ❌ KHÔNG bao giờ giữ pinyin raw — đọc dub sẽ ra "ven y yan" rất tệ.
   ✅ LUÔN phiên Hán-Việt mỗi character của tên.

   📖 BẢNG HỌ Trung→Việt (30 họ phổ biến nhất — DÙNG TRỰC TIẾP):
   王→Vương, 李→Lý, 张→Trương, 刘→Lưu, 陈→Trần, 杨→Dương, 黄→Hoàng,
   赵→Triệu, 周→Chu, 吴→Ngô, 徐→Từ, 孙→Tôn, 朱→Chu, 马→Mã, 胡→Hồ,
   郭→Quách, 林→Lâm, 何→Hà, 高→Cao, 梁→Lương, 郑→Trịnh, 罗→La,
   宋→Tống, 谢→Tạ, 唐→Đường, 韩→Hàn, 冯→Phùng, 邓→Đặng, 曹→Tào,
   彭→Bành, 曾→Tăng, 萧→Tiêu, 田→Điền, 董→Đổng, 袁→Viên, 潘→Phan,
   蔡→Thái, 蒋→Tưởng, 余→Dư, 于→Vu, 杜→Đỗ, 叶→Diệp, 程→Trình, 魏→Nguỵ,
   苏→Tô, 吕→Lữ, 丁→Đinh, 任→Nhâm, 沈→Thẩm, 姚→Diêu, 卢→Lư, 姜→Khương,
   崔→Thôi, 钟→Chung, 谭→Đàm, 陆→Lục, 汪→Uông, 范→Phạm, 金→Kim,
   石→Thạch, 戴→Đới, 贾→Giả, 韦→Vi, 夏→Hạ, 付→Phó, 方→Phương,
   慕容→Mộ Dung, 司马→Tư Mã, 欧阳→Âu Dương, 上官→Thượng Quan, 诸葛→Gia Cát

   📖 VÍ DỤ TÊN ĐẦY ĐỦ:
   陈奕迅 → Trần Dịch Tấn (KHÔNG "Chen Yi Xun")
   王小明 → Vương Tiểu Minh (KHÔNG "Wang Xiao Ming")
   李雪 → Lý Tuyết (KHÔNG "Li Xue")
   叶辰 → Diệp Thần
   林从安 → Lâm Tòng An
   秦夏 → Tần Hạ
   慕容紫英 → Mộ Dung Tử Anh

   📖 TÊN THÂN MẬT / VOCATIVE:
   小X → Tiểu X (小宝→Tiểu Bảo, 小雪→Tiểu Tuyết)
   阿X → A X (阿明→A Minh)
   大X → Đại X (大哥→Đại ca)
   老X → Lão X (老王→Lão Vương)

   📖 TƯỚC VỊ:
   陛下→Bệ hạ, 殿下→Điện hạ, 公子→Công tử, 小姐→Tiểu thư,
   大人→Đại nhân, 先生→Tiên sinh, 师父→Sư phụ, 师兄→Sư huynh

   🚨 NẾU GẶP HÁN TỰ KHÔNG TRONG BẢNG TRÊN:
   Tự suy Hán-Việt theo phép phiên âm (KHÔNG dùng pinyin). Ví dụ
   các âm phổ biến:
   伟→Vĩ, 强→Cường, 涛→Đào, 杰→Kiệt, 鑫→Hâm, 宇→Vũ, 浩→Hạo,
   俊→Tuấn, 凯→Khải, 健→Kiện, 翔→Tường, 鹏→Bằng, 飞→Phi, 龙→Long,
   华→Hoa, 国→Quốc, 民→Dân, 平→Bình, 安→An, 文→Văn, 武→Vũ,
   宁→Ninh, 玲→Linh, 娟→Quyên, 芳→Phương, 静→Tĩnh, 敏→Mẫn,
   惠→Huệ, 莉→Lị, 燕→Yến, 娜→Na, 婷→Đình, 慧→Tuệ, 晶→Tinh,
   梦→Mộng, 雪→Tuyết, 月→Nguyệt, 星→Tinh/Tinh, 灵→Linh, 玉→Ngọc,
   美→Mỹ, 心→Tâm, 眉→Mi, 雅→Nhã, 兰→Lan, 菊→Cúc, 梅→Mai, 莲→Liên"""
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
    entity_registry: Optional[dict] = None,
    max_lines: int = 200,
) -> dict:
    """Pass-0: phân tích quan hệ giữa SPEAKER_XX → JSON map + auto-detect genre.

    Nếu có visual_context (từ VLM Pass-(-1)) → inject làm GROUND TRUTH.
    LLM dùng để confirm gender + role thay vì đoán từ text alone.

    Sample DIVERSE: first/middle/last để tránh bias do intro chậm — phim
    hay có scene đầu lạc thể loại với phần chính.
    """
    src_name = _lang_display_name(source_lang)

    # Sample diverse: first/middle/last để catch genre shift
    valid = [s for s in segments if (s.get("original_text") or "").strip()]
    n = len(valid)
    if n <= max_lines:
        picked = valid
    else:
        third = max_lines // 3
        picked = valid[:third] + valid[n // 2 - third // 2 : n // 2 + third // 2] + valid[-third:]

    sample_lines = []
    for seg in picked:
        text = (seg.get("original_text") or "").strip()
        spk = seg.get("speaker") or "?"
        sample_lines.append(f"{spk}: {text}")

    genre_hint = ""
    if film_genre and film_genre != "auto":
        genre_hint = f"\n• Thể loại detect: {film_genre} → pick register phù hợp.\n"

    # Visual context block (nếu có) — đặt lên đầu prompt làm anchor mạnh
    visual_block = ""
    if visual_context:
        visual_block = "\n" + format_visual_context_for_audio_analyze(visual_context) + "\n"

    # Entity registry block — scan toàn file Python code, inject vào prompt
    # để LLM có anchor name + vocative chính xác (không phụ thuộc sample bias).
    entity_block = ""
    if entity_registry and (entity_registry.get("proper_nouns") or entity_registry.get("vocatives")):
        names = entity_registry.get("proper_nouns", [])[:30]
        vocs = entity_registry.get("vocatives", [])[:15]
        parts = ["\n📛 ENTITY REGISTRY (scan TOÀN BỘ source — authoritative):"]
        if names:
            parts.append("   Tên người (≥2 lần xuất hiện):")
            for name, cnt in names:
                parts.append(f"      • {name} ({cnt}×) → phiên Hán-Việt nhất quán, KHÔNG drift")
        if vocs:
            parts.append("   Xưng hô / chức danh:")
            for v, cnt in vocs:
                parts.append(f"      • {v} ({cnt}×)")
        parts.append("⚠️ Các tên trên xuất hiện nhiều — PHẢI có trong character_name của speakers,")
        parts.append("   spelling Hán-Việt phải nhất quán (cùng source chars → cùng output).")
        entity_block = "\n".join(parts) + "\n"

    system = f"""Bạn là chuyên gia phân tích kịch bản phim. Đọc hội thoại từ {src_name}
và XÁC ĐỊNH QUAN HỆ giữa các SPEAKER.
{visual_block}{entity_block}

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

🏯 REGISTER DETECTION (TRƯỚC TIÊN — output field "register"):

SCAN TEXT GỐC cho keyword chỉ ra setting:

→ COẢ TRANG / HISTORICAL / WUXIA / XIANXIA:
   Dấu hiệu: 朕/陛下/殿下/公子/小姐/在下/本宫/王爷/娘娘/师父/师兄/师妹/
   仙门/修仙/沙场/将军/江湖/江山/天下/法术/灵气/修行/丹/灵剑/府邸/府上/
   太子/亲王/侯爷/老爷/夫人/相公/官人/姑娘/客栈/酒楼/茶馆/侠/剑/刀/
   秦楼/盖头/喜服/合卺/拜堂/三跪九叩/处死/处斩/牢狱/官府/朝廷/天命/
   仙子/道长/真人/书生/秀才/状元/书院/书塾/进士/举人/科举/挑灯夜读
   → register = "cổ trang"

→ MODERN / DRAMA / OFFICE:
   手机/电脑/公司/老板/咖啡/工作/微信/上班/老婆/老公/老师/学生/学校/医院
   → register = "modern"

→ BUSINESS / KICH BẢN VĂN PHÒNG:
   会议/合同/项目/客户/部门/总裁/经理/股票/财务
   → register = "business"

→ Mixed: pick theo speaker chính (nhân vật cổ trang nói cổ trang dù xung
   quanh có modern).

⚠️ Output register FIELD chính xác — đây là input cho Pass-1/Pass-2 quyết
định toàn bộ vocab. Sai register = toàn bộ dịch sai phong cách.

⚠️ scene_context — RELATIONSHIP STATUS của cặp đôi (CỰC QUAN TRỌNG):

🚨 VỢ CHỒNG / CẶP ĐÔI YÊU NHAU: MẶC ĐỊNH "anh/em" (KHÔNG "tôi/cô"):
   • Mới cưới còn ngượng → "anh/em"
   • Cưới vì hợp đồng / không yêu → "anh/em" (đây là phim drama, vẫn vợ chồng)
   • Cãi nhau / ghen tuông / hiểu lầm → "anh/em" (cãi yêu)
   • Quan hệ phức tạp (ôm nhầm con, hôn nhân giả) → "anh/em"
   • KHÔNG quen biết nhau lắm → "anh/em" (vẫn là vợ chồng)
   CHỈ dùng "tôi/cô" khi ĐÃ LY HÔN CHÍNH THỨC hoặc thoại nói thẳng từ chối
   ("ông đừng gọi tôi là vợ nữa") — RẤT HIẾM, KHÔNG được đoán.

🚨 Con cái: MẶC ĐỊNH "con" gọi "bố/mẹ" (KHÔNG "ông/bà"):
   • Giận, cãi cha mẹ → vẫn "bố/mẹ"
   • Bị tẩy não, không thích cha → vẫn "bố/mẹ"
   • CHỈ "ông/bà" khi con đoạn tuyệt + nói thẳng từ chối làm con

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
🎬 CONTENT TYPE + GENRE AUTO-DETECT (CHAIN-OF-THOUGHT):

App dịch ĐA DẠNG VIDEO — không chỉ phim. Phải nhận diện đúng loại
nội dung để chọn style dịch phù hợp. Đọc sample → output:

content_type — DẠNG VIDEO (chính):
   • short_drama   — phim ngắn drama (TikTok-style 1-5 min/tập)
   • movie         — phim dài / phim truyền hình
   • anime         — hoạt hình Nhật/Trung
   • vlog          — vlog đời sống, du lịch, ăn uống
   • news          — bản tin
   • documentary   — phim tài liệu, narrator
   • interview     — phỏng vấn / talkshow
   • tutorial      — hướng dẫn, dạy học
   • sales         — quảng cáo, bán hàng, live bán hàng
   • livestream    — livestream gaming/chat
   • other         — không thuộc loại trên

genre_signals: bằng chứng cụ thể (vd "朕 xuất hiện 12 lần", "今日新闻 mention 3x")
film_genre_primary: 1 trong 13 thể loại (chỉ áp dụng cho short_drama/movie/anime):
   romance / drama / comedy / action / thriller / horror /
   historical / wuxia / scifi / fantasy / documentary / news / kids
film_genre_secondary: optional. null nếu single-genre.
genre_confidence: 0.0-1.0. < 0.5 → fallback an toàn.

📛 GLOSSARY (BẮT BUỘC — bảng dịch CỐ ĐỊNH cho phim này):

Quét toàn bộ sample và xuất 3 map dịch CHÍNH THỨC. Pass-1 sẽ tra bảng
này như nguồn duy nhất — mọi line đều phải dùng đúng từ ngữ ở đây.

→ name_map: tên người (TỪNG nhân vật xuất hiện ≥ 1 lần)
   Format: source → Hán-Việt canonical
   VD: "叶辰": "Diệp Thần", "秦夏": "Tần Hạ", "小宝": "Tiểu Bảo"
   ⚠️ Phiên Hán-Việt từng character (KHÔNG pinyin "Ye Chen"). Tên Nhật giữ
       Romaji ("Sakura"), tên Hàn dùng quy ước tiếng Việt cho tên Hàn.

→ term_map: cụm/danh từ riêng đặc trưng phim (tổ chức, môn phái, tuyệt
   chiêu, biệt danh, vật phẩm). Chỉ entry NHẤT QUÁN sẽ ảnh hưởng nhiều line.
   VD: "玄铁剑": "Huyền Thiết Kiếm", "陈氏集团": "Tập đoàn họ Trần"
   Tối đa 20 entry — chọn cái xuất hiện nhiều / quan trọng nhất.

→ place_map: địa danh (thành phố, vùng, cung điện, môn phái nếu là nơi).
   VD: "京城": "Kinh thành", "长安": "Trường An", "北京": "Bắc Kinh"
   Tối đa 15 entry.

⚠️ NGUYÊN TẮC chọn entry: chỉ thêm nếu xuất hiện ≥ 2 lần HOẶC là tên
nhân vật chính. Đừng nhét những từ dịch máy bình thường (KHÔNG cần
"老婆" → "em" vì đã xử lý bằng pronoun mapping).

OUTPUT JSON duy nhất:
{{
  "scene_context": "Mô tả ngắn bối cảnh + quan hệ chính của các speakers",
  "content_type": "short_drama",
  "register": "modern/cổ trang/business/family/news/documentary",
  "genre_signals": ["..."],
  "film_genre_primary": "drama",
  "film_genre_secondary": null,
  "genre_confidence": 0.85,
  "glossary": {{
    "name_map": {{"叶辰": "Diệp Thần", "秦夏": "Tần Hạ"}},
    "term_map": {{"陈氏集团": "Tập đoàn họ Trần"}},
    "place_map": {{"京城": "Kinh thành"}}
  }},
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
    valid_genres = {
        "romance", "drama", "comedy", "action", "thriller", "horror",
        "historical", "wuxia", "scifi", "fantasy", "documentary",
        "news", "kids",
    }
    gp = (parsed.get("film_genre_primary") or "").lower().strip()
    if gp not in valid_genres:
        gp = ""
    gs = (parsed.get("film_genre_secondary") or "")
    gs = gs.lower().strip() if isinstance(gs, str) else ""
    if gs not in valid_genres:
        gs = ""
    try:
        gc = float(parsed.get("genre_confidence", 0.0))
        gc = max(0.0, min(1.0, gc))
    except (TypeError, ValueError):
        gc = 0.0
    signals = parsed.get("genre_signals") or []
    if not isinstance(signals, list):
        signals = []
    signals = [str(s).strip()[:120] for s in signals[:8] if s]

    valid_content_types = {
        "short_drama", "movie", "anime", "vlog", "news", "documentary",
        "interview", "tutorial", "sales", "livestream", "other",
    }
    ct = (parsed.get("content_type") or "").lower().strip()
    if ct not in valid_content_types:
        ct = ""

    # Glossary — name_map / term_map / place_map. Source→canonical strings.
    # Filter rỗng + cắt độ dài để không bloat prompt downstream.
    def _clean_glossary_map(m, max_entries: int, max_key: int, max_val: int) -> dict:
        if not isinstance(m, dict):
            return {}
        out: dict[str, str] = {}
        for k, v in m.items():
            if not isinstance(k, str) or not isinstance(v, str):
                continue
            k = k.strip()[:max_key]
            v = v.strip()[:max_val]
            if not k or not v or k == v:
                continue
            out[k] = v
            if len(out) >= max_entries:
                break
        return out

    glossary_raw = parsed.get("glossary") or {}
    if not isinstance(glossary_raw, dict):
        glossary_raw = {}
    glossary = {
        "name_map":  _clean_glossary_map(glossary_raw.get("name_map"),  40, 30, 40),
        "term_map":  _clean_glossary_map(glossary_raw.get("term_map"),  20, 30, 40),
        "place_map": _clean_glossary_map(glossary_raw.get("place_map"), 15, 30, 40),
    }

    return {
        "scene_context": (parsed.get("scene_context") or "").strip()[:300],
        "register": (parsed.get("register") or "").strip()[:40],
        "content_type": ct,
        "film_genre_primary": gp,
        "film_genre_secondary": gs,
        "genre_confidence": gc,
        "genre_signals": signals,
        "glossary": glossary,
        "speakers": speakers,
    }


# Content-type profiles — mỗi loại video có style dịch riêng. Lấy nhánh
# Việt vì user chủ yếu dịch sang VN; có thể mở rộng cho ngôn ngữ khác sau.
_CONTENT_TYPE_PROFILE_VN: dict[str, str] = {
    "short_drama": (
        "📺 PHIM NGẮN DRAMA (TikTok-style): câu ngắn, hợp lồng tiếng. "
        "Giữ cảm xúc + twist. Tên nhân vật NHẤT QUÁN xuyên suốt. "
        "Tone tự nhiên — đừng dịch máy từng chữ."
    ),
    "movie": (
        "🎬 PHIM DÀI: dịch theo cảm xúc nhân vật, văn nói tự nhiên. "
        "Quan hệ nhân vật phức tạp — cẩn thận pronoun + xưng hô. "
        "Cho phép câu dài hơn short_drama (audience đọc kỹ hơn)."
    ),
    "anime": (
        "🎌 HOẠT HÌNH NHẬT/TRUNG: tone biểu cảm cao, hay có thán từ "
        "(『うわぁ』『なるほど』『え?!』). Giữ vibe energetic — dịch "
        "phải có nhịp + cảm thán tương đương Việt ('Hả?!', 'Tuyệt vời!', "
        "'Á!'). Tên nhân vật giữ Romaji (Naruto, Sakura) — KHÔNG Hán-Việt."
    ),
    "vlog": (
        "🎥 VLOG ĐỜI SỐNG: tone gần gũi, conversational. Như đang nói "
        "chuyện với bạn bè. Tránh tiểu từ kịch tính ('lắm đấy', 'cơ', "
        "'thế'). Dùng từ phổ thông: 'mình', 'bạn', 'mọi người'. "
        "Câu dạng: 'Hôm nay mình sẽ dẫn mọi người đi…', 'Cùng xem nhé…'"
    ),
    "news": (
        "📰 TIN TỨC: formal register. Không thêm cảm xúc, không slang. "
        "Giữ CHÍNH XÁC số liệu / địa danh / chức danh / ngày tháng. "
        "Câu chủ-vị-bổ rõ ràng. Không tiểu từ ('nhỉ/thế/à'). "
        "Vocab chuẩn báo chí: 'theo nguồn tin', 'được biết', 'cho hay'."
    ),
    "documentary": (
        "🎞️ TÀI LIỆU: tone narrator trung tính, trang trọng vừa phải. "
        "Dùng 'chúng ta/quý vị' cho khán giả. Câu dài có cấu trúc rõ. "
        "Giữ thuật ngữ chính xác. Không tiểu từ thân mật."
    ),
    "interview": (
        "🎤 PHỎNG VẤN: hai bên hỏi-đáp tự nhiên. Pronoun phụ thuộc tuổi "
        "+ chức danh khách mời (host trẻ với khách lớn tuổi → 'em' với "
        "'anh/chị/chú/bác'). Câu của khách thường dài hơn host."
    ),
    "tutorial": (
        "📖 HƯỚNG DẪN: rõ thao tác, ngắn gọn, mệnh lệnh nhẹ. Dùng 'bạn' "
        "hoặc bỏ chủ ngữ. VD: 'Nhấn vào nút ở góc trên', 'Mở menu → "
        "chọn…'. Không cần cảm xúc, không cần văn vẻ. Số bước rõ."
    ),
    "sales": (
        "🛒 BÁN HÀNG / QUẢNG CÁO: tone marketing — nhiệt tình, persuasive. "
        "Câu ngắn, có nhấn mạnh ('Cực kỳ tiện', 'Siêu xịn', 'Đáng mua "
        "lắm!'). Không khô kiểu 'cái này thực sự rất hữu ích' — phải tự "
        "nhiên như shop livestream / TikTok shop."
    ),
    "livestream": (
        "📡 LIVESTREAM: rất casual, slang hợp với audience trẻ. Cho phép "
        "interjection ('ờ', 'à', 'thật ạ?'). Câu vụn, ngắt nhịp tự nhiên "
        "như đang nói thật. KHÔNG over-edit."
    ),
}


def _content_type_profile_vn(content_type: Optional[str]) -> str:
    """Return profile block tiếng Việt theo content_type. Empty nếu không match."""
    if not content_type:
        return ""
    guide = _CONTENT_TYPE_PROFILE_VN.get(content_type.lower().strip())
    return f"\n📼 LOẠI VIDEO: {guide}\n" if guide else ""


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


def _format_glossary_block(relationships: Optional[dict]) -> str:
    """Format glossary (name/term/place_map) thành bảng tra cứu cho Pass-1.

    Mục tiêu: cấp cho Pass-1 1 NGUỒN DUY NHẤT về cách dịch tên / thuật ngữ /
    địa danh — để mọi batch không drift giữa cùng 1 phim. Pass-1 PHẢI tra
    bảng này trước khi tự phiên Hán-Việt.

    Trả "" nếu glossary rỗng (không inject section trống vào prompt).
    """
    if not relationships:
        return ""
    g = relationships.get("glossary") or {}
    if not isinstance(g, dict):
        return ""
    name_map  = g.get("name_map")  or {}
    term_map  = g.get("term_map")  or {}
    place_map = g.get("place_map") or {}
    if not (name_map or term_map or place_map):
        return ""

    lines = [
        "📛 GLOSSARY (BẢNG TRA CỨU CHÍNH THỨC — DÙNG NGUYÊN BẢN, KHÔNG TỰ ĐOÁN):",
        "",
        "Pass-0 đã phân tích toàn video và chốt cách dịch dưới đây. Mọi line",
        "có chứa source bên trái PHẢI render đúng vế Việt bên phải. KHÔNG được",
        "tự phiên Hán-Việt khác đi (đặc biệt với tên người — sai 1 ký tự là drift).",
        "",
    ]
    if name_map:
        lines.append("• Tên người (name_map):")
        for src, vi in name_map.items():
            lines.append(f'    {src} → "{vi}"')
    if term_map:
        lines.append("• Thuật ngữ / danh từ riêng phim (term_map):")
        for src, vi in term_map.items():
            lines.append(f'    {src} → "{vi}"')
    if place_map:
        lines.append("• Địa danh (place_map):")
        for src, vi in place_map.items():
            lines.append(f'    {src} → "{vi}"')
    lines.append("")
    lines.append("⚠️ TRƯỚC KHI XUẤT JSON: scan output — mỗi token source trong glossary")
    lines.append("   đã xuất hiện → kiểm tra render đúng entry chưa. Sai = SỬA NGAY.")
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
    is_vn = _is_vietnamese(target_lang)
    genre_block = _genre_style_guide(film_genre, target_lang)
    lang_notes = "" if is_vn else _target_language_notes(target_lang)
    # Content type profile: từ speaker_relationships.content_type (Pass-0
    # detect) — chỉ apply nếu target=VN (FE chưa thiết kế cho ngôn ngữ khác)
    content_type = (speaker_relationships or {}).get("content_type") if speaker_relationships else ""
    content_profile = _content_type_profile_vn(content_type) if is_vn else ""

    # Few-shot examples library — pattern matching > rule-only học cho LLM.
    # Chỉ inject khi target = VN (library hiện chỉ có cặp src→vi).
    few_shot_block = build_few_shot_block(
        genre=film_genre,
        content_type=content_type,
        target_lang=target_lang,
    ) if is_vn else ""

    # Auto-detect classical register từ register field hoặc scan source text.
    # Khi True → Pass-1 chỉ inject classical block (không show modern) để LLM
    # không bị phân vân giữa 2 register.
    reg_str = (speaker_relationships or {}).get("register", "") if speaker_relationships else ""
    src_text_concat = " ".join((s.get("original_text") or "") for s in segments[:50])
    is_classical = _detect_classical(reg_str, src_text_concat) or \
                   (film_genre or "").lower() in (
                       "historical", "wuxia", "xianxia", "cổ_trang",
                       "co_trang", "kiếm_hiệp", "kiem_hiep",
                       "tiên_hiệp", "tien_hiep",
                   )

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
    elif is_vn:
        anchor_block = """
🎭 KHÔNG CÓ SPEAKER MAP — TỰ SUY LUẬN (CỰC QUAN TRỌNG):

Batch này KHÔNG có tag SPEAKER_XX → bạn PHẢI tự xác định người nói cho mỗi line
từ NỘI DUNG TEXT, rồi GIỮ pronoun NHẤT QUÁN xuyên suốt batch.

BƯỚC 1 — ĐỌC TOÀN BỘ BATCH TRƯỚC khi dịch line nào.
BƯỚC 2 — Suy luận ai nói line nào từ tín hiệu sau:
   • Vocative: "老公/亲爱的/宝贝" → người vợ/người yêu nói với chồng/người yêu
   • Vocative: "老婆/媳妇" → chồng nói với vợ
   • Vocative: "妈/爸/爷爷/奶奶" → con nói với bố mẹ/ông bà
   • Tên riêng: gọi tên ai → KHÔNG phải người đó đang nói
   • Pattern hỏi-đáp: line 1 hỏi → line 2 trả lời = 2 speaker khác nhau
   • Câu chuyển chủ đề / tone đảo ngược thường = đổi speaker

BƯỚC 3 — Sau khi suy luận, ASSIGN pronoun NHẤT QUÁN:
   • Đánh nhãn nội bộ: SPEAKER A, SPEAKER B, SPEAKER C, ...
   • Mỗi speaker chỉ dùng 1 self_pronoun XUYÊN SUỐT batch
   • Mỗi cặp speaker chỉ dùng 1 cách xưng hô lẫn nhau
   • Ví dụ: nếu A là vợ → A luôn xưng "em" gọi B là "anh", B luôn xưng "anh" gọi A là "em"
   • KHÔNG được đầu batch "anh/em" cuối batch "tôi/cô" cho CÙNG cặp người

BƯỚC 4 — TRƯỚC KHI XUẤT OUTPUT, đọc lại line 1 và line cuối:
   • Nếu pronoun của cùng 1 speaker khác nhau → SỬA về thống nhất
   • Default cho vợ chồng / yêu nhau / mới cưới: "anh/em" (xem rule cứng bên dưới)

⚡ Nếu KHÔNG xác định được context (chỉ có 1-2 line ngắn không vocative):
   → MẶC ĐỊNH coi là vợ chồng/yêu nhau → DÙNG "anh/em".
   → KHÔNG bao giờ dùng "tôi/cô" làm default khi chưa rõ.
"""
    else:
        # Non-Vietnamese, no speaker map: ask LLM to self-detect & keep
        # pronouns / forms of address consistent per inferred speaker.
        anchor_block = """
🎭 NO SPEAKER MAP — INFER FROM TEXT (CRITICAL):

This batch has no SPEAKER_XX tags. You MUST identify who is speaking each line
from context, then KEEP forms of address / pronouns CONSISTENT for that
speaker across the entire batch.

STEP 1 — Read the ENTIRE batch BEFORE translating any line.
STEP 2 — Infer who speaks each line from signals:
   • Vocatives / terms of address ("honey", "mom", "sir") tell you the listener
   • Names in calls — the named person is NOT the speaker
   • Question→answer patterns mean speaker change between lines
   • Sudden tone reversal often = speaker change

STEP 3 — Assign internal labels (SPEAKER A, B, C…) and lock each speaker's
   pronoun / register choice. Do not switch a speaker mid-batch from formal
   to casual or vice versa unless the source clearly does.

STEP 4 — BEFORE producing output, re-read line 1 and the last line: if the
   SAME speaker uses different pronoun/register → unify them.

If only 1-2 lines and context is unclear, default to the warmer/more intimate
register typical for the genre, not the formal one.
"""

    # Glossary từ Pass-0 (name_map / term_map / place_map). Đây là bảng tra
    # cứu authoritative — đặt ngang tầm anchor_block (không vùi vào extra).
    glossary_from_rels = _format_glossary_block(speaker_relationships)
    glossary_section = ("\n" + glossary_from_rels + "\n") if glossary_from_rels else ""

    extra_block = ""
    if topic_hint:
        extra_block += f"\n📌 Topic: {topic_hint}\n"
    if glossary_block:
        extra_block += f"\n📖 Glossary (external):\n{glossary_block}\n"

    context_section = ""
    if context_before:
        ctx_lines = [f'  {c["index"]}. {c["original"]} → {c["translated"]}'
                     for c in context_before]
        context_section = "\nDIALOGUE TRƯỚC (chỉ tham khảo):\n" + "\n".join(ctx_lines)

    # Classical block extract ra biến trước f-string — Python 3.11 không
    # cho phép backslash trong f-string expression part.
    classical_block = ""
    if is_classical:
        classical_block = (
            "🏯🏯🏯 REGISTER = CỔ TRANG (auto-detected) — RULE BẮT BUỘC, "
            "KHÔNG ĐƯỢC SLIP VỀ MODERN GIỮA CHỪNG 🏯🏯🏯\n\n"
            "❌ FORBIDDEN — TUYỆT ĐỐI KHÔNG xuất hiện trong output:\n"
            "   anh / em (cho non-vợ-chồng); cảm ơn; tù nhân; giao dịch;\n"
            "   thầy bói; ok; bây giờ; tại sao; bạn (đại từ); tôi (khi formal);\n"
            "   xử tử (dùng \"xử trảm\"); đẹp trai; kết hôn (dùng \"thành thân\").\n"
            "→ Nếu bạn vừa định viết các từ trên, DỪNG LẠI → tra bảng substitution.\n\n"
            "✅ TỰ XƯNG (我):\n"
            "• Vua → \"trẫm\"            • Hoàng hậu/quý phi → \"bổn cung\"\n"
            "• Quan với vua → \"thần\"   • Phụ nữ với chồng/người trên → \"thiếp\"\n"
            "• Đàn ông khiêm tốn → \"tại hạ\" / \"thảo dân\"\n"
            "• Người tu hành → \"bần đạo\" / \"tại hạ\"\n"
            "• Tù phạm → \"thảo dân\" / \"tội nhân\"\n"
            "• Default → \"ta\" (KHÔNG \"tôi\")\n\n"
            "✅ GỌI NGƯỜI KHÁC (你/敬称):\n"
            "• Vua → \"bệ hạ\"           • Thái tử/hoàng tử → \"điện hạ\"\n"
            "• Vương → \"vương gia\"     • Tướng → \"tướng quân\"\n"
            "• Quan → \"đại nhân\"        • Học giả → \"tiên sinh\"\n"
            "• Phụ nữ tu hành → \"tiên tử\" / \"đạo cô\" / \"cô nương\"\n"
            "• Phụ nữ trẻ → \"tiểu thư\" / \"cô nương\"\n"
            "• Đàn ông trẻ → \"công tử\"\n"
            "• Vợ gọi chồng → \"phu quân\" / \"chàng\" / \"tướng công\"\n"
            "• Chồng gọi vợ → \"phu nhân\" / \"nương tử\" / \"nàng\"\n"
            "• Cha/mẹ → \"cha\"/\"mẹ\" (KHÔNG \"bố\"/\"má\")\n"
            "• Sư phụ / sư huynh → giữ nguyên\n\n"
            "✅ BẢNG SUBSTITUTION (BUỘC — mỗi từ phải dịch theo):\n"
            "   kết hôn      → thành thân / kết hôn ước / se duyên\n"
            "   tù nhân      → tử tù / phạm nhân / tội nhân\n"
            "   xử tử         → xử trảm / hành hình / pháp trường\n"
            "   giao dịch    → giao ước / thoả thuận\n"
            "   phù hợp     → hợp ý / xứng đôi\n"
            "   cảm ơn       → đa tạ / cảm tạ\n"
            "   ok / được   → được rồi / khá lắm\n"
            "   bây giờ     → giờ đây / lúc này\n"
            "   tại sao      → vì sao / cớ sao\n"
            "   về nhà       → hồi gia / trở về phủ\n"
            "   nhà (dinh) → phủ / đệ / gia\n"
            "   bạn         → huynh đệ / tỷ muội / bằng hữu\n"
            "   chết         → tạ thế / quy thiên / qua đời\n"
            "   thầy bói    → thầy tướng / đạo sĩ tướng số\n\n"
            "✅ PARTICLES: bỏ \"nhỉ/ha/à/ơi\" modern. Dùng \"ư?\" / \"vậy?\" / "
            "\"Bẩm…\" / \"Xin…\" / câu trần thuật ngắn.\n\n"
            "📝 FEW-SHOT (BEFORE → AFTER):\n"
            "❌ \"Cảm ơn đại ca\"             ✅ \"Đa tạ đại ca\"\n"
            "❌ \"Em trông rất trẻ\"          ✅ \"Tiên tử trông rất trẻ\"\n"
            "❌ \"Anh có người trong lòng\"   ✅ \"Đại nhân đã có người trong lòng\"\n"
            "❌ \"Anh muốn kết hôn\"          ✅ \"Đại nhân muốn thành thân\"\n"
            "❌ \"Sắp bị xử tử\"              ✅ \"Sắp bị xử trảm\"\n"
            "❌ \"Tôi rất phù hợp\"           ✅ \"Tại hạ rất hợp ý\"\n"
            "❌ \"Đây là giao dịch\"          ✅ \"Đây là giao ước\"\n"
            "❌ \"Anh ấy phạm tội gì?\"       ✅ \"Y phạm tội gì?\" / \"Người ấy phạm tội gì?\"\n"
            "❌ \"Vì sao bị xử tử gấp?\"      ✅ \"Cớ sao phải xử trảm gấp?\"\n\n"
            "⚠️ TRƯỚC KHI XUẤT JSON, SCAN output: nếu thấy bất kỳ FORBIDDEN word\n"
            "nào → SỬA NGAY. Đặc biệt check: cảm ơn / tù nhân / kết hôn / xử tử / giao dịch.\n"
        )

    if is_vn:
        system = f"""Bạn là TRANSLATOR phim chuyên nghiệp. Dịch lời thoại {src_name} → {tgt_name}.

🚨🚨🚨 QUY TRÌNH BẮT BUỘC — ĐỌC TRƯỚC, DỊCH SAU:

BƯỚC 1 — ĐỌC TOÀN BỘ DIALOGUE TRƯỚC TIÊN (tất cả N lines bên dưới):
   • Hiểu SCENE: đang ở đâu, ai vs ai, tâm trạng chung
   • Xác định DANH SÁCH NHÂN VẬT (tên + vai trò)
   • Xác định REGISTER: cổ trang / modern / business
   • Nhận diện CONFLICT / TƯƠNG TÁC giữa nhân vật
   • Tìm CÁC TÊN RIÊNG xuất hiện — quyết định Hán-Việt cho từng tên

BƯỚC 2 — TRƯỚC KHI DỊCH, GHI NHỚ:
   • Tên người = 1 cách viết DUY NHẤT xuyên suốt (Tâm Mi không thành Tâm Mỹ ở line khác)
   • Pronoun mỗi speaker = 1 cách xưng DUY NHẤT (đầu "anh" thì cuối cũng "anh")
   • Register chọn 1 lần → áp cho TẤT CẢ line

BƯỚC 3 — DỊCH TỪNG LINE theo thứ tự, dùng context từ BƯỚC 1+2.

BƯỚC 4 — TRƯỚC KHI XUẤT JSON: scan lại TẤT CẢ "translated" — đảm bảo
   tên + pronoun + register nhất quán. Nếu thấy slip → SỬA NGAY.

NHIỆM VỤ Pass này:
1. Nghĩa ĐÚNG (không paraphrase quá xa, không bịa)
2. Pronoun ĐÚNG (theo SPEAKER MAP nếu có)
3. Tên riêng ĐÚNG (Hán-Việt — KHÔNG pinyin)
4. KHÔNG vượt max_chars

KHÔNG cần lo style cinematic — Editor pass sẽ polish.
{content_profile}{genre_block}{anchor_block}{glossary_section}
{classical_block}

🚨🚨🚨 ANTI-ROBOT — CẤM DỊCH MÁY:

User báo bản dịch nhiều khi như Google Translate ("bạn/tôi" cho mọi quan
hệ, câu word-for-word). ĐÂY LÀ LỖI LỚN NHẤT. Cần tránh tuyệt đối.

❌ TUYỆT ĐỐI KHÔNG dùng "bạn"/"tôi" robot khi 2 người có quan hệ rõ:

   Hội thoại gia đình (mẹ ↔ con / ba ↔ con / anh ↔ em):
   ❌ "Tại sao BẠN lại quay lại?"   → ✅ "Sao con lại về?"
   ❌ "BẠN ăn cơm chưa?"            → ✅ "Con ăn cơm chưa?"
   ❌ "TÔI đã nói bao nhiêu lần"    → ✅ "Mẹ nói bao nhiêu lần"
   ❌ "Anh trai của BẠN"            → ✅ "Anh con" / "Anh trai con"
   ❌ "BẠN sống thế nào?"           → ✅ "Con sống sao?"

   Vợ chồng / yêu nhau:
   ❌ "BẠN đi đâu vậy?"             → ✅ "Anh đi đâu vậy?" (vợ hỏi chồng)
   ❌ "TÔI yêu BẠN"                 → ✅ "Em yêu anh" / "Anh yêu em"

   Sếp ↔ nhân viên:
   ❌ "TÔI cần BẠN làm việc này"   → ✅ "Em làm việc này giúp anh/chị"

   Bạn bè thân:
   ❌ "BẠN đến nhà TÔI"             → ✅ "Cậu đến nhà tớ" / "Mày đến nhà tao"

   "BẠN" CHỈ DÙNG KHI:
   • Người LẠ HOÀN TOÀN (vd nhân viên với khách hàng không quen)
   • Ngữ cảnh FORMAL công sở vô danh / tin tức / phỏng vấn
   • Sách giáo khoa, hướng dẫn user

❌ TUYỆT ĐỐI KHÔNG dịch literal word-by-word:

   ❌ "Tháng này BẠN đã nhận được lương chưa?"
   ✅ "Tháng này con nhận lương chưa?"

   ❌ "Đừng trở thành loại người trở nên giàu có chỉ sau một đêm"
   ✅ "Đừng có mơ tưởng làm giàu sau một đêm"

   ❌ "Bạn đã nói chuyện với mẹ như thế nào?"
   ✅ "Sao con dám nói với mẹ kiểu đó?"

   Cách dịch: ĐỌC HIỂU ý → DIỄN ĐẠT lại bằng tiếng Việt tự nhiên,
   KHÔNG translate từng từ.

⚡ PRONOUN — NGUYÊN TẮC UNIVERSAL (áp dụng cho MỌI thể loại):

1. THEO SPEAKER MAP nếu có — đó là DEFAULT tuyệt đối.

2. KHÔNG có map → infer QUAN HỆ từ CONTEXT TỪNG SCENE:
   • Có ai gọi "妈/爸/娘/爹" → đây là CHA MẸ ↔ CON → dùng "mẹ/ba/con"
   • Có ai gọi "老公/老婆/亲爱的" → VỢ CHỒNG → "anh/em"
   • Có ai gọi "哥/姐" → ANH/CHỊ ↔ EM → "anh/chị/em"
   • Có "老板/总裁/经理" → SẾP ↔ NHÂN VIÊN → "anh/chị/em" hoặc "ngài"
   • Cổ trang → "đại nhân/thiếp/tại hạ" (xem block CỔ TRANG)
   • CHỈ KHI không tìm được signal nào → mới fallback "bạn/tôi"

3. NHẤT QUÁN xuyên suốt batch:
   • Mỗi speaker chỉ dùng 1 self_pronoun từ đầu → cuối.
   • Mỗi cặp speaker chỉ dùng 1 cách gọi nhau từ đầu → cuối.
   • TRƯỚC KHI TRẢ JSON: scan lại tất cả line — nếu speaker đầu xưng A,
     cuối xưng B → SAI → SỬA về 1.

4. GENRE-AWARE: register/vocab tuân theo block 🎬 THỂ LOẠI ở trên (nếu có).
   Romance/drama dùng pronoun thân mật; news/documentary dùng formal;
   action câu ngắn. Đừng pha trộn register giữa các genre.

5. KHÔNG đoán emotion để tự ý đổi pronoun. Tone thể hiện qua TỪ NGỮ +
   TIỂU TỪ + nhịp câu, KHÔNG phải đổi đại từ.

🚨 RULE MAPPING ĐẠI TỪ (cho line có anchor — đọc kỹ TRƯỚC khi dịch):

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

🚨🚨🚨 KHÔNG ĐƯỢC BỎ SÓT (CRITICAL CHO LỒNG TIẾNG):

Mỗi line trong DIALOGUE có 1 timing slot trong video — nếu bạn để
"translated" RỖNG, slot đó sẽ MẤT TIẾNG (silent). User sẽ thấy nhân vật
mở miệng nhưng không có âm. RẤT XẤU.

→ MỌI line PHẢI có "translated" ≥ 1 ký tự.

KỂ CẢ interjection / filler 1-2 char gốc → PHẢI dịch, KHÔNG drop:
   嗯       → "Ừ" (thân) / "Vâng" (lễ phép)
   啊       → "À" / "Ơ" / "Ơ kìa"
   哦       → "Ồ" / "Ô" / "Vâng"
   哎       → "Ấy" / "Ôi" / "Ơ kìa"
   呃       → "Ờ" / "Ờm" / "Ừm"
   对       → "Ừ" / "Phải" / "Đúng"
   好       → "Được" / "Ờ" / "Tốt"
   嗯嗯    → "Ừ ừ" / "Vâng vâng"
   哈       → "Ha" / "Hả?" / "Ha ha"
   唉       → "Ai chao" / "Ôi" / "Hỡi"
   行        → "Được" / "Ổn"
   走        → "Đi nào" / "Đi thôi"
   咦       → "Ơ?" / "Ủa?"
   啧       → "Tch" / "Hứ"

NẾU source 1-2 char không trong list trên → tự dịch sang interjection
hoặc từ ngắn tương đương — TUYỆT ĐỐI KHÔNG để rỗng.

🔤 {_name_translation_rule(source_lang)}

🚨 NAME-CHARACTER FIDELITY (lỗi LLM hay mắc nhất với phim Trung):
   • DỊCH ĐÚNG character — đừng đoán nhầm sang char khác trông giống:
     - 眉 = "Mi" (lông mày) — KHÔNG phải Mai / Mộng / Mỹ
     - 心 = "Tâm" — KHÔNG phải Tân (心 ≠ 新)
     - 美 (Mỹ) / 梅 (Mai) / 妹 (Muội) / 梦 (Mộng) — 4 char khác nhau
     - 然 = "Nhiên" (không phải Nhan = 颜)
     - 莉 = "Lị" / 丽 = "Lệ" / 莉 ≠ 丽
   • BẢNG SURNAME DISAMBIGUATION (LLM hay slip):
     - 林 = "Lâm" (rừng/họ Lin) — TUYỆT ĐỐI KHÔNG "Linh"
     - 灵 = "Linh" (tinh linh/灵气) — KHÔNG "Lâm"
     - 凌 = "Lăng" (đỉnh cao/họ Ling) — KHÔNG "Lâm" hoặc "Linh"
     - 陈 = "Trần" — KHÔNG "Chân" hoặc "Tân"
     - 沈 = "Thẩm" — KHÔNG "Trầm"
     - 邓 = "Đặng" — KHÔNG "Đăng"
     - 蒋 = "Tưởng" — KHÔNG "Tương"
     - 钱 = "Tiền" — KHÔNG "Tiển"
     ⚠️ Khi thấy 林氏 / 林家 / 林集团 → CHẮC CHẮN "Lâm thị/gia/tập đoàn",
        scene có vẻ tâm linh / huyền huyễn cũng KHÔNG đổi sang "Linh".
   • TUYỆT ĐỐI KHÔNG dùng pinyin (Chen Yu / Wang Xiao / Xin Mei) ở output.
     Pinyin đọc dub ra âm tiếng Anh-Việt lai rất tệ. Luôn phiên Hán-Việt
     mỗi character (tra BẢNG HỌ + ÂM PHỔ BIẾN ở trên).
   • TUYỆT ĐỐI KHÔNG dùng Romaji Nhật cho tên Trung. Source là tiếng Trung
     → 列子 phải đọc "Liệt Tử" Hán-Việt, KHÔNG "Retsuko" (Romaji).
     → 明月 phải đọc "Minh Nguyệt" Hán-Việt, KHÔNG "Mingyue" (pinyin)
       và KHÔNG "Meigetsu" (Romaji).
   • TUYỆT ĐỐI KHÔNG hallucinate từ tiếng Anh không có trong source.
     Vd 锐器 phải dịch "vũ khí sắc" / "binh khí", KHÔNG "Rapier" (tự đặt từ
     tiếng Anh không có trong gốc).
   • Output CHỈ chứa: tiếng Việt thuần / Hán-Việt cho tên riêng / con số.
     KHÔNG có chữ Trung gốc, KHÔNG pinyin, KHÔNG Romaji Nhật, KHÔNG từ Anh
     không phải tên thương hiệu / acronym kỹ thuật.

🚨 NAME-STABILITY XUYÊN SUỐT BATCH (BẮT BUỘC SCAN LẠI):
   • 1 nhân vật = 1 cách viết DUY NHẤT. Đầu batch "Tâm Mi" thì cuối batch
     CŨNG phải "Tâm Mi" (không slip thành "Tâm Mỹ" / "Tân Mai").
   • TRƯỚC KHI XUẤT JSON: scan tất cả translated lines — collect tên riêng
     đã render — nếu cùng source char sequence (vd 心眉) mà có 2+ Việt
     name → CHỌN MỘT (cách đầu tiên) → SỬA TẤT CẢ về một spelling.
   • Áp dụng cho cả tên riêng lẫn vocative ("Tiểu Bảo" / "Tiểu Bão" → chọn 1).

🚨 INPUT MIXED LANGUAGE / NOISE (RẤT QUAN TRỌNG):

Source text có thể chứa:

1) Pinyin lọt từ Whisper STT (nhận diện không hoàn hảo):
   ❌ "Nǐ suǒ chén" / "Wǒ ài nǐ" / "Lao Wang"
   ✅ DỊCH: phiên Hán-Việt → "Anh nói gì?" / "Em yêu anh" / "Lão Vương"
   → Khi thấy chuỗi Latin có dấu thanh ǎǐǒǔē hoặc Capital + lowercase
   pattern (Lao/Xiao + Name), đây là CHẮC CHẮN pinyin → tra Hán-Việt
   tương đương rồi dịch ý câu. KHÔNG copy nguyên pinyin vào output.

2) Tiếng Anh THẬT trong phim (scene học tiếng Anh, nhân vật nước ngoài,
   thương hiệu quốc tế, câu trích dẫn):
   ✅ DỊCH ý sang tiếng Việt cho người Việt hiểu, ghi chú thể loại nếu cần.
   Vd: "I love you" trong scene học → "Em yêu anh"
       "Time is money" trong bài giảng → "Thời gian là tiền bạc"
   → KHÔNG giữ nguyên tiếng Anh trừ khi là TÊN RIÊNG nổi tiếng / acronym
   kỹ thuật (BMW, NASA, iPhone — giữ nguyên).

3) Whisper hallucinate (tiếng nhạc/silence bị bịa thành câu vô nghĩa):
   ❌ "So Pierre with Stocks Pierre" / "Thank you" / "Bye bye" lặp lại
   → Nếu line ngắn + vô nghĩa + không khớp context scene → ĐÁNH GIÁ:
   • Giữ ý đúng context (vd dialogue đang nói A/B → đoán B response)
   • HOẶC trả "" (chuỗi rỗng) nếu thực sự là rác, để pipeline downstream
     bỏ qua khỏi dub. Đừng nhồi câu vô nghĩa vào output.

⚡ Mục tiêu: output Việt MƯỢT, không xen pinyin/raw English, không câu
vô nghĩa. User xem dub không cần biết nguồn STT bị lỗi gì.

🛑 RULE CHỐNG BỊA (CỰC QUAN TRỌNG — gặp khi Whisper transcribe lỗi):

Khi câu nguồn chứa từ KHÔNG có nghĩa rõ ràng (vd "建设等你" = "xây dựng
đợi ngài" — vô nghĩa context):
   ❌ KHÔNG bịa cụ thể: "khu chợ trên tầng ba" / "Vạn Hậu Tống Khắc"
       — đây là LLM tự đặt detail không có trong gốc → SAI HOÀN TOÀN.
   ✅ DỊCH NGUYÊN literal câu (kể cả nghe gãy gọn) HOẶC dịch generic:
       "Nếu không cô ấy sẽ đợi ngài ở dưới" (giữ ý "đợi") thay vì
       sáng tạo địa điểm.
   ✅ Tên company / tổ chức không rõ source → giữ chung "công ty đó" /
       "tổ chức đó" + tên speaker đã biết, KHÔNG sáng tạo tên mới.

Nguyên tắc: thà DỊCH NGẮN ÍT NGHĨA còn hơn BỊA DETAIL không có trong gốc.
User nghe dub có thể nhận ra câu ngắn = STT yếu, nhưng nếu nghe câu bịa
chi tiết SAI thì mất hết tin tưởng pipeline.
{few_shot_block}{extra_block}{context_section}
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
    else:
        # Generic professional translator path — any target language.
        system = f"""You are a PROFESSIONAL film dialogue translator. Translate
{src_name} → {tgt_name}.

🚨🚨🚨 MANDATORY PROCESS — READ FIRST, TRANSLATE SECOND:

STEP 1 — READ THE ENTIRE DIALOGUE FIRST (all N lines below):
   • Understand SCENE: where, who's interacting, overall mood
   • Identify CHARACTER ROSTER (names + roles)
   • Determine REGISTER: historical / modern / formal / casual
   • Identify CONFLICTS and INTERACTIONS between characters
   • Spot all PROPER NOUNS — decide target-language spelling per name

STEP 2 — LOCK IN consistency choices BEFORE translating:
   • Each proper noun = ONE spelling for the whole batch
   • Each speaker = ONE pronoun/register choice for the whole batch
   • Pick the register once and apply to every line

STEP 3 — TRANSLATE line by line using context from Steps 1+2.

STEP 4 — BEFORE EMITTING JSON, scan ALL "translated" lines. If any name
   or pronoun drifted across the batch → FIX before output.

PASS GOAL (literal accuracy + register consistency, NOT polish):
1. Meaning ACCURATE — no paraphrase drift, no invented content.
2. Forms of address CONSISTENT per speaker (use SPEAKER MAP if provided;
   otherwise infer from context and lock per speaker).
3. Proper nouns handled correctly (see name rule below).
4. STAY within max_chars budget per line — concise wording preferred.

Style polishing happens in a later Editor pass — your job here is faithful
meaning + correct register + budget.
{genre_block}{lang_notes}{anchor_block}
🎯 REGISTER & PRONOUN DISCIPLINE (CRITICAL):

• Each speaker keeps the SAME pronoun choice / politeness level across the
  whole batch. Don't switch between formal and casual mid-conversation unless
  the source clearly does (e.g. argument breaks formality on purpose).
• Match the form of address to the relationship between speakers:
    - Family / intimate partners → intimate/informal forms native to target
    - Stranger / superior / public → formal forms native to target
    - Children → simpler vocabulary, age-appropriate forms
• Match register to the GENRE block above. Romance ≠ Action ≠ Documentary.

⚠️ When the source uses pro-drop (Japanese/Korean/Chinese drop subjects), do
NOT auto-insert pronouns in the target if the target also allows dropping.
Add a pronoun only when grammar/clarity demands it.

🚨 ANCHOR MAPPING (when SPEAKER MAP is provided):

Each line has an anchor `[Role: I="X" | → Target: you="Y"]` meaning:
   • First-person source pronouns → use "X" (the speaker's self-pronoun)
   • Second-person source pronouns → use "Y" (the addressee form)
   • Third-person source pronouns → use the third-person label of that person

NEVER swap I and you. The most common mistake is mapping the speaker's "I"
pronoun onto a "you" in the source (or vice versa). Read each anchor fresh
per line.

✏️ NAME HANDLING — CRITICAL FIDELITY RULES:
{_name_translation_rule(source_lang)}

🚨 NAME-CHARACTER FIDELITY (top mistake LLMs make):
   • Match the EXACT character. Don't substitute look-alike characters:
     - 眉 = "Mi" (eyebrow) — NEVER "Mai/Mộng/Mỹ"
     - 心 = "Tâm" — NEVER "Tân"
     - 美 = "Mỹ" / 梅 = "Mai" / 妹 = "Muội" / 梦 = "Mộng" — DIFFERENT chars
   • When target = Vietnamese: ALWAYS use Hán-Việt transliteration of every
     character. NEVER output raw pinyin (e.g. "Chen Yu", "Wang Xiao") —
     it produces broken TTS audio. See the surname + common-character tables
     in the name handling section above.

🚨 NAME-STABILITY ACROSS BATCH (DO NOT LET NAMES DRIFT):
   • Once you render a name (e.g. "Tâm Mi"), use the IDENTICAL spelling
     for ALL subsequent occurrences in this batch.
   • Before output, SCAN your translations for the same source character
     sequence (e.g. 心眉) and confirm they map to the SAME Vietnamese name.
   • If you see line 3 says "Tâm Mi" and line 14 says "Tâm Mỹ" for the same
     source 心眉 → SAI → unify to one rendering (use the first one).

📏 BUDGET: each line has [max N chars] = HARD upper bound (counted in target-
language characters). Trim fillers, particles, redundancies as needed. The
target text often expands ~20-30% from source — plan for that compression.
{extra_block}{context_section}
OUTPUT ONE JSON OBJECT (no markdown fences):
{{
  "translations": [
    {{"index": 1, "translated": "...", "emotion": "neutral"}},
    {{"index": 2, "translated": "...", "emotion": "happy"}}
  ]
}}
• "translated": faithful + register-correct + ≤ max_chars (target chars)
• "emotion": one of neutral / happy / sad / angry / whisper / surprised / fearful
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
    film_genre: Optional[str] = None,
) -> dict:
    """Pass-2: polish literal translation thành lời thoại phim tự nhiên.

    Vietnamese target: bám sát style VTV/phim Việt (tiểu từ + cảm xúc).
    Ngôn ngữ khác: polish theo convention native của target language +
    register theo genre.

    Args:
      items: list[{index, speaker, original, literal, max_chars, role?}]
      film_genre: optional — gắn vào để genre_style_guide kick in.

    Output JSON: {"polished": [{"index", "translated", "emotion"}]}
    """
    tgt_name = _lang_display_name(target_lang)
    is_vn = _is_vietnamese(target_lang)
    genre_block = _genre_style_guide(film_genre, target_lang)
    lang_notes = "" if is_vn else _target_language_notes(target_lang)

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

    # Glossary cũng inject vào Editor — đảm bảo Pass-2 không drift tên ngay
    # cả khi Pass-1 đã render đúng. Chỉ áp dụng VN.
    glossary_from_rels = _format_glossary_block(speaker_relationships) if is_vn else ""
    glossary_section = ("\n" + glossary_from_rels + "\n") if glossary_from_rels else ""

    is_classical = "cổ trang" in register.lower() or "wuxia" in register.lower() \
        or "xianxia" in register.lower() or "historical" in register.lower() \
        or (film_genre or "").lower() in ("historical", "wuxia", "xianxia",
                                          "cổ_trang", "co_trang", "kiếm_hiệp",
                                          "kiem_hiep", "tiên_hiệp", "tien_hiep")

    if is_vn:
        classical_block = ""
        if is_classical:
            classical_block = """
🏯 CẢNH BÁO REGISTER = CỔ TRANG / HISTORICAL — POLISH PHẢI CỔ TRANG:

❌ NẾU LITERAL DÙNG TỪ MODERN → BẮT BUỘC SỬA:
   • "anh/em" (vợ chồng cổ trang) → "chàng/thiếp" / "phu quân/nương tử"
     hoặc "đại nhân/tiểu nữ" / "công tử/cô nương" tuỳ quan hệ
   • "tôi" → "ta" / "tại hạ" / "thảo dân" / "thần"
   • "bạn" → "huynh đài" / "tỷ muội" / "bằng hữu"
   • "kết hôn" → "thành thân" / "se duyên"
   • "tù nhân" → "tử tù" / "phạm nhân"
   • "xử tử" → "xử trảm"
   • "giao dịch" → "giao ước"
   • "phù hợp" → "hợp ý" / "xứng đôi"
   • "cảm ơn" → "đa tạ" / "cảm tạ"
   • "bây giờ" → "giờ đây" / "lúc này"
   • "tại sao" → "vì sao" / "cớ sao"
   • "về nhà" → "hồi gia" / "trở về phủ"
   • "nhà" (chỉ dinh thự) → "phủ" / "đệ"
   • "chết" → "tạ thế" / "quy thiên" (formal) / "qua đời"
   • "ok/được" → "được rồi" / "khá lắm"

❌ PARTICLES MODERN (nhỉ/ha/à modern colloquial) → ✅ thay "ư?" / "vậy?" /
   bỏ luôn (cổ trang ít dùng tiểu từ tail).

❌ "Ba/Mẹ" cho cha mẹ trong cổ trang → ✅ "Cha/Mẹ" hoặc "Phụ thân/Mẫu thân"
   (formal); "Cha cha/Nương" (thân).

✅ Cảm thán cổ trang OK: "Ơ kìa…", "Hỡi ôi…", "Phải rồi…", "Quả vậy…"

GIỮ formal/honorific xuyên suốt — đừng pha modern slang giữa câu.
"""

        system = f"""Bạn là EDITOR phim chuyên dub VTV — chuyển lời dịch literal thành
lời thoại phim CÓ HỒN, tự nhiên, biểu cảm.

INPUT: mỗi line có literal translation đã ĐÚNG nghĩa.
NHIỆM VỤ: polish thành câu PHIM thật — TỰ NHIÊN + CÓ CẢM XÚC + match emotion
với scene_context. CHO PHÉP đổi pronoun nếu literal sai emotion (ví dụ:
vợ chồng đang ly hôn mà literal dùng "anh/em" thân mật → đổi sang "tôi/cô" lạnh).
{classical_block}

{scene_block}{genre_block}{glossary_section}
🚨🚨🚨 RULE TUYỆT ĐỐI VỀ PRONOUN — KHÔNG ĐƯỢC ĐỔI:

⚡ NHẤT QUÁN XUYÊN SUỐT: pronoun của MỖI SPEAKER phải GIỐNG NHAU từ đầu
   tới CUỐI batch. KHÔNG đổi giữa chừng (vd đầu "anh" cuối "em").
   - Đọc literal lines → xác định speaker xưng gì (anh/em/con/...)
   - GIỮ NGUYÊN xưng hô đó cho TẤT CẢ line của speaker này.
   - Đặc biệt CUỐI BATCH dễ slip — đọc lại line đầu để check.

⚡ Vợ chồng / cặp đôi: PHẢI "anh/em" (kể cả literal có "tôi/cô" do Pass-1
   nhầm). Editor SỬA NGƯỢC LẠI nếu literal sai pronoun:
   - literal "tôi/cô" cho vợ chồng → SỬA thành "anh/em"
   - literal "ông/bà" cho con-cha mẹ → SỬA thành "bố/mẹ"

⚡ "Tôi/cô" CHỈ giữ khi: đã ly hôn chính thức / thoại từ chối rõ ràng.

⚡ KHÔNG TỰ ĐỔI pronoun ở cuối câu/cuối batch chỉ vì nghĩ "câu này tone
   khác". Tone thể hiện qua TIỂU TỪ + TỪ NGỮ, KHÔNG phải đổi pronoun.

Editor TASK: polish style (thêm tiểu từ, đảo từ, cảm xúc) + SỬA pronoun
sai về DEFAULT "anh/em" cho vợ chồng + "con/bố/mẹ" cho gia đình.
GIỮ pronoun NHẤT QUÁN xuyên suốt cho mỗi speaker.


🚨 KHÔNG BỎ SÓT INTERJECTION (CRITICAL — mất audio = mất tiếng cảnh):
   • Mỗi line trong INPUT phải có "translated" ≥ 1 ký tự ở OUTPUT.
   • KHÔNG được drop "Ừ/À/Ờ/Vâng/Hả?" dù chúng có vẻ "thừa" — chúng có
     timing slot trong video. Drop = silent gap khi dub.
   • Nếu literal là interjection ngắn → POLISH thành interjection Việt
     tự nhiên hơn, KHÔNG xoá:
       "Đúng vậy" → "Ừ" / "Phải rồi"
       "Vâng" → "Ừ" (thân) / "Vâng ạ" (lễ phép)
       "Không" (đơn) → "Không" / "Đâu có" / "Hổng phải"

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
3. GIỮ tên riêng y nguyên (Tiểu Bảo, Văn Tịch...). KIỂM TRA tất cả lines:
   nếu cùng 1 nhân vật mà tên khác spelling (vd "Tâm Mi" line 3, "Tâm Mỹ"
   line 7) → SỬA về 1 cách viết duy nhất. Không đổi 眉 (Mi) thành 美 (Mỹ).
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
    else:
        # Generic professional editor — any target language.
        system = f"""You are a PROFESSIONAL film dialogue EDITOR polishing literal
translations into {tgt_name} that sounds like real film dialogue.

INPUT: each line already has correct meaning (from a literal Pass-1).
YOUR JOB: rewrite each line so it sounds NATIVE and NATURAL in {tgt_name},
matches the emotion of the scene, and respects the budget. You may rearrange
words and add target-language particles/contractions to make it sound real —
but DO NOT change the meaning.

{scene_block}{genre_block}{lang_notes}
🎯 CORE RULES:

1. CONSISTENCY: each speaker keeps the same pronoun choice / politeness level
   across the whole batch. If the literal has a slip (e.g. line 1 formal,
   line 12 casual for the same speaker→listener pair), unify to the form
   the speaker has been using.

2. NATURAL CADENCE: written translation reads stilted; spoken dialogue is
   different. Use the target language's:
   - contractions / clitics (where natural)
   - sentence-final particles / modal particles
   - ellipsis where the audience already knows the subject
   - rhetorical questions / interjections to carry emotion

3. EMOTION-MATCHED REWRITES: the same content can sound flat or alive
   depending on word order, exclamations, and softeners. Pick the version
   that matches the emotion of the source — but stay faithful to meaning.

4. RHYTHM > LENGTH: better to cut filler than overrun the char budget.
   Each line ≤ max_chars (hard).

5. PROPER NOUNS / SPECIAL TERMS: preserve names exactly as Pass-1 wrote
   them. Do not re-translate or re-romanize.

6. GENRE: respect the genre block above. Romance is tender, action is curt,
   documentary is neutral. Don't apply VN-only patterns (anh/em, tiểu từ).

✏️ MISTAKES TO AVOID:
❌ Translationese: word-for-word from literal, ignoring native phrasing.
❌ Over-formal in a casual scene, or over-casual in a formal scene.
❌ Pronoun flip mid-batch (formal start, casual end) without scripted cause.
❌ Padding to fill silence — short native lines beat verbose stretched ones.
❌ Adding emotion the source doesn't have (smile-talk in a tense scene).

OUTPUT ONE JSON OBJECT (no markdown fences):
{{
  "polished": [
    {{"index": 1, "translated": "polished line", "emotion": "neutral"}},
    {{"index": 2, "translated": "polished line", "emotion": "happy"}}
  ]
}}
• "translated": fluent {tgt_name} ≤ max_chars (target chars)
• "emotion": neutral / happy / sad / angry / whisper / surprised / fearful
"""
    user_input = f"TARGET: {tgt_name} — POLISH LITERAL LINES BELOW:\n\n" + "\n".join(item_lines)
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
