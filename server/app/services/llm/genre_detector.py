"""Auto-detect film genre/register từ original text.

Output 1 trong các genre:
  - historical_zh: phim cổ trang Trung Quốc (vương triều, hoàng cung)
  - historical_ko: phim cổ trang Hàn (vua, quý tộc Joseon)
  - historical_jp: phim cổ trang Nhật (samurai, daimyo)
  - modern_drama: phim hiện đại đời thường, công sở, gia đình
  - action: phim hành động, chiến tranh, thriller
  - romcom: phim tình cảm hiện đại (yêu, hẹn hò)
  - news: tin tức, phỏng vấn, documentary
  - generic: không detect được rõ → dùng default neutral

Mục tiêu: tune Gemini/OpenAI/Claude prompt theo genre cho pronoun + register
phù hợp. Phim cổ trang dùng "trẫm/khanh/nàng/chàng", hiện đại dùng "anh/em".

Algorithm: keyword-vote score per genre, pick max. Fast (<10ms cho text
50KB) — không cần ML model.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Optional

logger = logging.getLogger(__name__)


# Keywords typed Han characters (CJK) — chỉ count match đầy đủ word
# để tránh false positive (vd 朕 chỉ vua TQ dùng)
GENRE_KEYWORDS: dict[str, list[str]] = {
    "historical_zh": [
        # Hoàng cung, vua chúa
        "朕", "陛下", "皇上", "圣上", "万岁",
        # Tước vị nữ
        "皇后", "贵妃", "贵嫔", "公主", "郡主", "本宫", "妾身", "奴婢", "嬷嬷",
        # Tước vị nam
        "王爷", "皇子", "太子", "驸马", "公子", "少爷", "大人",
        # Quan chức
        "微臣", "在下", "草民", "卑职", "丞相", "尚书", "侍郎",
        # Cổ ngữ
        "夫君", "相公", "娘子", "姑娘", "小姐", "本王", "本宫", "孤", "寡人",
    ],
    "historical_ko": [
        "폐하", "전하", "마마", "낭자", "도령", "양반", "선비", "왕자", "공주",
        "妃", "嬪", "殿下",
    ],
    "historical_jp": [
        "殿下", "陛下", "様", "御前", "侍", "将軍", "幕府", "藩主",
        "拙者", "それがし", "御免", "申し上げ",
    ],
    "modern_drama": [
        # Công sở
        "老板", "总裁", "总经理", "经理", "秘书", "助理", "客户", "项目",
        "微信", "电话", "电脑", "邮件", "公司", "上班", "下班", "加班",
        # Gia đình hiện đại
        "妈妈", "爸爸", "老婆", "老公", "孩子", "儿子", "女儿", "学校",
        # Đời sống
        "咖啡", "外卖", "出租车", "地铁", "手机",
    ],
    "action": [
        "司令", "指挥官", "中尉", "上校", "队长", "战友", "敌人", "战争",
        "射击", "爆炸", "炸弹", "枪", "刀", "战斗", "任务", "部队",
        "特工", "间谍", "卧底", "黑帮", "毒品",
    ],
    "romcom": [
        "约会", "喜欢你", "爱你", "男朋友", "女朋友", "情人节", "恋爱",
        "结婚", "婚礼", "求婚", "前任", "心动", "暗恋", "告白",
        "亲爱的", "宝贝", "甜心",
    ],
    "news": [
        "记者", "新闻", "采访", "报道", "今日", "本台", "据悉", "消息",
        "事件", "调查", "声明", "发布会", "评论",
    ],
}


def detect_genre(text: str, *, debug: bool = False) -> str:
    """Detect genre từ text. text = concat tất cả original_text các segment.

    Returns 1 trong: historical_zh, historical_ko, historical_jp, modern_drama,
    action, romcom, news, generic.

    Algorithm:
      - Count keyword match per genre (substring search, không phân biệt câu)
      - Score = total_matches / num_keywords (normalize tránh bias keyword nhiều)
      - Pick genre có score cao nhất, score min ≥ 0.05 (≥5% keyword match) để
        tránh random hit
      - Tie-breaker: historical > action > romcom > news > modern_drama (theo
        đặc trưng — historical có pronoun đặc thù nhất)
    """
    if not text or len(text) < 20:
        return "generic"

    # Count matches per genre
    scores: dict[str, float] = {}
    matches_detail: dict[str, int] = {}
    for genre, keywords in GENRE_KEYWORDS.items():
        matches = sum(text.count(kw) for kw in keywords)
        matches_detail[genre] = matches
        # Normalize bằng số keyword (genre có nhiều keyword không bias hơn)
        scores[genre] = matches / max(1, len(keywords))

    if debug:
        logger.info("Genre detection scores: %s", scores)

    # Pick max nếu vượt threshold
    sorted_genres = sorted(
        scores.items(),
        key=lambda kv: (-kv[1], _genre_priority(kv[0])),
    )
    top_genre, top_score = sorted_genres[0]

    if top_score < 0.05:
        return "generic"

    # Bonus: nếu top score chỉ nhỉnh hơn second 20% → đôi khi mixed.
    # Vẫn chọn top nhưng log info.
    second_score = sorted_genres[1][1] if len(sorted_genres) > 1 else 0
    if second_score > 0 and top_score / second_score < 1.2:
        logger.info(
            "Genre ambiguous: %s (%.3f) vs %s (%.3f) — pick %s",
            top_genre, top_score, sorted_genres[1][0], second_score, top_genre,
        )

    logger.info(
        "Genre detected: %s (matches: %d) | top3: %s",
        top_genre, matches_detail.get(top_genre, 0),
        [(g, matches_detail[g]) for g, _ in sorted_genres[:3]],
    )
    return top_genre


def _genre_priority(genre: str) -> int:
    """Tie-breaker: historical genres > action > romcom > news > modern_drama."""
    order = {
        "historical_zh": 1,
        "historical_ko": 2,
        "historical_jp": 3,
        "action": 4,
        "romcom": 5,
        "news": 6,
        "modern_drama": 7,
        "generic": 99,
    }
    return order.get(genre, 50)


def get_genre_prompt_block(genre: str) -> str:
    """Generate genre-specific prompt block để inject vào LLM system message.

    Block này thay thế hoặc bổ sung cho generic pronoun rule, giúp LLM chọn
    đúng register cho phim.
    """
    if genre == "historical_zh":
        return """
═══════════════════════════════════════════════════════════════
🎬 GENRE: PHIM CỔ TRANG TRUNG QUỐC

PRONOUN BẮT BUỘC (KHÔNG dùng "anh/em/bạn/tôi/mình" — đây là phim cổ!):

Hoàng tộc:
  • Vua tự xưng: "trẫm" — gọi quan: "khanh", "ái khanh"
  • Quan xưng vua: "bệ hạ" — tự xưng: "thần", "vi thần", "hạ thần"
  • Hoàng hậu/Phi tần: "ai gia" / "bổn cung" — gọi vua: "bệ hạ"
  • Công chúa/Quận chúa: "bổn cung" / "ta" — gọi nam: "ngươi" / "công tử"
  • Hoàng tử/Vương gia: "bổn vương" / "ta" — gọi quan: "khanh"

Quý tộc/dân thường:
  • Công tử ↔ Tiểu thư: "ta" / "nàng" / "chàng" / "thiếp"
  • Nam-nữ yêu nhau: "ta" / "nàng" (nam) — "thiếp" / "chàng" (nữ)
  • Người ngang vai: "ngươi/ta", "huynh/đệ", "tỷ/muội"
  • Hạ nhân với chủ: "nô tài" / "tiểu nô" — gọi chủ: "chủ tử" / "công tử"

NGÔN NGỮ: trang trọng, văn ngữ. Gặp tên gọi (郡主, 公子) giữ nguyên dạng:
"Quận chúa", "Công tử", "Vương gia", "Bệ hạ".
"""
    if genre in ("historical_ko", "historical_jp"):
        return f"""
═══════════════════════════════════════════════════════════════
🎬 GENRE: PHIM CỔ TRANG {("HÀN QUỐC" if genre == "historical_ko" else "NHẬT BẢN")}

Pronoun cổ trang Đông Á chung: "ta/nàng/chàng/khanh/bệ hạ/điện hạ".
KHÔNG dùng "anh/em/bạn/tôi/mình".
Tước vị giữ phiên âm Hán-Việt: "Điện hạ", "Mẫu hậu", "Tướng quân".
"""
    if genre == "modern_drama":
        return """
═══════════════════════════════════════════════════════════════
🎬 GENRE: PHIM HIỆN ĐẠI / GIA ĐÌNH / ROMCOM

⚠️ TUYỆT ĐỐI KHÔNG dùng "bạn/tôi" làm pronoun mặc định cho mọi quan hệ.
   "Bạn" chỉ dùng khi 2 người KHÔNG QUEN. Mọi quan hệ thân thuộc khác
   PHẢI dùng đúng pronoun gia đình/xã hội Việt Nam.

PRONOUN MATRIX BẮT BUỘC (xác định từ ngữ cảnh ai nói với ai):

🔸 Vợ chồng / Người yêu nam-nữ:
   • Nam → nữ: tự xưng "anh", gọi "em" — VD: "Anh yêu em"
   • Nữ → nam: tự xưng "em", gọi "anh"
   • CẤM dùng "tôi/bạn" cho cặp đôi yêu/cưới.

🔸 Cha mẹ ↔ con cái (RẤT QUAN TRỌNG — KHÔNG được nhầm):
   "Con" là từ con cái TỰ XƯNG khi nói với cha mẹ. KHÔNG phải từ
   gọi/xưng người khác.

   • Cha/mẹ NÓI VỚI con:
     - Cha/mẹ tự xưng: "ba" / "bố" / "cha" / "mẹ"
     - Cha/mẹ gọi con: "con" (đại từ ngôi 2)
     - VD: cha nói "Con ăn cơm chưa?" — tự xưng "ba", gọi con "con"

   • Con NÓI VỚI cha mẹ:
     - Con tự xưng: "con" (đại từ ngôi 1)
     - Con gọi cha mẹ: "ba" / "bố" / "cha" / "mẹ"
     - VD: con nói "Con đi học đây, mẹ" — tự xưng "con", gọi mẹ "mẹ"

   ❌ TUYỆT ĐỐI KHÔNG:
   - Con dùng "con" gọi cha mẹ ("Con ăn cơm chưa?" KHÔNG phải con nói với mẹ)
   - Cha/mẹ dùng "con" tự xưng ("Con đi làm" KHÔNG phải cha nói)
   - Vợ chồng dùng "con" gọi nhau (chỉ dùng "anh/em")
   - Bạn bè dùng "con" gọi nhau

🔸 Anh/chị ↔ em ruột:
   • Lớn tự xưng: "anh"/"chị", gọi: "em"
   • Nhỏ tự xưng: "em", gọi: "anh"/"chị"
   • Em trai gọi chị: "chị X" + tự xưng "em"

🔸 Cô/dì/chú/bác ↔ cháu:
   • Lớn tự xưng "cô/dì/chú/bác", gọi "cháu"
   • Nhỏ gọi "cô/dì/chú/bác", tự xưng "cháu"

🔸 Bạn bè cùng tuổi:
   • Thân: "tao/mày" (riêng tư) hoặc "tớ/cậu" (lịch sự)
   • Vừa: "mình/bạn" hoặc "tôi/cậu"

🔸 Đồng nghiệp công sở:
   • Cùng cấp: "tôi/anh", "tôi/chị" (lịch sự)
   • Sếp ↔ nhân viên: "sếp" / "em" hoặc "anh/chị" / "em"

🔸 Người lạ / xa lạ / lễ tân:
   • Trang trọng: "tôi/quý khách", "tôi/bà/ông"
   • Đó MỚI là chỗ "tôi/bạn" hợp.

NGUYÊN TẮC:
  1. Đọc CONTEXT từ tổng scene, identify quan hệ trước khi dịch.
  2. Cùng 1 cặp speaker phải có pronoun NHẤT QUÁN xuyên suốt.
  3. Tên riêng giữ nguyên: "Wenxi", "A Tự", "ông Trương" — KHÔNG dịch
     thành tên Việt hay từ chung khác.

NGÔN NGỮ: tự nhiên, hơi colloquial. "我去工作" → "Anh đi làm" (chồng nói
với vợ) hoặc "Em đi làm" (vợ nói với chồng), KHÔNG phải "Tôi đi công việc".
"""
    if genre == "action":
        return """
═══════════════════════════════════════════════════════════════
🎬 GENRE: PHIM HÀNH ĐỘNG / QUÂN SỰ

Pronoun: ngắn gọn, mệnh lệnh.
  • Cấp trên ra lệnh: "tôi/anh em" (tướng), "đồng chí" (quân đội)
  • Cãi nhau / cao trào: "tao/mày", "thằng/con"
  • Thân mật chiến hữu: "anh/em" (nam-nam)

NGÔN NGỮ: ngắn, súc tích, không hoa mỹ. Tăng động từ mệnh lệnh: "Đi!", "Đứng
lại!", "Bắn!". Tránh câu dài, giữ tempo dồn dập.
"""
    if genre == "romcom":
        return """
═══════════════════════════════════════════════════════════════
🎬 GENRE: PHIM TÌNH CẢM HIỆN ĐẠI

Pronoun:
  • Yêu nhau: "anh/em" (nam-nữ) — bắt buộc, KHÔNG đảo ngược
  • Bạn thân ngang tuổi: "tớ/cậu" hoặc "mình/bạn"
  • Gọi yêu: "anh yêu", "em yêu", "chồng ơi", "vợ ơi" (cả khi chưa cưới
    đôi yêu nhau gọi đùa)

NGÔN NGỮ: ngọt ngào, mềm mại. Chêm "thì", "nhé", "à", "vậy". Cảm xúc rõ:
ghen → giọng dỗi, vui → câu nhịp nhanh.
"""
    if genre == "news":
        return """
═══════════════════════════════════════════════════════════════
🎬 GENRE: TIN TỨC / PHỎNG VẤN

Pronoun: trang trọng, ngôi 3.
  • Người dẫn / phóng viên: "tôi" (tự xưng), "quý vị" (gọi khán giả)
  • Người được phỏng vấn: "tôi" (tự xưng), "anh/chị" (gọi phóng viên)

NGÔN NGỮ: chuẩn xác, trung tính, không cảm xúc. Câu hoàn chỉnh, đầy đủ chủ
ngữ. Tránh từ lóng/colloquial.
"""
    # generic / unknown
    return """
═══════════════════════════════════════════════════════════════
🎬 GENRE: KHÔNG XÁC ĐỊNH RÕ

Đọc context của scene để pick register phù hợp. Mặc định:
  • Nam-nữ thân mật: "anh/em"
  • Người ngang tuổi: "tôi/cậu"
  • Trang trọng: "tôi/anh", "tôi/chị"
"""


def get_genre_display_name(genre: str) -> str:
    """Tên hiển thị cho UI (FE setting nâng cao)."""
    return {
        "historical_zh": "Cổ trang Trung Quốc",
        "historical_ko": "Cổ trang Hàn Quốc",
        "historical_jp": "Cổ trang Nhật Bản",
        "modern_drama": "Hiện đại đời thường",
        "action": "Hành động / Quân sự",
        "romcom": "Tình cảm",
        "news": "Tin tức / Phỏng vấn",
        "generic": "Tự động",
    }.get(genre, genre)
