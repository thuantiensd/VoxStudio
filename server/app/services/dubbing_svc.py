"""Video dubbing service — orchestrates STT → edit → TTS → export."""

import asyncio
import concurrent.futures
import json
import logging
import os
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

import ffmpeg
import numpy as np
import soundfile as sf

from app.config import (
    DUBBING_DIR, VOICES_DIR, TTS_DEFAULT_GUIDANCE, TTS_DEFAULT_STEPS, IS_CUDA,
    LLM_GENDER_HINT_PIPELINE_LOW, LLM_GENDER_HINT_PIPELINE_MID, LLM_GENDER_HINT_PIPELINE_HIGH,
    LLM_GENDER_HINT_EVIDENCE_MIN_CHARS, LLM_GENDER_HINT_EVIDENCE_STRONG_CHARS,
)
from app.core.gpu_manager import gpu
from app.core.storage import load_voice
from app.services import whisper_svc, translate_svc, llm_translate_svc, edge_tts_svc, vocal_separator_svc, gemini_translate_svc, diarize_svc, resemblyzer_diarize_svc, default_voices_svc, whisperx_svc
from app.config import USE_WHISPERX
from app.services.tts_svc import trim_silence

logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────

def _has_env_gemini_key() -> bool:
    """Server có sẵn GEMINI_API_KEY trong env hay không. Nếu có → fallback
    chain có thể dùng gemini cho user không cung cấp key (free tier server)."""
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def _detect_tts_engine() -> str:
    """Auto-detect best TTS engine: OmniVoice if installed, else Edge TTS."""
    try:
        import omnivoice
        return "omnivoice"
    except ImportError:
        logger.info("Vox Premium engine not installed, falling back to Edge TTS")
        return "edge"


# Default Vietnamese Edge TTS voices per gender
EDGE_VOICE_MALE_VI = "vi-VN-NamMinhNeural"
EDGE_VOICE_FEMALE_VI = "vi-VN-HoaiMyNeural"

# Default Edge TTS voice nam/nữ per target language. Dùng khi multi-speaker
# mode + slot trống → backend tự pick giọng nam cho speaker nam, nữ cho nữ.
# Key: target_language (lowercase, theo project meta: "vietnamese", "english"...)
# Fallback: dùng vi default khi không có map (rất ít khả năng vì các engine
# dịch chuẩn output 1 trong các target_language phổ biến).
DEFAULT_EDGE_VOICES_BY_LANG: dict[str, dict[str, str]] = {
    "vietnamese": {"male": "vi-VN-NamMinhNeural",   "female": "vi-VN-HoaiMyNeural"},
    "english":    {"male": "en-US-GuyNeural",        "female": "en-US-AriaNeural"},
    "chinese":    {"male": "zh-CN-YunxiNeural",      "female": "zh-CN-XiaoxiaoNeural"},
    "japanese":   {"male": "ja-JP-KeitaNeural",      "female": "ja-JP-NanamiNeural"},
    "korean":     {"male": "ko-KR-InJoonNeural",     "female": "ko-KR-SunHiNeural"},
    "french":     {"male": "fr-FR-HenriNeural",      "female": "fr-FR-DeniseNeural"},
    "spanish":    {"male": "es-ES-AlvaroNeural",     "female": "es-ES-ElviraNeural"},
    "german":     {"male": "de-DE-ConradNeural",     "female": "de-DE-KatjaNeural"},
    "portuguese": {"male": "pt-BR-AntonioNeural",    "female": "pt-BR-FranciscaNeural"},
    "russian":    {"male": "ru-RU-DmitryNeural",     "female": "ru-RU-SvetlanaNeural"},
    "thai":       {"male": "th-TH-NiwatNeural",      "female": "th-TH-PremwadeeNeural"},
    "indonesian": {"male": "id-ID-ArdiNeural",       "female": "id-ID-GadisNeural"},
    "italian":    {"male": "it-IT-DiegoNeural",      "female": "it-IT-ElsaNeural"},
    "arabic":     {"male": "ar-SA-HamedNeural",      "female": "ar-SA-ZariyahNeural"},
    "hindi":      {"male": "hi-IN-MadhurNeural",     "female": "hi-IN-SwaraNeural"},
    "turkish":    {"male": "tr-TR-AhmetNeural",      "female": "tr-TR-EmelNeural"},
    "dutch":      {"male": "nl-NL-MaartenNeural",    "female": "nl-NL-FennaNeural"},
    "polish":     {"male": "pl-PL-MarekNeural",      "female": "pl-PL-AgnieszkaNeural"},
}


# ── Entity scan toàn file (Task 1 pipeline v2) ───────────────────────────
# LLM Pass-0 chỉ đọc 180 lines sample → có thể bỏ sót tên/vocative ở phần
# giữa video. Hàm này quét TOÀN BỘ original_text bằng regex để xây
# "name registry" — danh sách tên người + vocative xuất hiện ≥ N lần.
# Registry inject vào Pass-0 prompt làm authoritative để LLM không drift.

_VOCATIVE_PATTERNS_ZH = (
    # Cha mẹ
    "爸", "妈", "爹", "娘", "爸爸", "妈妈", "爹爹", "母亲", "父亲",
    # Vợ chồng / yêu nhau
    "老公", "老婆", "亲爱的", "宝贝", "媳妇", "相公", "夫君", "娘子",
    # Anh chị em
    "哥", "姐", "弟", "妹", "哥哥", "姐姐",
    # Cấp bậc
    "总", "总裁", "老板", "老总", "经理", "主任", "处长",
    "少爷", "公子", "小姐", "夫人", "先生",
    # Cổ trang
    "陛下", "殿下", "皇上", "娘娘", "贵妃", "王爷", "王妃", "公主", "郡主",
    "大人", "师父", "师傅", "师兄", "师姐", "师妹", "师弟",
)


def _scan_proper_nouns_zh(text: str, min_count: int = 2) -> list[tuple[str, int]]:
    """Scan tên người Trung Quốc 2-3 char xuất hiện ≥ min_count lần.

    Heuristic:
    - Tìm sequence 2-3 chữ Hán liên tiếp KHÔNG bị âm vực thường (a/的/了/...)
    - Phải xuất hiện ≥ 2 lần để loại nhiễu
    - Whitelist Hán-Việt phổ biến trong text để filter common nouns

    Returns: list[(name, count)] sorted by count desc.
    """
    import re as _re_local
    from collections import Counter
    # Sliding-window scan: match 2-char Han sequences với overlap
    # (re.findall không overlap — "陈宇说" sẽ ăn cả "陈宇" → cần manual sliding).
    han_re = _re_local.compile(r"[一-鿿]")
    candidates = []
    chars = [(m.start(), m.group(0)) for m in han_re.finditer(text)]
    # Tìm runs liên tiếp (vị trí Han chars adjacent)
    for i in range(len(chars)):
        # 2-char
        if i + 1 < len(chars) and chars[i+1][0] == chars[i][0] + 1:
            candidates.append(chars[i][1] + chars[i+1][1])
        # 3-char
        if i + 2 < len(chars) and chars[i+1][0] == chars[i][0] + 1 and chars[i+2][0] == chars[i][0] + 2:
            candidates.append(chars[i][1] + chars[i+1][1] + chars[i+2][1])
    common_words = {
        # Quá phổ biến — bỏ qua để không nhầm là tên
        "什么", "怎么", "这个", "那个", "我们", "你们", "他们", "她们",
        "现在", "今天", "明天", "昨天", "之后", "之前", "时候", "事情",
        "知道", "觉得", "看到", "听到", "想到", "希望", "应该", "可以",
        "可能", "不是", "已经", "还有", "因为", "所以", "但是", "如果",
        "不能", "不会", "没有", "一个", "一些", "一直", "一样",
        "出来", "回来", "过来", "进来", "下来", "上来", "起来",
        "说话", "说过", "看见", "回去", "过去", "拿来", "放下",
        "对啊", "好的", "好吧", "真的", "确实", "当然", "只是",
        "马上", "立刻", "刚才", "刚刚", "随便", "其实",
        "不行", "怎样", "为啥", "为何", "如何",
    }
    counts = Counter(c for c in candidates if c not in common_words)
    return [(name, n) for name, n in counts.most_common(50) if n >= min_count]


def _scan_vocative_zh(text: str, min_count: int = 2) -> list[tuple[str, int]]:
    """Scan vocative xưng hô phổ biến."""
    from collections import Counter
    counts = Counter()
    for v in _VOCATIVE_PATTERNS_ZH:
        c = text.count(v)
        if c >= min_count:
            counts[v] = c
    return counts.most_common(20)


def build_entity_registry(project: dict) -> dict:
    """Quét toàn bộ original_text của project → trả registry.

    Returns: {
        "proper_nouns": [(name, count)],   # Tên người 2-3 char (Trung)
        "vocatives": [(word, count)],      # Xưng hô lặp lại
        "source_lang": "...",
    }
    """
    segments = project.get("segments", [])
    if not segments:
        return {"proper_nouns": [], "vocatives": [], "source_lang": ""}
    src = (project.get("source_language") or "").lower()
    src_input = (project.get("source_language_input") or "").lower()
    src_lang = src or src_input or "auto"

    full_text = " ".join((s.get("original_text") or "") for s in segments)

    # Chỉ scan cho Trung — Korean/Japanese cần handler riêng (chưa wire)
    if src_lang in ("zh", "chinese", "auto"):
        return {
            "proper_nouns": _scan_proper_nouns_zh(full_text),
            "vocatives": _scan_vocative_zh(full_text),
            "source_lang": src_lang,
        }
    return {"proper_nouns": [], "vocatives": [], "source_lang": src_lang}


# ── Pinyin → Hán-Việt post-fixer ─────────────────────────────────────────
# LLM (cả flagship) đôi khi vẫn slip pinyin vào output Việt — đặc biệt cho
# tên Trung trong phim Nhật/Hàn. Bảng này map deterministic 100+ pinyin
# phổ biến → Hán-Việt. Apply post-translation, trước TTS.
_PINYIN_TO_HANVIET: dict[str, str] = {
    # Họ phổ biến nhất (60+)
    "Wang": "Vương", "Li": "Lý", "Zhang": "Trương", "Liu": "Lưu",
    "Chen": "Trần", "Yang": "Dương", "Huang": "Hoàng", "Zhao": "Triệu",
    "Wu": "Ngô", "Zhou": "Chu", "Xu": "Từ", "Sun": "Tôn", "Zhu": "Chu",
    "Ma": "Mã", "Hu": "Hồ", "Guo": "Quách", "Lin": "Lâm", "He": "Hà",
    "Gao": "Cao", "Liang": "Lương", "Zheng": "Trịnh", "Luo": "La",
    "Song": "Tống", "Xie": "Tạ", "Tang": "Đường", "Han": "Hàn",
    "Feng": "Phùng", "Deng": "Đặng", "Cao": "Tào", "Peng": "Bành",
    "Zeng": "Tăng", "Xiao": "Tiêu", "Tian": "Điền", "Dong": "Đổng",
    "Yuan": "Viên", "Pan": "Phan", "Cai": "Thái", "Jiang": "Tưởng",
    "Yu": "Dư", "Du": "Đỗ", "Ye": "Diệp", "Cheng": "Trình", "Wei": "Vĩ",
    "Su": "Tô", "Lv": "Lữ", "Ding": "Đinh", "Ren": "Nhâm", "Shen": "Thẩm",
    "Yao": "Diêu", "Lu": "Lư", "Cui": "Thôi", "Zhong": "Chung",
    "Tan": "Đàm", "Wang2": "Uông", "Fan": "Phạm", "Jin": "Kim",
    "Shi": "Thạch", "Dai": "Đới", "Jia": "Giả", "Fang": "Phương",
    "Mou": "Mưu", "Qin": "Tần", "Mu": "Mộ", "Murong": "Mộ Dung",
    "Sima": "Tư Mã", "Ouyang": "Âu Dương", "Zhuge": "Gia Cát",
    # Tên đệm phổ biến / khiêm xưng cổ trang
    "Lao": "Lão", "Xiaolao": "Tiểu Lão",
    "Ah": "A", "A": "A",
    "Da": "Đại", "Er": "Nhị", "San": "Tam", "Si": "Tứ",
    # Tước vị / vocative cổ trang
    "Dage": "Đại ca", "Dajie": "Đại tỷ", "Erge": "Nhị ca",
    "Shifu": "Sư phụ", "Shixiong": "Sư huynh", "Shijie": "Sư tỷ",
    "Shidi": "Sư đệ", "Shimei": "Sư muội",
    "Gongzi": "Công tử", "Xiaojie": "Tiểu thư", "Guniang": "Cô nương",
    "Daren": "Đại nhân", "Xiansheng": "Tiên sinh",
    "Bixia": "Bệ hạ", "Dianxia": "Điện hạ", "Wangye": "Vương gia",
    "Niangniang": "Nương nương", "Furen": "Phu nhân",
    "Niangzi": "Nương tử", "Xianggong": "Tướng công",
    # Pinyin chars phổ biến cho tên (single-syllable). Dùng cho pattern
    # "VN_title + pinyin" hoặc "HánViệt + pinyin" — KHÔNG dùng standalone.
    "Kou": "Khấu", "Wen": "Văn", "Jia": "Gia", "Yi": "Nghị",
    "Long": "Long", "Hua": "Hoa", "Ming": "Minh", "Jun": "Quân",
    "Kai": "Khải", "Jian": "Kiện", "Wei2": "Vĩ", "Hao": "Hạo",
    "Yu2": "Vũ", "Yu3": "Vũ", "Yan": "Yến", "Mei": "Mỹ",
    "Lan": "Lan", "Hong": "Hồng", "Xue": "Tuyết", "Yue": "Nguyệt",
    "Ling": "Linh", "Ying": "Anh", "Fang2": "Phương", "Yan2": "Diễm",
    "Min": "Mẫn", "Jing": "Tĩnh", "Hui": "Huệ", "Juan": "Quyên",
    "Na": "Na", "Ting": "Đình", "Xin": "Tâm", "Mi": "Mi",
    "Qing": "Thanh", "Wu2": "Vũ", "Feng2": "Phong", "Lei": "Lôi",
    "Tao": "Đào", "Bin": "Bân", "Bo": "Ba", "Bing": "Băng",
    "Fei": "Phi", "Dan": "Đan", "Qi": "Kỳ", "Qiu": "Thu",
    "Ru": "Như", "Rui": "Thuỵ", "Sheng": "Thắng", "Yong": "Vĩnh",
    "Zhi": "Chí", "Chao": "Triều", "Le": "Lạc", "Ya": "Nhã",
    # Phân biệt với surname đã có (Yu/Wei/Fang là họ — single in standalone
    # — vẫn dùng table cũ; ở đây "Yu2/Wei2/Fang2" là tên đệm trong tên đầy đủ).
    # Compound name pinyin phổ biến (2 syllables)
    "Wenjia": "Văn Gia", "Yujie": "Vũ Khiết", "Xiaoming": "Tiểu Minh",
    "Xiaoyan": "Tiểu Yến", "Xiaolong": "Tiểu Long", "Xiaohua": "Tiểu Hoa",
    "Meili": "Mỹ Lệ", "Yanhua": "Diễm Hoa", "Yixin": "Nhất Tâm",
    "Junjie": "Tuấn Kiệt", "Jiahao": "Gia Hạo", "Tianyu": "Thiên Vũ",
    "Xinyu": "Hâm Vũ", "Wenhao": "Văn Hạo",
    "Mingyue": "Minh Nguyệt", "Mingxin": "Minh Tâm", "Xueying": "Tuyết Anh",
    "Tianlong": "Thiên Long", "Yulin": "Vũ Lâm", "Chunyang": "Xuân Dương",
    "Yunfei": "Vân Phi", "Jingyi": "Tinh Y", "Xiyan": "Hi Yến",
    "Liangchen": "Lương Thần", "Hanxue": "Hàn Tuyết", "Yiran": "Y Nhiên",
    "Ziyan": "Tử Yến", "Aoxue": "Ngạo Tuyết",
}


def _hanviet_post_fix(text: str) -> str:
    """Replace common pinyin tokens with Hán-Việt equivalents.

    SAFE MODE — chỉ replace khi có context rõ ràng là tên Trung:
      1. Bigram "Capital Capital" (2 từ HOA cạnh nhau) — vd "Chen Yu",
         "Lao Wang", "Xiao Ming". Replace cả 2.
      2. Prefix khiêm xưng cổ trang đặc biệt: "Lao X" → "Lão X",
         "Xiao X" → "Tiểu X" (X bắt đầu HOA).
      3. Compound họ đặc biệt: "Murong", "Sima", "Ouyang", "Zhuge".
      4. Vocative đứng đơn KHÔNG match (Wang/Li/Cao... có thể là từ
         tiếng Việt vô tình trùng pinyin) — tránh false positive.

    Cao/Tan/Da/Ma trong câu Việt KHÔNG bị replace nữa.
    """
    if not text:
        return text
    import re

    # Compound họ + compound names — replace nguyên cụm.
    # Pinyin ≥6 chars chắc chắn KHÔNG phải từ Việt (Vietnamese ko có chuỗi
    # 6+ chữ thường ASCII liền nhau không dấu) → an toàn replace.
    long_compounds = {
        k: v for k, v in _PINYIN_TO_HANVIET.items()
        if len(k) >= 6 and k.isalpha()
    }
    for compound, vn in long_compounds.items():
        if compound in text:
            text = text.replace(compound, vn)
    # Họ compound ngắn (5 chars) — vẫn an toàn (Murong/Sima/Zhuge…)
    for compound in ("Murong", "Sima", "Ouyang", "Zhuge", "Shangguan"):
        if compound in text:
            text = text.replace(compound, _PINYIN_TO_HANVIET.get(compound, compound))

    # Bigram pinyin: 2 từ HOA cạnh nhau (cách bằng space)
    def _bigram_repl(m: "re.Match") -> str:
        w1, w2 = m.group(1), m.group(2)
        f1 = _PINYIN_TO_HANVIET.get(w1, w1)
        f2 = _PINYIN_TO_HANVIET.get(w2, w2)
        # Chỉ áp dụng nếu ÍT NHẤT 1 trong 2 token có trong bảng
        if f1 == w1 and f2 == w2:
            return m.group(0)  # cả 2 đều không phải pinyin → giữ nguyên
        return f"{f1} {f2}"

    text = re.sub(
        r"\b([A-Z][a-z]{1,7})\s+([A-Z][a-z]{1,7})\b",
        _bigram_repl, text,
    )

    # Prefix patterns: "Lao/Xiao/Da/Er + [A-Z]xxx" → Lão/Tiểu/Đại/Nhị + replaced
    def _prefix_repl(m: "re.Match") -> str:
        prefix, name = m.group(1), m.group(2)
        vn_prefix = _PINYIN_TO_HANVIET.get(prefix, prefix)
        vn_name = _PINYIN_TO_HANVIET.get(name, name)
        return f"{vn_prefix} {vn_name}"

    text = re.sub(
        r"\b(Lao|Xiao|Da|Er|San|Si|Ah)\s+([A-Z][a-z]{1,7})\b",
        _prefix_repl, text,
    )

    # Pattern: VN title (Vietnamese) + pinyin surname → fix surname
    # Vd: "Trưởng nhóm Song" → "Trưởng nhóm Tống"
    #     "Đại nhân Wang" → "Đại nhân Vương"
    _VN_TITLES_PRECEDING_NAME = (
        "Trưởng nhóm", "Tổ trưởng", "Bộ trưởng", "Trưởng",
        "Đại nhân", "Tiểu thư", "Công tử", "Phu nhân",
        "Bệ hạ", "Điện hạ", "Vương gia", "Nương nương",
        "Sư phụ", "Sư huynh", "Sư tỷ", "Sư đệ", "Sư muội",
        "Tiên sinh", "Tướng quân", "Lão gia",
        "Anh", "Chị", "Cô", "Ông", "Bà",
        "Đồng chí", "Ngài", "Phu quân", "Nương tử",
    )

    def _title_pinyin_repl(m: "re.Match") -> str:
        title, pinyin = m.group(1), m.group(2)
        vn = _PINYIN_TO_HANVIET.get(pinyin)
        if not vn:
            return m.group(0)
        return f"{title} {vn}"

    titles_pat = "|".join(re.escape(t) for t in _VN_TITLES_PRECEDING_NAME)
    text = re.sub(
        rf"\b({titles_pat})\s+([A-Z][a-z]{{1,7}})\b",
        _title_pinyin_repl, text,
    )

    # Pattern: HánViệt (có dấu Việt) + pinyin → fix pinyin
    # Vd: "Trần Kou" → "Trần Khấu", "Vương Wenjia" → "Vương Văn Gia"
    # Detect HánViệt qua presence of Việt diacritics OR known Hán-Việt name.
    _VIET_DIACRITICS = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ"
    _VIET_DIACRITICS_RE = "[" + re.escape(_VIET_DIACRITICS) + "]"

    def _hanviet_pinyin_repl(m: "re.Match") -> str:
        hanviet, pinyin = m.group(1), m.group(2)
        vn = _PINYIN_TO_HANVIET.get(pinyin)
        if not vn:
            return m.group(0)
        return f"{hanviet} {vn}"

    # Word có dấu Việt + space + word ASCII chữ HOA → có thể là compound name
    text = re.sub(
        rf"\b([A-Z][a-zA-Z]*{_VIET_DIACRITICS_RE}[a-zA-Z]*)\s+([A-Z][a-z]{{1,7}})\b",
        _hanviet_pinyin_repl, text,
    )

    # TONE-MARKED PINYIN — vd "Nǐ suǒ chén" lọt qua LLM với dấu thanh.
    # CHỈ dùng các ký tự ĐẶC TRƯNG PINYIN (caron, macron) — KHÔNG dùng các
    # dấu chung với tiếng Việt (à/á/è/é/ì/í/ò/ó/ù/ú có ở cả 2 → false positive).
    # Pinyin-only: ā ē ī ō ū ǎ ě ǐ ǒ ǔ ǖ ǘ ǚ ǜ + capital variants.
    _PINYIN_TONE_CHARS = "āēīōūǎěǐǒǔǖǘǚǜĀĒĪŌŪǍĚǏǑǓǕǗǙǛ"

    def _strip_tone(s: str) -> str:
        """Xoá dấu thanh pinyin: nǐ → ni, chén → chen."""
        tone_map = {
            "ā": "a", "á": "a", "ǎ": "a", "à": "a",
            "ē": "e", "é": "e", "ě": "e", "è": "e",
            "ī": "i", "í": "i", "ǐ": "i", "ì": "i",
            "ō": "o", "ó": "o", "ǒ": "o", "ò": "o",
            "ū": "u", "ú": "u", "ǔ": "u", "ù": "u",
            "ǖ": "v", "ǘ": "v", "ǚ": "v", "ǜ": "v",
            "Ā": "A", "Á": "A", "Ǎ": "A", "À": "A",
            "Ē": "E", "É": "E", "Ě": "E", "È": "E",
            "Ī": "I", "Í": "I", "Ǐ": "I", "Ì": "I",
            "Ō": "O", "Ó": "O", "Ǒ": "O", "Ò": "O",
            "Ū": "U", "Ú": "U", "Ǔ": "U", "Ù": "U",
        }
        return "".join(tone_map.get(c, c) for c in s)

    def _tone_pinyin_repl(m: "re.Match") -> str:
        raw = m.group(0)
        stripped = _strip_tone(raw)
        # Title case từng word → tra _PINYIN_TO_HANVIET
        parts = stripped.split()
        out_parts = []
        any_match = False
        for p in parts:
            tc = p.capitalize()
            vn = _PINYIN_TO_HANVIET.get(tc)
            if vn:
                out_parts.append(vn)
                any_match = True
            else:
                out_parts.append(tc)
        if any_match:
            return " ".join(out_parts)
        # Không match được trong bảng → ít nhất loại tone để LLM khác đỡ lú
        return stripped

    # Match cụm gồm ≥1 từ có chứa dấu thanh pinyin (chuỗi liên tiếp)
    text = re.sub(
        rf"(?:[A-Za-z]*[{re.escape(_PINYIN_TONE_CHARS)}][A-Za-z]*)"
        rf"(?:\s+[A-Za-z]*[{re.escape(_PINYIN_TONE_CHARS)}A-Za-z]*)*",
        _tone_pinyin_repl, text,
    )

    return text


# Phrase Trung → Việt LLM hay dịch sai. Patterns ở đây sửa pattern-level
# (regex) chứ không từ đơn — tránh false positive.
_PHRASE_FIXES: list[tuple[str, str, str]] = [
    # (pattern_regex, replacement, description)
    # "Dừng lại nhiều hơn" → "Dừng tay!" (LLM dịch 住手/别再打了 sai)
    (r"\bDừng lại nhiều hơn\b\.?", "Dừng tay!", "停手/住手"),
    (r"\bĐừng làm nhiều hơn\b\.?", "Đừng làm nữa!", "别再做了"),
    (r"\bĐừng đánh nhiều hơn\b\.?", "Đừng đánh nữa!", "别再打了"),
    (r"\bĐừng nói nhiều hơn\b\.?", "Đừng nói nữa!", "别再说了"),
    (r"\bĐừng khóc nhiều hơn\b\.?", "Đừng khóc nữa!", "别再哭了"),
    # 老天爷 thường sai thành "Tổ sư Mặt trời" / "Trời cha"
    (r"\bTổ sư Mặt trời\b", "Trời ơi", "老天爷"),
    (r"\bTổ tiên trời đất\b", "Trời ơi", "老天爷"),
    # 班长 = lớp/tổ trưởng, không phải "Ca trưởng" (đó là ca khúc trưởng)
    (r"\bCa trưởng\b", "Tổ trưởng", "班长 (lớp/tổ trưởng)"),
    # "theo nghĩa đen" thường là LLM dịch 真的/真是 sai
    (r"\bTheo nghĩa đen, ", "", "真的 → theo nghĩa đen (bỏ filler)"),
    (r"\btheo nghĩa đen ", "", "真的 inline"),
    # Misc phổ biến
    (r"\bĐồng chí ", "", "同志 trong cổ trang/drama không phải đồng chí CM"),
    # HONORIFIC TITLES sau surname Hán-Việt: capitalize để TTS đọc liền mạch
    # "Tô lão gia" → "Tô Lão Gia" (TTS không pause giữa Tô và lão)
    # Pattern: <Capitalized 1-2 word Hán-Việt name> + lowercase title
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) lão gia\b",
     r"\1 Lão Gia", "Surname + lão gia → liền mạch"),
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) đại nhân\b",
     r"\1 Đại Nhân", "Surname + đại nhân → liền mạch"),
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) tiểu thư\b",
     r"\1 Tiểu Thư", "Surname + tiểu thư → liền mạch"),
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) công tử\b",
     r"\1 Công Tử", "Surname + công tử → liền mạch"),
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) phu nhân\b",
     r"\1 Phu Nhân", "Surname + phu nhân → liền mạch"),
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) tổng\b",
     r"\1 Tổng", "Surname + tổng → liền mạch (Trình tổng → Trình Tổng)"),
    (r"\b((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang)) sư phụ\b",
     r"\1 Sư Phụ", "Surname + sư phụ → liền mạch"),
    # SURNAME DISAMBIGUATION — 林 = "Lâm" KHÔNG phải "Linh" (灵 mới là Linh)
    (r"\b(?:Tập đoàn|tập đoàn|Công ty|công ty) Linh thị\b", "Tập đoàn Lâm thị", "林氏集团 → Lâm KHÔNG Linh"),
    (r"\bLinh thị (?:tập đoàn|company)\b", "Lâm thị tập đoàn", "林氏 → Lâm"),
    (r"\bLinh gia\b", "Lâm gia", "林家 → Lâm gia"),
    (r"\bnhà họ Linh\b", "nhà họ Lâm", "林家 → Lâm"),
    # 好了 trong context đuổi khéo / kết thúc → "Thôi/Được rồi", KHÔNG "Cái gì?"
    (r"^Cái gì\?\s*$", "Thôi được rồi.", "好了 đứng riêng KHÔNG phải 'Cái gì?'"),
    # 请吧 = "mời ra/đi" gesture lịch sự, KHÔNG "xin hỏi" (đó là 请问).
    # Chỉ match khi đứng riêng sau xưng hô: "Cô Lâm, xin hỏi" thay vì
    # match mọi "xin hỏi" trong câu phức.
    (
        r"^(Cô|Anh|Cậu|Ngài|Thầy|Cô nương|Đại nhân|Công tử|Tiểu thư|Phu nhân|Em|Chú|Bác|Ông|Bà)\s+([\wÀ-ỹ]+),\s+xin hỏi\.?$",
        lambda m: f"{m.group(1)} {m.group(2)}, mời.",
        "Title + Name + xin hỏi → mời (请吧 chứ không 请问)",
    ),
    # SURNAME ORDER FIX — LLM hay dịch 秦总 thành "Tổng Tần" (đảo)
    # Đúng phải là "Tần Tổng" (surname + title, giống Trình Tổng / Tô Tổng).
    (r"\bTổng\s+((?:Tô|Trần|Lý|Vương|Lâm|Hồ|Lưu|Mã|Quách|Trương|Đinh|Hoàng|Tống|Điền|Đỗ|Phùng|Đặng|Tưởng|Châu|Tiền|Tôn|Hứa|Tạ|Cao|Lương|Diệp|Phương|Tăng|Bành|La|Mạnh|Khúc|Cố|Tiêu|Trình|Đường|Tần|Chu|Thẩm|Cốc|Cát|Hoa|Nguỵ|Bao|Bùi|Doãn|Dư|Đoàn|Hà|Lục|Mẫn|Nghê|Nhâm|Phan|Phó|Tào|Thái|Thi|Triệu|Văn|Bạch|Khang))\b",
     r"\1 Tổng", "秦总 → Tần Tổng (KHÔNG đảo Tổng Tần)"),

    # 信号格 = cột sóng / vạch sóng (4G/wifi), KHÔNG phải "vạch tín hiệu"
    (r"\bmấy vạch tín hiệu\b", "mấy vạch sóng", "信号格 → vạch sóng"),
    (r"\b(\d+) vạch tín hiệu\b", r"\1 vạch sóng", "信号格"),
    (r"\bvạch tín hiệu\b", "vạch sóng", "信号格"),
    (r"\bcột tín hiệu\b", "cột sóng", "信号塔 ambiguous"),

    # 差等生 = học dốt / kém, KHÔNG phải "buôn lậu" (LLM nhầm 差 = chênh lệch?)
    (r"\bđồ buôn lậu\b", "đồ học dốt", "差等生 (học sinh kém)"),
    (r"\b(?:tên|kẻ|thằng) buôn lậu (?:hồi học|ở (?:tiểu học|trường))\b", "đứa học dốt ở trường", "差等生 context tiểu học"),

    # CỔ TRANG IDIOM — Hán-Việt dịch literal nghe ngơ. Thay bằng phrasing tự nhiên.
    (r"\bmột mối búp bê\b", "đính ước trẻ con", "娃娃亲 — không phải 'búp bê'"),
    (r"\bmối búp bê\b", "đính ước trẻ con", "娃娃亲 đứng riêng"),
    (r"\bsong túc song phi\b", "trọn đời bên nhau", "双宿双飞"),
    (r"\btĩnh tĩnh mà cười\b", "yên ổn cùng nhau", "静静相处 — không phải cười"),
    (r"\btĩnh tĩnh tương xứ\b", "yên ổn cùng nhau", "静静相处 Hán-Việt thuần"),
    # 应该的 đứng riêng = "phải vậy / tất nhiên" KHÔNG phải "nên mà"
    (r"^Nên mà, nên mà\.?$", "Phải vậy, phải vậy.", "应该的应该的"),
    (r"^Nên mà\.?$", "Phải vậy.", "应该的"),
    # Whisper transcribe nhầm khiến câu mở đầu vô nghĩa
    (r"^Có án nhân tạo\.?$", "", "Whisper noise — bỏ"),

    # PLATFORM WATERMARK — outro/credits jingle bị Whisper bắt nhầm thành dialogue.
    # Bỏ hoàn toàn (trả "" để TTS skip, không ghi vào sub/dub).
    (r"^YoYo Television Series.*$", "", "YoYo TV outro jingle"),
    (r"^WeTV.*Exclusive.*$", "", "WeTV outro"),
    (r"^iQiyi.*$", "", "iQiyi outro"),
    (r"^Tencent (?:Video|Pictures).*$", "", "Tencent outro"),
    (r"^Mango TV.*$|^MGTV.*$", "", "Mango TV outro"),
    (r"^Youku.*$", "", "Youku outro"),
    (r"^Bilibili.*$", "", "Bilibili outro"),
    (r"^Netflix.*Original.*$", "", "Netflix outro"),
    (r"^.*All Rights? Reserved.*$", "", "Copyright text"),
    (r"^.*Television Series Exclusive.*$", "", "Generic TV exclusive watermark"),
    (r"^.*独播剧场.*$", "", "优优独播剧场 — kênh Trung độc quyền"),
    (r"\b优优独播剧场\b", "", "优优独播剧场 inline"),

    # UNTRANSLATED CHINESE LEAKED — LLM bỏ sót, output còn Hán tự.
    # Trong dub VN, output PHẢI là Việt thuần (Hán-Việt cho tên).
    # Nếu còn ≥ 2 ký tự Trung CJK liền → dòng đó LLM không dịch → drop.
    # 1 chữ Trung lẻ có thể là tên (vd 妈) — KHÔNG match; 2+ chữ là chắc câu untranslated.
    (r"[一-鿿]{2,}", "", "Hán tự ≥2 chars liền — LLM bỏ sót dịch"),
]


def _enforce_kinship_pronoun(text: str) -> str:
    """Fix mẹ-con/bố-con xưng hô khi LLM dịch nhầm "em" thay vì "con".

    Pattern bị nhắm: segment bắt đầu bằng vocative cha mẹ ("Mẹ,", "Bố ơi,",
    "Cha…") → speaker là CON → mọi "em" làm chủ ngữ trong segment phải là "con".

    Conservative: chỉ swap khi:
      • Line bắt đầu bằng vocative cha/mẹ rõ ràng (đầu segment hoặc sau dấu .!?)
      • "em" là standalone (không "em ơi"/"em trai"/"em gái"/"em này"/…)
      • "em" đứng trước verb cue (sẽ/đã/không/đang/…)

    KHÔNG đụng nếu vocative ambiguous (vd "Anh ơi" có thể là gọi anh trai/người yêu).
    """
    import re as _re
    if not text:
        return text
    parent_voc_re = _re.compile(
        r"(?:^|[\.!?…]\s+)(?:Mẹ|Má|Bố|Ba|Cha|Mom|Mommy|Papa|Daddy)(?:\s+ơi)?\s*[,!\.…]",
        _re.IGNORECASE,
    )
    if not parent_voc_re.search(text):
        return text
    verb_cues = (
        r"sẽ|đã|đang|không|cũng|chỉ|còn|chưa|phải|cần|muốn|biết|hiểu|"
        r"nghĩ|đi|về|làm|nói|hỏi|nhờ|định|tin|thấy|nghe|mong|mới|vừa|"
        r"có|nên|đáng|từng|sao|gì"
    )
    # "em" làm subject → "con". Negative lookahead chặn "em ơi"/"em trai"/...
    # Group capture chữ đầu để preserve capitalization ("Em" → "Con").
    pat = _re.compile(
        rf"\b([Ee])m\b(?!\s+(?:ơi|trai|gái|út|nhỏ|của|hai|này|đây|mình|nó|ấy|ạ))\s+(?={verb_cues}\b)"
    )
    def _swap(m: "_re.Match") -> str:
        first = m.group(1)
        return ("C" if first == "E" else "c") + "on "
    return pat.sub(_swap, text)


def _phrase_post_fix(text: str) -> str:
    """Sửa các phrase mistranslation LLM hay mắc (Trung → Việt drama)."""
    if not text:
        return text
    import re
    out = text
    for pat, repl, _desc in _PHRASE_FIXES:
        out = re.sub(pat, repl, out)
    # Kinship pronoun guard — chạy SAU regex post-fix để vocative đã chuẩn hoá.
    out = _enforce_kinship_pronoun(out)

    # Fix all-uppercase Vietnamese word (LLM hay viết "KHÔNG."/"VÂNG.") →
    # Title case ("Không."/"Vâng."). Chỉ apply cho từ Việt có dấu hoặc
    # 3-7 char không có chữ pinyin (tránh đụng acronym AI/USA/CEO).
    def _fix_caps(m: "re.Match") -> str:
        w = m.group(0)
        # Bỏ qua acronym 2-5 char không dấu (đã handle ở TTS preprocess)
        if len(w) <= 5 and re.match(r"^[A-Z]+$", w):
            return w
        return w[0] + w[1:].lower()

    out = re.sub(
        r"\b[A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]{2,}\b",
        _fix_caps, out,
    )
    return out


def _apply_translation_post_fixes(project: dict) -> None:
    """Apply pinyin + phrase post-fixes lên TẤT CẢ segments của project.

    Idempotent — gọi nhiều lần không gây hại (regex match cùng pattern).
    Phải gọi sau MỌI path translate (Gemini env / Qwen / BYOK / Google Free)
    để sub + dub đều dùng text đã clean.
    """
    n_pin = 0
    n_phrase = 0
    for seg in project.get("segments", []):
        t = (seg.get("translated_text") or "").strip()
        if not t:
            continue
        fixed = _hanviet_post_fix(t)
        if fixed != t:
            n_pin += 1
        after_phrase = _phrase_post_fix(fixed)
        if after_phrase != fixed:
            n_phrase += 1
        seg["translated_text"] = after_phrase
        if seg.get("speech_text"):
            seg["speech_text"] = _phrase_post_fix(_hanviet_post_fix(seg["speech_text"]))
        else:
            seg["speech_text"] = after_phrase
    if n_pin:
        logger.info("Post-fix pinyin → Hán-Việt: %d segments", n_pin)
    if n_phrase:
        logger.info("Post-fix phrase Trung→Việt drama: %d segments", n_phrase)

    # Name unify: catch drift do Whisper transcribe inconsistent
    # (vd "Tô Thiên Long / Tô Điền Long / Tô Đình Long" = 1 nhân vật)
    n_unified = _unify_name_drift(project.get("segments", []))
    if n_unified:
        logger.info("Post-fix name unify: %d segments fixed", n_unified)


# Hán-Việt surname + title prefixes — pattern detect "Prefix + Name" trong text
_NAME_PREFIXES = (
    # Họ Hán-Việt phổ biến
    "Tô", "Trần", "Vương", "Lâm", "Lý", "Hồ", "Lưu", "Mã", "Quách",
    "Trương", "Đinh", "Hoàng", "Tống", "Điền", "Đỗ", "Phùng", "Đặng",
    "Tưởng", "Châu", "Tiền", "Tôn", "Hứa", "Tạ", "Cao", "Lương", "Tống",
    "Diệp", "Phương", "Tăng", "Bành", "La", "Mạnh", "Khúc", "Cố", "Tiêu",
    # Title cổ trang / drama
    "Tiểu", "Đại", "Lão",
    # Compound surnames hai chữ
    "Âu Dương", "Tư Mã", "Thượng Quan", "Mộ Dung", "Gia Cát",
)


def _unify_name_drift(segments: list[dict]) -> int:
    """Whisper transcribe tên Trung không nhất quán giữa segments
    (vd 苏天龙/苏田龙/苏庭龙 → "Tô Thiên Long / Điền Long / Đình Long").
    LLM dịch literal mỗi lần → cùng nhân vật có 3-8 spelling khác nhau.

    Logic:
      1. Scan tất cả segments cho pattern "<Prefix> <Name>"
      2. Group theo prefix (vd: tất cả "Tô X")
      3. Trong cluster thời gian ≤ 60s, nếu có ≥2 variants:
         pick variant phổ biến nhất → unify cả cluster về spelling đó
      4. Cluster cách xa thời gian (> 60s) → có thể là nhân vật khác,
         giữ riêng để tránh false-positive

    Returns: số segments đã sửa.
    """
    if not segments:
        return 0
    import re
    from collections import Counter

    # Pattern: "<Prefix> <Capitalized_Name>" (single word, có thể có dấu Việt)
    # Compound prefixes (Âu Dương) cần escape space trong alternation
    # Explicit char sets — [À-Ỵ] range gồm cả lowercase Việt → false positive.
    _U = "A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ"
    _L = "a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
    prefix_alt = "|".join(re.escape(p) for p in _NAME_PREFIXES)
    name_pat = re.compile(
        rf"\b({prefix_alt})\s+([{_U}][{_L}]+(?:\s+[{_U}][{_L}]+){{0,2}})\b"
    )

    # Per prefix: list of (seg_idx, sub_name, full_name, time_start)
    by_prefix: dict[str, list[tuple]] = {}
    for i, seg in enumerate(segments):
        text = seg.get("translated_text", "") or ""
        for m in name_pat.finditer(text):
            prefix, sub = m.group(1), m.group(2)
            full = f"{prefix} {sub}"
            t = float(seg.get("start", 0) or 0)
            by_prefix.setdefault(prefix, []).append((i, sub, full, t))

    n_fixed = 0
    for prefix, occurrences in by_prefix.items():
        if len(occurrences) < 2:
            continue
        # Sort theo thời gian
        sorted_occ = sorted(occurrences, key=lambda x: x[3])
        # Cluster: gap > 60s = cluster mới (có thể nhân vật khác cùng họ)
        clusters: list[list[tuple]] = []
        cur = [sorted_occ[0]]
        for occ in sorted_occ[1:]:
            if occ[3] - cur[-1][3] <= 60:
                cur.append(occ)
            else:
                clusters.append(cur)
                cur = [occ]
        clusters.append(cur)

        for cluster in clusters:
            sub_names = [o[1] for o in cluster]
            unique = set(sub_names)
            if len(unique) < 2:
                continue
            # Pick variant phổ biến nhất; tie → giữ tên đầu tiên xuất hiện
            counter = Counter(sub_names)
            canonical_sub = counter.most_common(1)[0][0]
            canonical_full = f"{prefix} {canonical_sub}"

            for seg_idx, sub, full, _t in cluster:
                if sub == canonical_sub:
                    continue
                old_full = f"{prefix} {sub}"
                seg_text = segments[seg_idx].get("translated_text", "") or ""
                if old_full in seg_text:
                    segments[seg_idx]["translated_text"] = seg_text.replace(
                        old_full, canonical_full,
                    )
                    n_fixed += 1
                    logger.info(
                        "Name unify: '%s' → '%s' at seg %d",
                        old_full, canonical_full, seg_idx,
                    )
                # Cũng sửa speech_text nếu có
                sp = segments[seg_idx].get("speech_text") or ""
                if old_full in sp:
                    segments[seg_idx]["speech_text"] = sp.replace(
                        old_full, canonical_full,
                    )
    return n_fixed


def _default_edge_voice(target_lang: str | None, gender: str | None) -> str | None:
    """Trả Edge voice default cho ngôn ngữ + giới tính. None nếu không match."""
    if not gender or not target_lang:
        return None
    lang = target_lang.lower().strip()
    pair = DEFAULT_EDGE_VOICES_BY_LANG.get(lang)
    if not pair:
        return None
    return pair.get(gender.lower())


# Speech rate ước lượng (chars/sec) cho mỗi ngôn ngữ — dùng để quyết định
# segment có "sparse" (text quá ngắn so với slot duration) không. Tốc độ
# nói trung bình mỗi ngôn ngữ khác nhau:
#   - VI/EN: ~14-17 chars/sec (alphabet, mỗi từ nhiều ký tự)
#   - ZH:    ~5-6 chars/sec (mỗi character = 1 syllable, slow)
#   - JA:    ~7-8 chars/sec (mix kanji/kana)
SPEECH_CHARS_PER_SEC: dict[str, float] = {
    "vietnamese": 14.0,
    "english":    15.0,
    "chinese":    6.0,
    "japanese":   8.0,
    "korean":     8.0,
    "thai":       9.0,
    "french":     14.0,
    "spanish":    16.0,
    "german":     13.0,
    "portuguese": 15.0,
    "russian":    13.0,
    "italian":    15.0,
    "arabic":     12.0,
    "hindi":      12.0,
    "indonesian": 14.0,
    "turkish":    13.0,
    "dutch":      13.0,
    "polish":     13.0,
}

def _speech_rate_for(target_lang: str | None) -> float:
    """Chars/sec ước lượng cho ngôn ngữ đích — fallback 14 cho ngôn ngữ
    chưa map (default conservative for alphabet languages)."""
    if not target_lang:
        return 14.0
    return SPEECH_CHARS_PER_SEC.get(target_lang.lower().strip(), 14.0)


def _resolve_voice_by_character_id(
    character_id: str | None,
    project: dict,
) -> tuple[str | None, str | None]:
    """Phase 12 wrapper — delegate sang voice_routing_svc cho testability.
    Real logic ở `voice_routing_svc.resolve_voice_by_character_id`.
    """
    from app.services.voice_routing_svc import resolve_voice_by_character_id
    return resolve_voice_by_character_id(character_id, project)


def _log_voice_fallback(
    project: dict,
    seg: dict,
    character_id: str | None,
    voice_id: str | None,
    reason: str,
) -> None:
    """Phase 12 wrapper — delegate sang voice_routing_svc."""
    from app.services.voice_routing_svc import log_voice_fallback
    log_voice_fallback(project, seg, character_id, voice_id, reason)


def _pick_omni_voice_id_for_segment(seg: dict, project: dict) -> str | None:
    """Phase 12 STRICT — voice_id chỉ từ character_id.

    Priority:
      1. seg.voice_id (per-segment user explicit override — OK per spec rule 1)
      2. _resolve_voice_by_character_id (STRICT character_id → registry)

    TUYỆT ĐỐI KHÔNG dùng:
      - seg["speaker"] (raw SPEAKER_XX / FACE_XX) làm voice_map key
      - seg["speaker_gender"] để pick voice
      - cycle qua voice_slots theo raw_speaker order
      - project["voice_id"] làm fallback khi voice_count > 1 (multi-voice)
    """
    # 1. Per-segment override (user explicit choice qua UI per-segment voice picker)
    seg_voice = seg.get("voice_id")
    if seg_voice:
        return seg_voice

    # 2. STRICT character_id resolution
    character_id = seg.get("character_id")
    voice_id, fallback_reason = _resolve_voice_by_character_id(character_id, project)
    if voice_id and fallback_reason:
        _log_voice_fallback(project, seg, character_id, voice_id, fallback_reason)
    # Last-resort safety net (Phase 12 spec rule 2 — log warning).
    # Trigger CHỈ khi resolver Tier 1-5 đều trả None (project meta hỏng:
    # voice_slots=[], voice_id=None, registry empty). Avoid silent TTS fail.
    if not voice_id and int(project.get("voice_count") or 1) > 1:
        speaker_id = character_id or seg.get("speaker") or seg.get("id")
        gender = seg.get("speaker_gender")
        if not gender and seg.get("speaker"):
            gender = (project.get("speaker_genders") or {}).get(seg.get("speaker"))
        default_path = default_voices_svc.get_default_voice_path_for_speaker(
            speaker_id, gender,
        )
        if default_path:
            _log_voice_fallback(
                project, seg, character_id, default_path.stem,
                "last_resort_default_voice_pool",
            )
            return default_path.stem
    return voice_id


def _build_speaker_voice_assignments(project: dict, voice_slots: list, voice_count: int) -> dict:
    """Map speaker_id → voice_id (slot value) theo gender match.

    Slot convention (frontend):
      - Slot 0: male voices
      - Slot 1: female voices
      - Slot 2-4: any voices

    Algorithm:
      Loop speaker_genders, ưu tiên slot có gender khớp. Nếu hết slot khớp
      gender → dùng slot "any" còn lại. Slot rỗng "" giữ nguyên (fallback default).
    """
    speaker_genders = project.get("speaker_genders") or {}
    if not speaker_genders:
        return {}

    # Slot index → gender hint
    slot_genders = []
    for i in range(voice_count):
        if i == 0:
            slot_genders.append("male")
        elif i == 1:
            slot_genders.append("female")
        else:
            slot_genders.append("any")

    # Track slot đã assign để không gán cùng slot nhiều speaker
    used_slots = set()
    assignments = {}

    # Pass 1: gender match exact
    for speaker, gender in speaker_genders.items():
        for i in range(voice_count):
            if i in used_slots:
                continue
            if slot_genders[i] == gender:
                assignments[speaker] = voice_slots[i] if i < len(voice_slots) else ""
                used_slots.add(i)
                break

    # Pass 2: speaker chưa được assign → dùng slot "any" còn trống
    for speaker in speaker_genders:
        if speaker in assignments:
            continue
        for i in range(voice_count):
            if i in used_slots:
                continue
            if slot_genders[i] == "any":
                assignments[speaker] = voice_slots[i] if i < len(voice_slots) else ""
                used_slots.add(i)
                break
        else:
            # Hết slot → dùng slot 0 cycling (degraded but predictable)
            assignments[speaker] = voice_slots[0] if voice_slots else ""

    logger.info("Voice assignments: %s (slots=%s)", assignments, voice_slots)
    return assignments


def _pick_edge_voice_for_segment(seg: dict, project: dict) -> str | None:
    """Phase 12 STRICT — Edge voice chỉ từ character_id.

    Priority:
      1. seg.voice_id (per-segment user override)
      2. project["edge_voice"] (single-voice mode legacy field)
      3. _resolve_voice_by_character_id (STRICT character_id → registry)
      4. Lang-based default (only when voice_count <= 1)

    TUYỆT ĐỐI KHÔNG dùng:
      - seg["speaker"] làm voice_map key
      - seg["speaker_gender"] để pick voice
      - cycle qua voice_slots theo raw_speaker order
    """
    voice_count = int(project.get("voice_count") or 1)
    voice_slots = project.get("voice_slots") or []
    target_lang = project.get("target_language")

    # 1. Per-segment override
    seg_voice = seg.get("voice_id")
    if seg_voice:
        return seg_voice

    # 2. Single-voice legacy override (edge_voice field)
    if voice_count <= 1 and project.get("edge_voice"):
        return project["edge_voice"]

    # 3. STRICT character_id resolution (works for both single & multi voice)
    character_id = seg.get("character_id")
    voice_id, fallback_reason = _resolve_voice_by_character_id(character_id, project)
    if voice_id:
        if fallback_reason:
            _log_voice_fallback(project, seg, character_id, voice_id, fallback_reason)
        return voice_id

    # 4. Last-resort safety net (Phase 12 spec rule 2 — log warning).
    # Trigger CHỈ khi resolver Tier 1-5 fail. Multi-voice dùng gender segment
    # để tự đổi nam/nữ khi user chưa set slot.
    if voice_count > 1 and target_lang:
        gender = seg.get("speaker_gender")
        if not gender and seg.get("speaker"):
            gender = (project.get("speaker_genders") or {}).get(seg.get("speaker"))
        gender_voice = _default_edge_voice(target_lang, gender)
        if gender_voice:
            _log_voice_fallback(
                project, seg, seg.get("character_id"), gender_voice,
                "last_resort_lang_default_with_gender_hint",
            )
            return gender_voice

    # 5. Single-voice lang default
    if voice_count <= 1 and target_lang:
        lang = target_lang.lower().strip()
        pair = DEFAULT_EDGE_VOICES_BY_LANG.get(lang)
        if pair:
            return pair.get("male") or pair.get("female")

    return None


# Legacy `_get_default_voice` (hardcode BLV_Bóng_Đá) đã xoá khi rebrand sang
# 12 preset Vox Premium. Worker giờ pick voice qua default_voices_svc
# theo gender + speaker_id. Pool source: voxstudio-engine/voices/<slug>.pt.


def _extract_segment_audio(source_path: str, out_path: str, start: float, end: float):
    """Extract a time slice from an audio file using soundfile."""
    audio_np, sr = sf.read(source_path)
    start_sample = int(start * sr)
    end_sample = int(end * sr)
    segment = audio_np[start_sample:end_sample]
    if len(segment) < sr * 0.3:  # skip if < 0.3s
        raise ValueError(f"Segment too short: {end - start:.2f}s")
    sf.write(out_path, segment, sr)


import re as _re


def _split_long_segment(seg: dict, max_duration: float = 12.0) -> list[dict]:
    """Split a segment longer than max_duration into sub-segments.

    Strategy:
      1. If word-level timestamps available, find largest inter-word silence gap
         (≥50ms) and split there — most accurate, uses real speech boundaries.
      2. Else fall back to sentence-boundary regex with proportional time estimate.

    Recursively splits each piece until <= max_duration.
    """
    duration = seg["end"] - seg["start"]
    if duration <= max_duration:
        return [dict(seg)]

    words = seg.get("words") or []
    text = seg.get("text", "").strip()

    # ── Path A: word-level — find biggest silence gap ──
    if len(words) >= 4:
        gaps = []
        for i in range(1, len(words)):
            gap = words[i]["start"] - words[i - 1]["end"]
            gaps.append((gap, i))
        # Prefer largest gap, tie-break toward middle
        mid_time = seg["start"] + duration / 2
        gaps.sort(key=lambda g: (-g[0], abs(words[g[1]]["start"] - mid_time)))

        if gaps and gaps[0][0] >= 0.05:
            split_idx = gaps[0][1]
            left_words = words[:split_idx]
            right_words = words[split_idx:]
            left_text = "".join(w["word"] for w in left_words).strip()
            right_text = "".join(w["word"] for w in right_words).strip()
            if left_text and right_text:
                left_seg = {
                    **seg,
                    "start": seg["start"],
                    "end": left_words[-1]["end"],
                    "text": left_text,
                    "words": left_words,
                }
                right_seg = {
                    **seg,
                    "start": right_words[0]["start"],
                    "end": seg["end"],
                    "text": right_text,
                    "words": right_words,
                }
                return _split_long_segment(left_seg, max_duration) + \
                       _split_long_segment(right_seg, max_duration)

    # ── Path B: sentence boundary fallback ──
    if not text:
        return [dict(seg)]

    parts = _re.split(r"(?<=[.!?。！？])\s+", text)
    parts = [p.strip() for p in parts if p.strip()]

    # If no sentence break, force split by comma or half
    if len(parts) < 2:
        parts = _re.split(r"(?<=[,;，；])\s+", text)
        parts = [p.strip() for p in parts if p.strip()]

    if len(parts) < 2:
        # Still one chunk — split text in halves by word count
        words = text.split()
        mid = len(words) // 2
        if mid == 0:
            return [dict(seg)]
        parts = [" ".join(words[:mid]), " ".join(words[mid:])]

    # Estimate timestamps proportional to character count
    total_chars = sum(len(p) for p in parts) or 1
    subs = []
    cursor = seg["start"]
    for i, p in enumerate(parts):
        frac = len(p) / total_chars
        sub_dur = duration * frac
        sub_start = cursor
        sub_end = seg["end"] if i == len(parts) - 1 else cursor + sub_dur
        subs.append({
            **seg,
            "start": round(sub_start, 2),
            "end": round(sub_end, 2),
            "text": p,
            "words": [],
        })
        cursor = sub_end

    # Recurse on each piece — proportional split may still leave one too long
    out = []
    for s in subs:
        if s["end"] - s["start"] > max_duration:
            out.extend(_split_long_segment(s, max_duration))
        else:
            out.append(s)
    return out


def _snap_segment_to_words(seg: dict, gap_threshold: float = 0.2,
                            keep_padding: float = 0.08) -> dict:
    """Tighten segment boundaries to actual first/last word times.

    Whisper VAD pads each segment by 200-400ms. With word timestamps we can
    snap start/end to real speech. `keep_padding` giữ chút lề cho TTS, nhưng
    đã được thắt chặt từ 0.2s → 0.08s (Tier 1.3) để boundary chính xác hơn.
    `gap_threshold` từ 0.5s → 0.2s — snap aggressive hơn.
    """
    words = seg.get("words") or []
    if not words:
        return dict(seg)

    snapped = dict(seg)
    speech_start = words[0]["start"]
    speech_end = words[-1]["end"]
    # Only snap if the silent padding is BIG enough to justify removing
    if speech_start - seg["start"] > gap_threshold:
        snapped["start"] = round(max(seg["start"], speech_start - keep_padding), 2)
    if seg["end"] - speech_end > gap_threshold:
        snapped["end"] = round(min(seg["end"], speech_end + keep_padding), 2)
    return snapped


def _silero_speech_timestamps(audio_path: str | Path) -> list[tuple[float, float]]:
    """Dùng Silero VAD detect đoạn nói thực trong audio gốc.

    Trả về list (start_s, end_s) — boundary chính xác đến ~20ms (vs ~200ms
    của Whisper VAD). Cache kết quả để gọi nhiều lần không tốn GPU.

    Nếu Silero không available, trả [] — caller fallback về word timestamps.
    """
    try:
        from silero_vad import load_silero_vad, get_speech_timestamps
        import torch
        import soundfile as _sf
    except Exception:
        return []

    try:
        audio, sr = _sf.read(str(audio_path))
        # Mono + resample về 16kHz (Silero yêu cầu)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 16000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
            sr = 16000
        audio_t = torch.from_numpy(audio).float()
        model = load_silero_vad()
        ts = get_speech_timestamps(
            audio_t, model,
            sampling_rate=16000,
            threshold=0.4,
            min_speech_duration_ms=200,
            min_silence_duration_ms=200,
            return_seconds=True,
        )
        return [(t["start"], t["end"]) for t in ts]
    except Exception as e:
        logger.warning("Silero VAD failed: %s — fallback to word timestamps", e)
        return []


def _snap_segments_with_silero(segments: list[dict], audio_path: str | Path,
                                tighten_only: bool = True) -> list[dict]:
    """Tier 1.3: Snap segment boundaries với Silero VAD (chính xác ~20ms).

    Args:
      segments: list segments đã có start/end từ Whisper.
      audio_path: path tới audio gốc.
      tighten_only: nếu True, chỉ điều chỉnh boundary INSIDE segment hiện tại
                    (không expand). Tránh việc segment lấn sang đoạn khác.

    Algorithm:
      1. Chạy Silero VAD trên audio gốc → list speech regions chính xác.
      2. Cho mỗi segment, tìm speech region overlap nhiều nhất → snap
         start/end về biên speech region đó.
      3. Giữ padding nhỏ 50ms để TTS có chỗ thở.
    """
    speech_regions = _silero_speech_timestamps(audio_path)
    if not speech_regions:
        return [dict(s) for s in segments]

    PADDING = 0.05  # 50ms padding nhẹ
    out = []
    for seg in segments:
        new_seg = dict(seg)
        s_start, s_end = seg["start"], seg["end"]
        # Tìm speech regions overlap với segment
        overlapping = [
            (r_start, r_end) for r_start, r_end in speech_regions
            if r_end > s_start and r_start < s_end
        ]
        if overlapping:
            # Lấy biên speech earliest/latest trong segment
            speech_start = max(s_start, min(r[0] for r in overlapping))
            speech_end = min(s_end, max(r[1] for r in overlapping))
            if tighten_only:
                # Chỉ tighten — không expand quá segment hiện tại
                new_start = max(s_start, speech_start - PADDING)
                new_end = min(s_end, speech_end + PADDING)
            else:
                new_start = speech_start - PADDING
                new_end = speech_end + PADDING
            # Sanity check — không để segment quá ngắn
            if new_end - new_start >= 0.3:
                new_seg["start"] = round(new_start, 2)
                new_seg["end"] = round(new_end, 2)
        out.append(new_seg)
    return out


def _split_all_long_segments(segments: list[dict], max_duration: float = 12.0) -> list[dict]:
    """Apply _split_long_segment to all segments."""
    out = []
    for seg in segments:
        out.extend(_split_long_segment(seg, max_duration=max_duration))
    return out


def _snap_all_to_words(segments: list[dict]) -> list[dict]:
    """Snap all segment boundaries to actual word timestamps."""
    return [_snap_segment_to_words(s) for s in segments]


# Sentence-terminator chars (period, question, exclamation, ellipsis trailing)
# Multi-language: ASCII + Chinese/Japanese fullwidth + Khmer/Thai endings.
_SENTENCE_END_CHARS = set(".!?。！？…؟।。")
# Mid-clause chars: comma/semicolon/colon → câu chưa đủ ý, NÊN merge với next.
_MID_CLAUSE_CHARS = set(",，、;；:：")

# Particle/connector cuối câu cho Chinese — Whisper Chinese không có dấu
# chấm rõ, nhưng có particle 啊/呢/吗/吧/了/嘛/呀/啦 cuối câu = câu hoàn
# chỉnh; còn 的/和/与/而/但 = câu chưa hết → cần merge với next.
_ZH_END_PARTICLES = set("啊呢吗吧了嘛呀啦哦哈嘿喂")
# Connector từ ZH thường nằm cuối nửa câu, signals continue
_ZH_CONTINUE_CHARS = set("的和与而但所以因为如果虽然但是")


def _ends_complete_sentence(text: str) -> bool:
    """Đoạn text này đã kết thúc 1 câu hoàn chỉnh chưa?

    Logic:
      1. Có dấu chấm/than/hỏi tận cùng → True
      2. Tận cùng bằng particle Chinese (啊/吗/吧/了…) → True
      3. Tận cùng bằng connector Chinese (的/和/而…) → False (câu chưa hết)
      4. Comma/colon/semicolon → False
      5. Không có gì → False (Chinese Whisper output chỉ Hán tự, no period)

    Quote ngoặc cuối được skip để check char trước nó.
    """
    if not text:
        return False
    s = text.rstrip()
    if not s:
        return False
    while s and s[-1] in '")]}\'’”':
        s = s[:-1]
    if not s:
        return False
    last = s[-1]
    # Hard: dấu chấm
    if last in _SENTENCE_END_CHARS:
        return True
    # Chinese particle cuối câu
    if last in _ZH_END_PARTICLES:
        return True
    # Chinese connector → chưa hết câu
    if last in _ZH_CONTINUE_CHARS:
        return False
    # Comma/colon/semicolon → chưa hết
    if last in _MID_CLAUSE_CHARS:
        return False
    return False


def _has_low_density_gaps(segs: list[dict], total_dur: float, gap_threshold: float = 8.0) -> bool:
    """Detect "thoại missing" — nếu có gap ≥8s giữa segments / từ start→seg đầu /
    seg cuối→end audio mà total_dur > 30s, có khả năng STT vocals miss.

    Lý do gap dài bất thường thường là: nhạc đè thoại nhỏ → vocals.wav ghi
    silent mà thực tế có thoại trong original.
    """
    if not segs or total_dur < 30:
        return False
    if not isinstance(segs, list) or len(segs) < 1:
        return True

    # Gap đầu
    first_start = float(segs[0].get("start", 0))
    if first_start > gap_threshold:
        return True
    # Gap cuối
    last_end = float(segs[-1].get("end", 0))
    if total_dur - last_end > gap_threshold:
        return True
    # Gap giữa
    for i in range(1, len(segs)):
        prev_end = float(segs[i - 1].get("end", 0))
        cur_start = float(segs[i].get("start", 0))
        if cur_start - prev_end > gap_threshold:
            return True
    return False


def _merge_dual_stt_segments(
    primary: list[dict],
    secondary: list[dict],
    overlap_threshold: float = 0.3,
) -> list[dict]:
    """Merge 2 STT outputs: primary (vocals - chính xác) + secondary (original
    - bắt thoại mềm).

    Rule: giữ TẤT CẢ primary, add seg từ secondary CHỈ KHI không overlap
    với bất kỳ primary nào (overlap_ratio < threshold). Sort by start.

    overlap_ratio = overlap_dur / min(primary_dur, secondary_dur).
    threshold 0.3 = chấp nhận seg secondary nếu < 30% overlap với mọi
    primary (tức là chủ yếu nằm ở khoảng GAP của primary).
    """
    if not secondary:
        return list(primary)
    if not primary:
        return list(secondary)

    out = list(primary)
    added = 0
    for s in secondary:
        s_start = float(s.get("start", 0))
        s_end = float(s.get("end", 0))
        s_dur = max(0.1, s_end - s_start)
        # Check overlap với mọi primary
        max_overlap_ratio = 0.0
        for p in primary:
            p_start = float(p.get("start", 0))
            p_end = float(p.get("end", 0))
            p_dur = max(0.1, p_end - p_start)
            overlap = max(0.0, min(s_end, p_end) - max(s_start, p_start))
            ratio = overlap / min(s_dur, p_dur)
            if ratio > max_overlap_ratio:
                max_overlap_ratio = ratio
        if max_overlap_ratio < overlap_threshold:
            # Seg này nằm chủ yếu ở gap → add (vocals đã miss)
            new_seg = dict(s)
            new_seg["_source"] = "original_dual_pass"  # mark debug
            out.append(new_seg)
            added += 1

    # Sort by start time
    out.sort(key=lambda x: float(x.get("start", 0)))
    return out


def _dedup_repeated_text(segs: list[dict]) -> list[dict]:
    """Drop segments có text trùng lặp với segment liền trước.

    Whisper Chinese drama hay bị "stuck repeat": cùng 1 audio chunk khác
    nhau nhưng model output cùng text vì context loop. Sau khi đã tắt
    condition_on_previous_text, đây là safety net — nếu 2+ segs liên tiếp
    có normalized text giống hệt, chỉ giữ seg đầu (timing chính xác nhất),
    drop phần còn lại.

    Normalize: bỏ whitespace + lowercase. Không dedup nếu text rỗng (segment
    nhạc/silence sẽ filter ở bước khác).
    """
    if not segs:
        return segs
    out: list[dict] = []
    last_norm: str | None = None
    dropped = 0
    for s in segs:
        norm = "".join((s.get("text") or "").split()).lower()
        if norm and norm == last_norm:
            dropped += 1
            continue
        out.append(s)
        last_norm = norm or last_norm
    if dropped:
        logger.info("Dedup: dropped %d repeated-text segment(s) (Whisper hallucinate)", dropped)
    return out


def _merge_short_segments(segments: list[dict], min_duration: float = 2.5,
                           max_gap: float = 1.5, max_combined: float = 10.0) -> list[dict]:
    """Merge short segments with their neighbors for better dubbing timing.

    Merge rules (theo độ ưu tiên):
      1. SENTENCE COMPLETION: Nếu prev kết thúc bằng comma/no-punct (chưa
         đủ câu) AND gap nhỏ AND combined không quá dài → MERGE.
         → Tránh sub kiểu "Chú Lâm nói anh ta là đồ vô dụng," | "chỉ làm
         con bị bạn bè cười nhạo." (1 câu bị tách 2 dòng)
      2. SHORT-DURATION FALLBACK: Nếu prev/cur quá ngắn (< min_duration) AND
         gap nhỏ → MERGE (giúp dubbing có timing đủ thoải mái cho TTS).
      3. KHÔNG merge nếu prev đã kết thúc câu rõ ràng (period/?/!) và cả
         hai đều đủ dài → giữ subtitle riêng.

    Tier 1.2: ghi lại "internal_pauses" trong segment đã merge để post-TTS
    insert silence tại đúng vị trí tương đối, giữ rhythm/cảm xúc gốc.
    """
    if not segments:
        return segments

    merged = [dict(segments[0])]
    merged[-1].setdefault("internal_pauses", [])

    for seg in segments[1:]:
        prev = merged[-1]
        prev_dur = prev["end"] - prev["start"]
        cur_dur = seg["end"] - seg["start"]
        gap = seg["start"] - prev["end"]
        combined_dur = seg["end"] - prev["start"]

        # Speaker check: KHÔNG merge nếu khác speaker (multi-voice mode mới
        # gán; single voice thì cả 2 đều None → check pass)
        prev_spk = prev.get("speaker")
        cur_spk = seg.get("speaker")
        same_speaker = prev_spk == cur_spk or prev_spk is None or cur_spk is None

        prev_text = (prev.get("text") or "").strip()
        prev_complete = _ends_complete_sentence(prev_text)

        # Rule 1: prev chưa kết thúc câu → merge nếu gap nhỏ + combined OK
        # (more aggressive — chấp nhận combined dài hơn để giữ câu nguyên vẹn)
        sentence_continues = (
            same_speaker
            and not prev_complete
            and gap < max_gap
            and combined_dur <= max_combined + 2.0
        )

        # Rule 2: short-duration merge (legacy)
        short_merge = (
            same_speaker
            and (prev_dur < min_duration or cur_dur < min_duration)
            and gap < max_gap
            and combined_dur <= max_combined
        )

        should_merge = sentence_continues or short_merge
        if should_merge:
            # Record pause position RELATIVE TO START of merged segment.
            # Vd: prev=0-3s, gap=0.4s, cur=3.4-5s → merged 0-5s với pause
            # tại offset 3s, duration 0.4s.
            if gap >= 0.3:  # chỉ track pause > 300ms (đáng lưu cho dub)
                pause_offset = prev["end"] - prev["start"]
                prev["internal_pauses"].append({
                    "offset": round(pause_offset, 3),
                    "duration": round(gap, 3),
                })
            prev["end"] = seg["end"]
            prev["text"] = (prev["text"] + " " + seg["text"]).strip()
            if prev.get("words") or seg.get("words"):
                prev["words"] = list(prev.get("words") or []) + list(seg.get("words") or [])
        else:
            new_seg = dict(seg)
            new_seg.setdefault("internal_pauses", [])
            merged.append(new_seg)

    return merged


def _insert_pauses_in_audio(audio_np, sr: int, target_total_dur: float,
                              pauses: list[dict]) -> "np.ndarray":
    """Tier 1.2: Insert silence vào audio TTS tại vị trí pauses (proportional).

    Args:
      audio_np: TTS output audio array (1D mono).
      sr: sample rate.
      target_total_dur: target total duration của segment (= seg.end - seg.start).
      pauses: list {"offset": s_relative_to_seg_start, "duration": s}.

    Algorithm:
      1. TTS thường ngắn hơn target_total_dur (vì dub trimmed silence).
         Tỉ lệ TTS/target = ratio.
      2. Với mỗi pause, position trong TTS = offset * ratio.
      3. Insert np.zeros(silence_samples) tại insert_idx.
    """
    import numpy as np
    if not pauses or len(audio_np) == 0:
        return audio_np

    actual_dur = len(audio_np) / sr
    if actual_dur <= 0 or target_total_dur <= 0:
        return audio_np
    ratio = actual_dur / target_total_dur  # TTS_dur / target_dur

    # Sort pauses by offset asc — insert from end to start để tránh shift index
    sorted_pauses = sorted(pauses, key=lambda p: p["offset"], reverse=True)
    out = audio_np.copy()
    for p in sorted_pauses:
        # Map vị trí: offset trong khung target → vị trí trong TTS audio
        rel_pos = p["offset"] * ratio
        insert_idx = int(rel_pos * sr)
        if insert_idx < 0 or insert_idx > len(out):
            continue
        silence_samples = int(p["duration"] * sr)
        if silence_samples <= 0:
            continue
        # Hơi giảm silence để tránh quá dài (TTS đã rate-matched)
        silence = np.zeros(silence_samples, dtype=out.dtype)
        out = np.concatenate([out[:insert_idx], silence, out[insert_idx:]])
    return out


def _filter_music_segments(
    segments: list[dict], audio_path: str,
    no_speech_threshold: float = 0.55,
    avg_logprob_threshold: float = -1.0,
    detect_singing: bool = True,
) -> list[dict]:
    """Filter ra music/singing segments — KHÔNG dub nhạc.

    Layers:
      1. Whisper confidence: no_speech_prob > 0.55 hoặc avg_logprob < -1.0
         → chắc chắn không phải speech (music/silence/gibberish)
      2. F0 stability detection: hát có F0 sustained (note giữ ~0.5-2s),
         speech có F0 varying nhanh (Vietnamese tonal). Std dev của F0 thấp
         + voicing ratio cao → singing.

    Returns: filtered segments. Music segments được DROP với log warning.
    """
    if not segments:
        return segments
    out = []
    dropped = []
    audio_data = None
    sr = None

    for seg in segments:
        text = (seg.get("text") or "").strip()
        nsp = float(seg.get("no_speech_prob", 0.0) or 0.0)
        alp = float(seg.get("avg_logprob", 0.0) or 0.0)
        dur = seg["end"] - seg["start"]

        # Layer 1: Whisper confidence filter
        if nsp > no_speech_threshold:
            dropped.append(("no_speech", seg["start"], seg["end"], text, nsp))
            continue
        if alp < avg_logprob_threshold and dur > 1.0:
            # Skip very short low-confidence (vd "ờ", "à") — chỉ filter dài
            dropped.append(("low_logprob", seg["start"], seg["end"], text, alp))
            continue

        # Layer 2: Singing detection via F0 stability (only for longer segments)
        if detect_singing and dur >= 1.5:
            try:
                if audio_data is None:
                    import soundfile as sf
                    audio_data, sr = sf.read(audio_path, dtype="float32")
                    if audio_data.ndim > 1:
                        audio_data = audio_data.mean(axis=1)
                start_sample = int(seg["start"] * sr)
                end_sample = min(int(seg["end"] * sr), len(audio_data))
                chunk = audio_data[start_sample:end_sample]
                if len(chunk) >= sr * 0.5:
                    is_singing, reason = _detect_singing(chunk, sr)
                    if is_singing:
                        dropped.append(("singing", seg["start"], seg["end"], text, reason))
                        continue
            except Exception as e:
                logger.warning("Singing detect failed for seg: %s", e)

        out.append(seg)

    if dropped:
        logger.info(
            "Filtered %d music/non-speech segment(s) (kept %d):",
            len(dropped), len(out),
        )
        for kind, s, e, txt, meta in dropped[:10]:
            logger.info("  [%s] %.1f-%.1fs (%.2f) %s", kind, s, e, meta, txt[:60])
        if len(dropped) > 10:
            logger.info("  ... %d more dropped", len(dropped) - 10)
    return out


def _detect_singing(audio: np.ndarray, sr: int) -> tuple[bool, float]:
    """Detect singing vs speech qua F0 stability + voicing pattern.

    Speech vs singing characteristics:
      - SPEECH: F0 varies nhanh (Vietnamese tone shift mỗi syllable ~150-250ms),
        voicing pattern bursty (vowel/consonant alternation), short voiced runs
      - SINGING: F0 sustained tại pitch (note giữ 300ms-2s), voicing pattern
        smooth (vibrato), long voiced runs

    Trả (is_singing: bool, score: float). score càng cao càng giống singing.
    """
    try:
        import librosa
        f0, voiced_flag, voiced_prob = librosa.pyin(
            audio.astype(np.float32),
            fmin=70.0, fmax=600.0,
            sr=sr, frame_length=int(sr * 0.05),
        )
        valid = (~np.isnan(f0)) & (voiced_prob >= 0.5)
        if np.sum(valid) < 10:
            return False, 0.0
        f0_vals = f0[valid]

        # Metric 1: F0 std (Hz). Speech: 30-80Hz var. Singing: 5-25Hz var.
        f0_std = float(np.std(f0_vals))

        # Metric 2: Sustained pitch — tỉ lệ frames F0 trong ±5% median
        f0_median = float(np.median(f0_vals))
        sustained = float(np.mean(np.abs(f0_vals - f0_median) / max(f0_median, 1e-6) < 0.05))

        # Metric 3: Voicing ratio (singing voiced almost continuous, speech ~50%)
        voicing_ratio = float(np.mean(voiced_prob >= 0.5))

        # Composite score
        score = 0.0
        if f0_std < 20:           score += 1.0
        elif f0_std < 35:         score += 0.5
        if sustained > 0.55:      score += 1.0
        elif sustained > 0.40:    score += 0.5
        if voicing_ratio > 0.85:  score += 1.0
        elif voicing_ratio > 0.70: score += 0.5

        # 2.0+ = strong singing signal (3 features all positive)
        return score >= 2.0, score
    except Exception:
        return False, 0.0


def _trim_sparse_segments(segments: list[dict], max_speech_per_sec: float = 14.0) -> list[dict]:
    """Trim segments where text is too short for the duration (sparse speech).

    If a segment has duration 20s but text fits only 3s of speech (at 14 chars/sec),
    the extra 17s is likely silence in source audio. We shrink the segment end
    to what the text can fill (+ small buffer), letting natural silence fall
    in the gap between segments rather than inside a single segment.
    """
    out = []
    for seg in segments:
        text = seg.get("text", "").strip()
        duration = seg["end"] - seg["start"]
        # Estimated speech duration for this text (Vietnamese ~14 chars/sec)
        estimated_dur = max(1.0, len(text) / max_speech_per_sec)
        # If actual slot is much longer than estimated speech + 2s buffer → shrink
        if duration > estimated_dur * 2 + 2.0:
            new_dur = min(duration, estimated_dur * 1.5 + 1.0)
            new_seg = dict(seg)
            new_seg["end"] = round(seg["start"] + new_dur, 2)
            out.append(new_seg)
        else:
            out.append(dict(seg))
    return out


def _project_dir(project_id: str) -> Path:
    return DUBBING_DIR / project_id


def _segments_dir(project_id: str) -> Path:
    d = _project_dir(project_id) / "segments"
    d.mkdir(exist_ok=True)
    return d


def _meta_path(project_id: str) -> Path:
    return _project_dir(project_id) / "project.json"


def _save_meta(project: dict):
    path = _meta_path(project["id"])
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_meta(project_id: str) -> dict | None:
    path = _meta_path(project_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _fmt_time(seconds: float) -> str:
    m, s = divmod(seconds, 60)
    h, m = divmod(int(m), 60)
    return f"{h:02d}:{int(m):02d}:{s:05.2f}"


# ── Project CRUD ────────────────────────────────────

def create_project(video_data: bytes, video_filename: str,
                   target_language: str, voice_id: str = None,
                   source_language: str = "auto",
                   enable_dubbing: bool = True,
                   enable_subtitle: bool = False) -> dict:
    """Create dubbing project: save video, extract audio."""
    project_id = uuid.uuid4().hex[:12]
    pdir = _project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)

    # Save video
    video_path = pdir / "original.mp4"
    video_path.write_bytes(video_data)

    # Extract audio with ffmpeg
    audio_path = pdir / "original_audio.wav"
    try:
        # Pre-check: video có audio stream không?
        try:
            probe = ffmpeg.probe(str(video_path))
            has_audio = any(s.get("codec_type") == "audio" for s in probe.get("streams", []))
            if not has_audio:
                shutil.rmtree(pdir, ignore_errors=True)
                raise ValueError(
                    "Video không có tiếng. Hãy chọn video có âm thanh để có thể lồng tiếng.",
                )
        except ffmpeg.Error as probe_err:
            # Probe fail = file corrupt / format lạ — log technical, báo user simple
            stderr = (probe_err.stderr or b"").decode("utf-8", errors="ignore")[-500:]
            logger.error("ffprobe fail. stderr:\n%s", stderr)
            shutil.rmtree(pdir, ignore_errors=True)
            raise ValueError(
                "Không đọc được file video. File có thể bị hỏng hoặc định dạng "
                "không hỗ trợ. Hãy thử upload lại hoặc dùng video MP4 chuẩn.",
            )

        (
            ffmpeg
            .input(str(video_path))
            .output(str(audio_path), acodec="pcm_s16le", ac=1, ar=16000)
            .overwrite_output()
            .run(quiet=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = (e.stderr or b"").decode("utf-8", errors="ignore")[-800:]
        shutil.rmtree(pdir, ignore_errors=True)
        logger.error("ffmpeg extract audio fail. stderr:\n%s", stderr)
        # User-facing message luôn tiếng Việt, KHÔNG kèm stderr kỹ thuật.
        # Stderr đầy đủ đã log server-side để dev/admin debug.
        if "Invalid data found" in stderr or "moov atom not found" in stderr:
            msg = "File video bị hỏng hoặc tải lên chưa trọn vẹn. Hãy thử upload lại."
        elif "No such file" in stderr or "Permission denied" in stderr:
            msg = "Lỗi hệ thống khi xử lý file. Vui lòng thử lại sau ít phút."
        else:
            msg = "Không xử lý được video này. Hãy thử file khác (định dạng MP4 chuẩn, có âm thanh)."
        raise ValueError(msg)

    # Get video duration
    try:
        probe = ffmpeg.probe(str(video_path))
        duration = float(probe["format"]["duration"])
    except Exception:
        duration = 0.0

    # Generate thumbnail (frame ở giây thứ 1, hoặc giữa video nếu ngắn hơn)
    try:
        thumb_path = pdir / "thumbnail.jpg"
        thumb_at = min(1.0, max(0.0, duration / 2)) if duration > 0 else 0
        (
            ffmpeg
            .input(str(video_path), ss=thumb_at)
            .output(str(thumb_path), vframes=1, **{"q:v": 4})
            .overwrite_output()
            .run(quiet=True)
        )
    except Exception as e:
        logger.warning("Thumbnail generation failed: %s", e)

    project = {
        "id": project_id,
        "status": "created",
        "source_language": None,
        "source_language_input": source_language,
        "target_language": target_language,
        "voice_id": voice_id,
        "tts_engine": _detect_tts_engine(),
        "edge_voice": None,    # Edge TTS voice name, auto-selected if None
        "enable_dubbing": enable_dubbing,
        "enable_subtitle": enable_subtitle,
        "subtitle_style": {
            "font_family": "Arial",
            "font_size": 24,
            "font_color": "#FFFFFF",
            "font_bold": False,
            "font_italic": False,
            "bg_color": "#000000",
            "bg_opacity": 0.6,
            "outline_color": "#000000",
            "outline_width": 2,
            "shadow_offset": 1,
            "position": "bottom",
            "margin_v": 30,
        },
        "segments": [],
        "video_filename": video_filename,
        "video_duration": round(duration, 2),
        "created_at": datetime.now().isoformat(),
    }
    _save_meta(project)
    logger.info("Dubbing project created: %s (%.1fs)", project_id, duration)
    return project


def get_project(project_id: str) -> dict | None:
    return _load_meta(project_id)


def list_projects() -> list[dict]:
    projects = []
    for d in sorted(DUBBING_DIR.iterdir()):
        if d.is_dir():
            meta = _load_meta(d.name)
            if meta:
                projects.append(meta)
    return projects


def delete_project(project_id: str) -> bool:
    pdir = _project_dir(project_id)
    if pdir.exists():
        shutil.rmtree(pdir)
        return True
    return False


# ── Vocal Separation ───────────────────────────────

def separate_vocals(project_id: str) -> dict:
    """Separate vocals from accompaniment (music/SFX) using Demucs."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    pdir = _project_dir(project_id)
    audio_path = pdir / "original_audio.wav"
    if not audio_path.exists():
        raise ValueError("Original audio not found")

    project["vocal_separation_status"] = "processing"
    _save_meta(project)

    try:
        result = vocal_separator_svc.separate(str(audio_path), str(pdir))
        project["vocal_separation_status"] = "done"
        project["has_accompaniment"] = True
        _save_meta(project)
        logger.info("Vocal separation done for project %s", project_id)
        return project
    except Exception as e:
        project["vocal_separation_status"] = "error"
        _save_meta(project)
        raise ValueError(f"Vocal separation failed: {e}")


def get_vocals_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "vocals.wav"
    return path if path.exists() else None


def get_accompaniment_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "accompaniment.wav"
    return path if path.exists() else None


# ── Transcribe ──────────────────────────────────────

def _detect_genders_for_whisperx_speakers(
    segments: list[dict], audio_path: str, speakers: list[str],
) -> tuple[dict[str, str], dict[str, float]]:
    """Detect gender per WhisperX/pyannote speaker bằng Resemblyzer pitch.

    Pyannote chỉ assign label (SPEAKER_00, SPEAKER_01...) chứ không detect
    gender. Dùng Resemblyzer F0 estimator (librosa.pyin + octave correction)
    trên audio chunks của từng speaker để suy gender.

    Trả (speaker_genders, speaker_gender_confidences).
    """
    try:
        from app.services.speaker_pipeline.gender import (
            detect_speaker_genders_with_confidence,
        )
        from app.services.speaker_pipeline.types import DiarizationTurn
    except Exception as e:
        logger.warning("WhisperX gender helper unavailable: %s", e)
        return {}, {}

    turns = []
    for seg in segments:
        spk = seg.get("speaker")
        if not spk:
            continue
        start = float(seg.get("start", 0.0) or 0.0)
        end = float(seg.get("end", 0.0) or 0.0)
        if end - start < 0.35:
            continue
        turns.append(DiarizationTurn(start=start, end=end, speaker=str(spk)))
    if not turns:
        return {}, {}

    full = detect_speaker_genders_with_confidence(audio_path, turns, speakers)
    speaker_genders = {
        spk: info.get("gender", "unknown")
        for spk, info in full.items()
    }
    gender_confidences = {
        spk: float(info.get("confidence") or 0.0)
        for spk, info in full.items()
    }
    logger.info(
        "WhisperX gender detection: %s",
        {spk: f"{speaker_genders.get(spk, 'unknown')}:{gender_confidences.get(spk, 0):.2f}"
         for spk in speakers},
    )
    return speaker_genders, gender_confidences


def transcribe_project(project_id: str) -> dict:
    """Run Demucs (auto) → Whisper on vocals for cleaner transcription.

    Idempotent: nếu project đã có segments + status >= editing → skip toàn bộ
    re-transcribe (tránh duplicate work khi pipeline restart hoặc user click
    "Dùng lại" — không cần Whisper lần 2 trên cùng audio).
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError(f"Project '{project_id}' not found")

    # Skip nếu đã transcribed (segments có sẵn + status đã qua transcribing)
    existing_segs = project.get("segments") or []
    skip_states = {"editing", "translating", "generating", "tts", "exporting", "done"}
    if existing_segs and project.get("status") in skip_states:
        logger.info(
            "Skip transcribe: project=%s đã có %d segments, status=%s",
            project_id, len(existing_segs), project.get("status"),
        )
        return project

    # Phase 7b → Phase 8 quick win: clear stale per-project slot caches từ
    # pre-Phase 7b runs (keyed bằng CHAR_XX 2-digit, sau Option B sẽ keyed
    # bằng CHAR_XXX 3-digit hoặc raw IDs). Nếu giữ cache cũ → voice cycling
    # sẽ pick wrong voice cho project transcribe lại. 1 dòng, risk thấp.
    project.pop("_omni_slot_cache_v2", None)
    project.pop("_edge_slot_cache_v2", None)

    project["status"] = "transcribing"
    _save_meta(project)

    pdir = _project_dir(project_id)
    audio_path = str(pdir / "original_audio.wav")

    # Step 1: Auto-separate vocals (Demucs) — LUÔN chạy.
    # Lý do:
    #   - STT trên vocals sạch nhạc → accuracy cao hơn
    #   - Export mix LUÔN có accompaniment.wav + vocals.wav → không bao giờ
    #     fallback dùng original_audio.wav (sẽ kéo cả tiếng người gốc vào mix
    #     dù user đã tắt "Giữ giọng gốc").
    # Cost: 30-60s/video. Idempotent — đã tách 1 lần thì skip.
    if not vocal_separator_svc.is_separated(str(pdir)):
        try:
            logger.info("Auto-separating vocals before transcription (Demucs)...")
            vocal_separator_svc.separate(audio_path, str(pdir))
            project["has_accompaniment"] = True
            _save_meta(project)
        except Exception as e:
            logger.warning("Vocal separation failed, transcribing full audio: %s", e)

    # Step 2: Pre-amplify vocals (compressor + LUFS norm) so Whisper catches
    # quiet whispers / internal monologues that VAD would otherwise filter as silence.
    vocals_path = pdir / "vocals.wav"
    # User toggle: BẬT (default) → STT đọc vocals đã tách (sạch nhạc, chuẩn hơn)
    # TẮT → STT đọc audio gốc (bắt được whisper / voice nhỏ Demucs cắt sót)
    use_vocals_for_stt = bool(project.get("whisper_use_vocals", True))
    if use_vocals_for_stt and vocals_path.exists():
        audio_to_transcribe = str(vocals_path)
        try:
            from app.services.audio_mix_svc import normalize_for_stt
            normalized_path = pdir / "vocals_normalized.wav"
            normalize_for_stt(str(vocals_path), str(normalized_path))
            audio_to_transcribe = str(normalized_path)
            logger.info("Pre-amplified vocals for STT (catches quiet speech)")
        except Exception as e:
            logger.warning("STT pre-amp failed (%s), using raw vocals", e)
    else:
        # User tắt toggle HOẶC chưa có vocals → STT trên audio gốc
        audio_to_transcribe = audio_path
        if not use_vocals_for_stt:
            logger.info("User toggled OFF — STT on ORIGINAL audio (catches quiet/whisper)")

    logger.info("Transcribing: %s", audio_to_transcribe)

    src_lang = project.get("source_language_input", "auto")
    src_lang_norm = src_lang if src_lang != "auto" else None

    # WhisperX opt-in path — priority:
    #   1. project.quality_mode (per-project user setting từ UI) WIN: nếu
    #      user explicitly chọn "fast" hay "high", luôn respect.
    #   2. Nếu meta KHÔNG có quality_mode (project cũ trước feature) →
    #      fallback USE_WHISPERX env (global override admin set).
    #   3. AND whisperx đã pip-installed. Nếu fail → fallback whisper_svc.
    raw_quality_mode = project.get("quality_mode")
    if raw_quality_mode:
        # User-explicit choice → respect tuyệt đối
        quality_mode = raw_quality_mode.lower()
        use_whisperx_for_proj = quality_mode == "high"
    else:
        # Default per-project chưa set → dùng env
        quality_mode = "fast"
        use_whisperx_for_proj = USE_WHISPERX
    used_whisperx = False
    whisperx_speakers: list[str] = []  # nếu pyannote diarize chạy được
    if use_whisperx_for_proj and whisperx_svc.is_available():
        try:
            do_diar = voice_count > 1 and whisperx_svc.is_diarize_available()
            logger.info("Using WhisperX path (align=True, diarize=%s)", do_diar)
            wx_result = whisperx_svc.transcribe(
                audio_to_transcribe,
                language=src_lang_norm,
                do_align=True,
                do_diarize=do_diar,
                min_speakers=2 if voice_count > 1 else 1,
                max_speakers=max(voice_count, 6),
            )
            result = wx_result
            whisperx_speakers = wx_result.get("speakers", [])
            used_whisperx = True
        except Exception as e:
            logger.warning("WhisperX failed (%s) — fallback whisper_svc", e)
    elif use_whisperx_for_proj and not whisperx_svc.is_available():
        logger.warning("Chế độ chính xác cao yêu cầu `whisperx`. Run: pip install whisperx")

    if not used_whisperx:
        result = whisper_svc.transcribe(audio_to_transcribe, language=src_lang_norm)

    raw_segs = result.get("segments", [])

    # ── Dual-STT smart merge ──
    # Demucs làm méo / loại thoại MỀM, THÌ THẦM, XA MIC, ĐẦU/CUỐI CÂU bị
    # nhạc đè → STT trên vocals.wav MISS các đoạn này.
    # Strategy: nếu STT vocals trả ÍT segments hơn expected (heuristic
    # 0.15 seg/sec audio) → chạy thêm 1 pass trên ORIGINAL audio và merge
    # segments KHÔNG overlap với vocals segments.
    audio_dur = float(project.get("video_duration") or project.get("audio_duration") or 0)
    expected_segs = max(3, int(audio_dur * 0.15))  # rough lower bound
    do_dual_pass = (
        audio_to_transcribe != audio_path
        and (
            len(raw_segs) < expected_segs
            or _has_low_density_gaps(raw_segs, audio_dur)
        )
    )
    if not raw_segs and audio_to_transcribe != audio_path:
        # Vocals fail hoàn toàn → original duy nhất
        logger.warning("No segments from vocals.wav — fallback original audio")
        result = whisper_svc.transcribe(audio_path, language=src_lang_norm)
        raw_segs = result.get("segments", [])
    elif do_dual_pass:
        try:
            logger.info(
                "Dual-STT: vocals trả %d segs (expected ≥%d) — chạy 2nd pass trên original để bắt thoại mềm",
                len(raw_segs), expected_segs,
            )
            orig_result = whisper_svc.transcribe(audio_path, language=src_lang_norm)
            orig_segs = orig_result.get("segments", [])
            merged_segs = _merge_dual_stt_segments(raw_segs, orig_segs)
            added = len(merged_segs) - len(raw_segs)
            if added > 0:
                logger.info(
                    "Dual-STT merge: +%d seg từ original (vocals MISS) → total %d",
                    added, len(merged_segs),
                )
            raw_segs = merged_segs
        except Exception as e:
            logger.warning("Dual-STT 2nd pass failed: %s — giữ vocals only", e)

    # ── Dedup repeated-text hallucination (Whisper Chinese drama hay loop) ──
    # Phải làm TRƯỚC music filter + post-process để tránh nhân lên các bug.
    raw_segs = _dedup_repeated_text(raw_segs)

    # ── Punctuation + sentence-aware split (CapCut-style) ──
    # Whisper Chinese không có dấu chấm rõ → text chạy 1 dòng dài, post-process
    # merge/split sau đó cắt giữa câu → sub vụn.
    # Phase mới: thêm dấu câu (neural model) → split theo dấu câu → mỗi sub
    # là 1 câu hoàn chỉnh, timestamp chính xác từ word-level.
    if project.get("punctuate_split", True):
        try:
            from app.services.speech.punctuation import punctuate_and_split_segments
            detected_lang = result.get("language") or src_lang_norm
            before = len(raw_segs)
            raw_segs = punctuate_and_split_segments(
                raw_segs,
                language=detected_lang,
                max_chars_per_sub=50,
                min_chars_per_sub=8,
            )
            logger.info(
                "Punctuate+split: %d → %d sentences (lang=%s)",
                before, len(raw_segs), detected_lang,
            )
        except Exception as e:
            logger.warning("Punctuate+split failed (%s) — giữ raw segments", e)

    # ── Music/singing filter ──
    # Lọc ra segment hát hoặc nhạc trước khi post-process. Trên video có
    # BGM với lời hát (movie OST, drama opening), Whisper sẽ transcribe
    # cả lời hát → pipeline sẽ dub nhầm. Filter qua 2 layer:
    #   1. Whisper no_speech_prob + avg_logprob (LM confidence)
    #   2. F0 stability (singing has sustained pitch, speech variable)
    # Bật/tắt qua project["filter_music"] (default True).
    if project.get("filter_music", True):
        # Filter trên audio nguồn để singing detection có signal đầy đủ.
        # Dùng vocals nếu có (sạch hơn) else original.
        filter_audio = audio_to_transcribe
        before_count = len(raw_segs)
        raw_segs = _filter_music_segments(
            raw_segs, filter_audio,
            no_speech_threshold=0.55,
            avg_logprob_threshold=-1.0,
            detect_singing=True,
        )
        if len(raw_segs) < before_count:
            logger.info("Music filter: %d → %d segments (dropped %d)",
                        before_count, len(raw_segs), before_count - len(raw_segs))

    # Post-process pipeline (order matters — each step depends on prev):
    # 1. Snap each segment's start/end to actual word timestamps (remove VAD padding)
    snapped = _snap_all_to_words(raw_segs)
    snap_savings = sum(
        (raw["end"] - raw["start"]) - (s["end"] - s["start"])
        for raw, s in zip(raw_segs, snapped)
    )
    logger.info("Post-process: snap-to-words removed %.1fs of silent edges", snap_savings)

    # 1b. Tier 1.3: Refine boundary với Silero VAD (chính xác ~20ms vs Whisper ~200ms)
    silero_snapped = _snap_segments_with_silero(snapped, audio_to_transcribe, tighten_only=True)
    silero_savings = sum(
        (s1["end"] - s1["start"]) - (s2["end"] - s2["start"])
        for s1, s2 in zip(snapped, silero_snapped)
    )
    logger.info("Post-process: Silero VAD refined %d segments, saved %.2fs",
                len(silero_snapped), silero_savings)
    snapped = silero_snapped

    # 2. Split segments > 10s (Tier 1.1 — siết từ 12s → 10s để TTS natural hơn)
    # Tăng max từ 10s → 12s để giữ câu dài liền mạch (TTS slot dài đỡ overflow,
    # subtitle đọc tự nhiên hơn). 12s vẫn đủ ngắn để TTS render mượt.
    split_segs = _split_all_long_segments(snapped, max_duration=12.0)
    logger.info("Post-process: %d segments after split-long (was %d snapped)",
                len(split_segs), len(snapped))

    # 3. Trim sparse-speech segments (text too short for slot duration).
    # Speech rate khác nhau theo ngôn ngữ NGUỒN (đang transcribe) — vd
    # tiếng Trung ~6 char/s, Việt/Anh ~14-15 char/s, Nhật ~8 char/s.
    # Nếu apply rate sai → trim quá tay (Trung) hoặc trim quá ít (VI).
    detected_src = (result.get("language") or src_lang or "auto").lower()
    # Whisper trả ISO code (vi, zh, ja...) → map về key của SPEECH_CHARS_PER_SEC
    iso_to_key = {
        "vi": "vietnamese", "en": "english", "zh": "chinese", "ja": "japanese",
        "ko": "korean", "th": "thai", "fr": "french", "es": "spanish",
        "de": "german", "pt": "portuguese", "ru": "russian", "it": "italian",
        "ar": "arabic", "hi": "hindi", "id": "indonesian", "tr": "turkish",
        "nl": "dutch", "pl": "polish",
    }
    src_speech_rate = _speech_rate_for(iso_to_key.get(detected_src, detected_src))
    logger.info("Post-process: speech rate for src=%s → %.1f chars/sec",
                detected_src, src_speech_rate)
    trimmed = _trim_sparse_segments(split_segs, max_speech_per_sec=src_speech_rate)
    logger.info("Post-process: %d segments after trim-sparse", len(trimmed))

    # 4. Merge adjacent short segments (Tier 1.1: min 3s, gap 1.0s, combined 9s)
    # Aggressive merge: giữ câu liền mạch, đỡ vụn — đặc biệt quan trọng
    # cho Chinese vì Whisper KHÔNG output dấu chấm rõ → mọi seg trông như
    # "chưa hết câu" → cần merge mạnh.
    # min_duration 4.0 (segment <4s thử merge)
    # max_gap 1.8 (cho phép pause dài hơn nếu sentence chưa end — Chinese
    #              drama có nhiều pause cảm xúc)
    # max_combined 14.0 (rule sentence_continues còn +2s = 16s tối đa cho
    #                    câu cổ trang dài)
    merged = _merge_short_segments(trimmed, min_duration=4.0, max_gap=1.8, max_combined=14.0)
    logger.info("Post-process: %d segments after merge-short (final)", len(merged))

    # ── Speaker analysis: LUÔN CHẠY (kể cả voice_count=1 = thuyết minh) ──
    # UX design:
    #   • voice_count=1 = THUYẾT MINH: 1 giọng đọc tất cả, NHƯNG translation
    #     vẫn cần biết ai nam/nữ để dùng pronoun đúng (anh/em, mẹ/con, ...)
    #   • voice_count≥2 = LỒNG TIẾNG: mỗi nhân vật giọng riêng theo gender
    #
    # Cost: +30s GPU diarize + gender (acceptable cho pronoun chuẩn).
    # Translation luôn được pass speaker_genders → pronoun ground truth.
    # TTS voice picker:
    #   - voice_count=1: dùng voice_slots[0] cho mọi segment (1 giọng)
    #   - voice_count≥2: pick voice theo speaker (nhiều giọng)
    project_for_count = _load_meta(project_id) or {}
    voice_count_meta = int(project_for_count.get("voice_count") or 1)
    speaker_genders: dict[str, str] = {}
    # Init Phase 3: face_speaker hook gọi fuse_speakers cần audio confs.
    # Set default {} ở scope outer để safe khi pyannote try/except fail trước
    # khi set gender_confidences ở line 2252.
    gender_confidences: dict[str, float] = {}
    # Init Phase 4: track sp_result + fusion outcome cho voice_map unified
    # build sau character labels determined (CHAR_XX nếu fusion ran, else
    # SPEAKER_XX từ pyannote). Đảm bảo build_speaker_voice_map CHỈ CHẠY 1 LẦN
    # và SAU khi character_id stable (fix CRIT-2: voice map trước character_registry).
    sp_result = None  # set bởi pyannote analyze nếu thành công
    fusion_ran = False  # True nếu face fusion produced char_voice_map
    # Phase 7a — init fusion ở outer scope (set bên trong face hook nếu chạy).
    # Cần để character_registry build (sau face block) wire face_track_to_speaker
    # từ fusion.audio_to_face → E1 evidence.
    fusion = None  # type: ignore[assignment]
    face_result = None  # cũng cần ngoài scope cho gender_detection wire

    if used_whisperx and whisperx_speakers:
        try:
            wx_genders, wx_confs = _detect_genders_for_whisperx_speakers(
                merged, audio_path, whisperx_speakers,
            )
            if wx_genders:
                speaker_genders.update(wx_genders)
                gender_confidences.update(wx_confs)
                for seg in merged:
                    spk = seg.get("speaker")
                    if spk:
                        seg["audio_speaker"] = spk
                        seg["audio_speaker_gender"] = speaker_genders.get(spk)
                        seg["speaker_gender"] = speaker_genders.get(spk)
        except Exception as e:
            logger.warning("WhisperX gender detection failed: %s", e)

    # Skip speaker pipeline khi:
    # 1. User explicit skip qua env (VOX_SKIP_SPEAKER_PIPELINE=true)
    # 2. WhisperX path đã chạy + có speakers → speaker_pipeline trùng việc.
    # voice_count=1 vẫn chạy speaker analysis vì dịch Việt cần biết nam/nữ
    # và quan hệ nhân vật để xưng hô đúng, dù TTS chỉ dùng một giọng.
    skip_speaker = (
        os.environ.get("VOX_SKIP_SPEAKER_PIPELINE", "").lower() == "true"
        or (used_whisperx and len(whisperx_speakers) > 0)
    )
    if skip_speaker:
        reason = (
            "env" if os.environ.get("VOX_SKIP_SPEAKER_PIPELINE", "").lower() == "true"
            else "whisperx_already_has_speakers"
        )
        logger.info("Skip speaker_pipeline (reason=%s) — saves 60-180s", reason)
    else:
        try:
            # Phase 4: KHÔNG import build_speaker_voice_map ở đây nữa.
            # Voice map build chỉ làm 1 lần ở "Unified voice_map build" block
            # sau khi character labels stable. Xem CRIT-2 audit fix.
            from app.services.speaker_pipeline import (
                analyze_speakers as run_speaker_pipeline,
            )
            import threading, queue as _queue
            logger.info("Running speaker_pipeline (Phase 3-11)...")

            # Watchdog 4 phút cho speaker pipeline — tránh treo vô hạn nếu
            # bất kỳ phase nào (gender librosa, overlap pyannote, ...) hang.
            SP_TIMEOUT = 240
            sp_q: _queue.Queue = _queue.Queue()
            def _sp_run():
                try:
                    r = run_speaker_pipeline(
                        str(vocals_path) if vocals_path.exists() else audio_path,
                        embedding_audio_path=audio_path,
                        language=src_lang_norm,
                        min_speakers=1,
                        max_speakers=max(6, voice_count_meta),
                    )
                    sp_q.put(("ok", r))
                except Exception as ex:
                    sp_q.put(("err", ex))
            t_sp = threading.Thread(target=_sp_run, daemon=True)
            t_sp.start()
            try:
                kind, value = sp_q.get(timeout=SP_TIMEOUT)
            except _queue.Empty:
                raise TimeoutError(
                    f"speaker_pipeline treo >{SP_TIMEOUT}s — abort, "
                    f"segments KHÔNG có speaker info (fallback)",
                )
            if kind == "err":
                raise value
            sp_result = value
            # Pipeline mới có speaker_genders (F0 heuristic) — populate vào
            # speaker_genders dict để Gemini prompt + voice_map dùng.
            speaker_genders = dict(getattr(sp_result, "speaker_genders", {}) or {})
            # Map mỗi Whisper segment → speaker_id qua time overlap với
            # diarization sentences từ pipeline mới
            for seg in merged:
                seg_start = seg["start"]
                seg_end = seg["end"]
                best_spk = None
                best_overlap = 0.0
                for sent in sp_result.sentences:
                    ov = max(0.0, min(seg_end, sent.end) - max(seg_start, sent.start))
                    if ov > best_overlap and sent.speaker_id:
                        best_overlap = ov
                        best_spk = sent.speaker_id
                seg["speaker"] = best_spk
                seg["audio_speaker"] = best_spk  # preserve cho multi-modal fusion
                seg["audio_speaker_gender"] = speaker_genders.get(best_spk) if best_spk else None
                seg["speaker_gender"] = speaker_genders.get(best_spk) if best_spk else None

            # Phase 4 refactor (fix CRIT-2): KHÔNG build voice_map ở đây.
            # Voice map ĐƯỢC BUILD 1 LẦN DUY NHẤT sau khi character labels
            # determined (fusion CHAR_XX nếu face ran, fallback SPEAKER_XX
            # nếu chỉ pyannote). Xem block "Unified voice_map build" cuối.
            gender_confidences = (sp_result.stats or {}).get("gender_confidences") or {}

            # Reload meta + persist analysis (in-memory project might be stale).
            # Lưu speaker_analysis + gender_confs ngay để partial state survive
            # nếu pipeline crash trước khi build voice_map.
            project_meta = _load_meta(project_id) or {}
            project_meta["speaker_analysis"] = sp_result.to_json()
            project_meta["speaker_gender_confs"] = gender_confidences
            _save_meta(project_meta)

            from collections import Counter as _Counter
            spk_dist = _Counter(s.get("speaker") for s in merged)
            logger.info(
                "Speaker pipeline: %d speakers %s | seg distribution: %s "
                "(voice_map deferred to unified build — Phase 4 fix CRIT-2)",
                len(sp_result.speakers), sp_result.speakers, dict(spk_dist),
            )
        except Exception as e:
            logger.warning("speaker_pipeline failed (%s) — segments without speaker info", e)
            logger.exception("speaker_pipeline full traceback:")

    # ── PHASE 1: FACE DETECTION SPEAKER MAPPING (HeyGen-style) ──
    # Override pyannote/whisperx speaker_id bằng face_id từ video — ground
    # truth chính xác hơn nhiều cho video có người nói rõ trên screen.
    # Skip nếu: voice_count=1 (không cần phân biệt), video file không có
    # (audio-only), hoặc env disable.
    video_path = _project_dir(project_id) / "original.mp4"
    skip_face_reason = None
    if os.environ.get("VOX_SKIP_FACE_SPEAKER", "").lower() == "true":
        skip_face_reason = "env VOX_SKIP_FACE_SPEAKER=true"
    elif voice_count_meta == 1:
        skip_face_reason = "voice_count=1 (single voice mode → không cần phân biệt speaker)"
    elif not video_path.exists():
        skip_face_reason = f"video file không tồn tại ({video_path.name})"
    skip_face = skip_face_reason is not None
    if skip_face:
        logger.info("Skip face_speaker_svc — reason: %s", skip_face_reason)
    if not skip_face:
        try:
            from app.services.face_speaker_svc import (
                detect_speakers_by_face, apply_face_speakers_to_segments,
            )
            logger.info("Running face_speaker_svc — video=%s, segments=%d",
                         video_path.name, len(merged))
            # Build temp seg list with index để face svc tham chiếu
            for i, m in enumerate(merged):
                m["index"] = i
            face_result = detect_speakers_by_face(
                str(video_path),
                merged,
                fps_sample=4.0,
                max_faces=max(6, voice_count_meta),
            )
            if face_result and face_result.face_count > 0:
                # KHÔNG override pyannote speaker — chỉ set face_id riêng.
                # Multimodal fusion (dưới) sẽ decide canonical per segment.
                n_updated = apply_face_speakers_to_segments(
                    merged, face_result,
                    min_confidence=0.6,
                    override_audio=False,  # ← giữ audio_speaker pyannote
                )
                logger.info(
                    "face_speaker: %d/%d segments tagged face_id (KHÔNG override audio), "
                    "%d face detected · stats=%s",
                    n_updated, len(merged), face_result.face_count,
                    face_result.stats,
                )
                try:
                    # ── MULTIMODAL FUSION (Phase 3 audit fix CRIT-1): ──
                    # AUDIO-FIRST decision tree — audio chắc (>= AUDIO_STRONG)
                    # → face KHÔNG được override. Face chỉ thắng khi audio yếu
                    # và face active_speaker (MAR variance) đủ mạnh.
                    from app.services.multimodal_speaker_svc import fuse_speakers
                    # ── Phase 6 FIX REGRESSION (audit fix REG-1): ──
                    # Trước Phase 6: audio_confs = dict(gender_confidences) —
                    # SAI semantic (gender confidence ≠ speaker labelling confidence).
                    # Sau Phase 6: derive từ embedding quality MEAN per speaker
                    # (đo trực tiếp độ "clean" của audio mà pyannote dùng label).
                    # Fallback 0.5 khi không có embeddings cho speaker.
                    audio_confs_for_fusion: dict[str, float] = {}
                    sp_embeddings = list(getattr(sp_result, "embeddings", []) or [])
                    if sp_embeddings:
                        from collections import defaultdict
                        _qual_acc: dict[str, list[float]] = defaultdict(list)
                        for _emb in sp_embeddings:
                            _spk = getattr(_emb, "speaker_id", None)
                            _q = float(getattr(_emb, "quality", 0.0))
                            if _spk:
                                _qual_acc[_spk].append(_q)
                        audio_confs_for_fusion = {
                            spk: float(sum(qs) / len(qs)) if qs else 0.5
                            for spk, qs in _qual_acc.items()
                        }
                        logger.info(
                            "audio_speaker_confidences (Phase 6 proper, "
                            "embedding-quality-derived): %s",
                            {k: round(v, 3) for k, v in audio_confs_for_fusion.items()},
                        )
                    else:
                        logger.info(
                            "audio_speaker_confidences: no embeddings exposed "
                            "from sp_result → fuse_speakers default 0.5/speaker",
                        )
                    fusion = fuse_speakers(
                        segments=merged,
                        face_genders=face_result.face_genders,
                        face_gender_confs=face_result.face_gender_confs,
                        audio_speaker_genders=speaker_genders,
                        audio_speaker_confidences=audio_confs_for_fusion,
                        # Thresholds dùng default từ config (ACTIVE_SPEAKER_STRONG=0.80,
                        # AUDIO_STRONG=0.85, OWNERSHIP_KEEP=0.70).
                    )
                    # Phase 7b Option B: fuse_speakers mutates merged → seg["speaker"]
                    # = RAW winner (SPEAKER_XX hoặc FACE_XX), seg["fusion_reason"],
                    # seg["ownership_confidence"]. KHÔNG còn synthetic CHAR_XX.
                    # KHÔNG set seg["speaker_gender"] tại đây — gender_detection_service
                    # sẽ ghi CharacterProfile.gender post-registry.

                    # speaker_genders đã chứa raw SPEAKER_XX genders từ pyannote;
                    # fusion.char_genders giờ là raw_id → gender, merge thêm
                    # FACE_XX entries (chưa có trong speaker_genders).
                    speaker_genders.update(fusion.char_genders)

                    # speaker_gender_confs cho cross-validate: gộp FACE_XX confs
                    # từ face_result. (Audio raw đã có ở sp_gender_confs dict bên dưới.)
                    face_raw_gender_confs: dict[str, float] = {
                        f"FACE_{k:02d}": v
                        for k, v in face_result.face_gender_confs.items()
                    }
                    existing_confs = project.get("speaker_gender_confs") or {}
                    existing_confs.update(face_raw_gender_confs)
                    project["speaker_gender_confs"] = existing_confs

                    # Persist stats vào IN-MEMORY project (end-of-function save once)
                    face_genders_str = {
                        f"FACE_{k:02d}": v
                        for k, v in face_result.face_genders.items()
                    }
                    face_gender_confs_str = dict(face_raw_gender_confs)
                    project["face_speaker_stats"] = face_result.stats
                    project["face_speaker_genders"] = face_genders_str
                    project["face_speaker_gender_confs"] = face_gender_confs_str
                    project["multimodal_fusion_stats"] = fusion.stats
                    project["multimodal_char_genders"] = fusion.char_genders  # raw IDs

                    # Phase 7b MAJ-6 fix: voice_map KHÔNG còn build ở đây.
                    # Build duy nhất sau character_registry + gender_detection →
                    # nguồn gender là CharacterProfile.gender (per CHAR_XXX).
                    # Xem block "PHASE 7b UNIFIED voice_map" cuối Phase 6/7.
                    fusion_ran = True
                    logger.info(
                        "Multimodal fusion (Phase 7b Option B raw IDs): "
                        "%d raw winners · voice_map build deferred → "
                        "post-registry unified.",
                        len(fusion.char_genders),
                    )
                except Exception as e2:
                    logger.warning("Multimodal fusion failed: %s", e2)
                    logger.exception("fusion traceback:")
            else:
                logger.info(
                    "face_speaker: 0 face detected → giữ pyannote/whisperx speaker",
                )
        except ImportError as e:
            logger.info(
                "face_speaker disabled — mediapipe/opencv chưa cài: %s. "
                "pip install mediapipe opencv-python-headless để bật.",
                e,
            )
        except Exception as e:
            logger.warning("face_speaker failed (%s) — fallback pyannote speaker", e)
            logger.exception("face_speaker full traceback:")

    # ═══════════════════════════════════════════════════════════════════
    # PHASE 4: UNIFIED VOICE MAP BUILD (fix CRIT-2)
    # ═══════════════════════════════════════════════════════════════════
    # voice_map CHỈ ĐƯỢC BUILD 1 LẦN, SAU khi character labels stable:
    #   • Nếu fusion ran (face + audio đã merge → CHAR_XX): face hook
    #     đã build char_voice_map → skip ở đây.
    #   • Nếu face skipped/failed + pyannote OK: build voice_map dùng
    #     SPEAKER_XX (audio-only). Đây là fallback path.
    #   • Nếu cả pyannote + face fail: không có voice_map → TTS dùng defaults.
    #
    # Trước Phase 4: voice_map build 2 lần (1 sau pyannote, 1 sau fusion)
    # → race condition + overwrite. Phase 4 đảm bảo single build path.
    # Phase 7b MAJ-6 fix: voice_map block CŨ (build từ raw SPEAKER_XX +
    # gender_confidences gender F0) ĐÃ XOÁ. Voice_map BUILD DUY NHẤT
    # ở "PHASE 7b UNIFIED voice_map build" sau character_registry +
    # gender_detection_service — source gender là CharacterProfile.gender
    # (per CHAR_XXX, đã fuse audio + face + self-ref text).
    # Face-only path (no pyannote, no registry): vẫn fallback raw IDs ở block
    # unified — single build path đảm bảo không có race condition / overwrite.

    # ═══════════════════════════════════════════════════════════════════
    # PHASE 6: CHARACTER REGISTRY + SEGMENT OWNERSHIP
    # ═══════════════════════════════════════════════════════════════════
    # Build canonical character_registry (cluster raw SPEAKER_XX → CHAR_XXX
    # theo cosine sim + supporting evidences) → write character_registry.json.
    # Then validate per-segment ownership (opt-in cost guard).
    #
    # Skip nếu sp_result không có hoặc không có embeddings (face-only path):
    # character_registry yêu cầu speaker embeddings để cluster. Face-only
    # path đã có CHAR_XX từ fusion → caller dùng trực tiếp.
    if sp_result is not None and getattr(sp_result, "embeddings", None):
        try:
            from app.services.character_registry_service import (
                assign_character_ids_to_segments,
                build_character_registry,
                save_character_registry,
            )
            from app.services.segment_ownership_service import (
                build_character_embeddings,
                extract_speaker_embeddings_from_pipeline,
            )

            raw_speakers_for_reg = list(sp_result.speakers or [])
            speaker_embeddings_dict = extract_speaker_embeddings_from_pipeline(
                list(sp_result.embeddings),
            )
            # Build per-speaker segments dict from merged (use audio_speaker
            # field — preserved before fusion overwrote seg["speaker"]).
            speaker_segments_dict: dict[str, list[dict]] = {}
            for seg in merged:
                spk = seg.get("audio_speaker") or seg.get("speaker")
                if spk and not str(spk).startswith("CHAR_"):
                    speaker_segments_dict.setdefault(spk, []).append({
                        "start": float(seg.get("start", 0.0)),
                        "end": float(seg.get("end", 0.0)),
                    })

            # speaker_genders / confs: derive from speaker_genders + audio_confs_for_fusion
            # (audio_confs_for_fusion may not exist in this scope — recompute).
            sp_gender_confs_dict: dict[str, float] = {}
            for spk in raw_speakers_for_reg:
                # Pull from stats.gender_confidences (pipeline F0 + spectral)
                stats_confs = (sp_result.stats or {}).get("gender_confidences") or {}
                sp_gender_confs_dict[spk] = float(stats_confs.get(spk, 0.0))

            registry = build_character_registry(
                project_id=project_id,
                raw_speakers=raw_speakers_for_reg,
                speaker_embeddings=speaker_embeddings_dict,
                speaker_segments=speaker_segments_dict,
                speaker_genders={
                    spk: speaker_genders.get(spk, "unknown")
                    for spk in raw_speakers_for_reg
                },
                speaker_gender_confs=sp_gender_confs_dict,
                # Phase 7a — wire face_track_to_speaker từ fusion cross-match.
                # Audio_to_face = {SPEAKER_XX: face_int_id} reverse → E1 evidence.
                # Nếu fusion không ran (face skipped) → empty dict → E1 sẽ 0.
                face_track_to_speaker={
                    face_int: audio_spk
                    for audio_spk, face_int
                    in (fusion.audio_to_face.items() if fusion_ran else {})
                } if fusion_ran else {},
            )

            # Persist character_registry.json vào project dir
            from pathlib import Path as _P
            reg_path = _project_dir(project_id) / "character_registry.json"
            save_character_registry(registry, reg_path)

            # Map raw SPEAKER_XX → CHAR_XXX trên merged. Note: nếu fusion đã
            # overwrite seg["speaker"] = CHAR_XX face-fused, ta dùng
            # seg["audio_speaker"] (pyannote raw) làm key cho registry assign.
            n_assigned = assign_character_ids_to_segments(
                merged, registry, raw_speaker_field="audio_speaker",
            )
            logger.info(
                "Phase 6 character_registry: %d chars · %d possible_merges · "
                "%d/%d segments tagged audio character_id",
                len(registry.characters), len(registry.possible_merges),
                n_assigned, len(merged),
            )

            # ── PHASE 7a: GENDER DETECTION PER-CHARACTER ──
            # Fuse audio gender (F0+formant) + face gender (insightface CNN, chỉ
            # khi face_track stable map với char) + self-ref text patterns.
            # Mutate CharacterProfile.gender + gender_confidence + review_required
            # in-place. Phase 8 (voice mapping) sẽ dùng các field này.
            try:
                from app.services.gender_detection_service import (
                    detect_all_character_genders,
                )
                # face_track_to_speaker đã wire ở build_character_registry call
                # → tận dụng lại cho gender fusion (E1 reference).
                _face_track_to_speaker_for_gender = (
                    {
                        face_int: audio_spk
                        for audio_spk, face_int in fusion.audio_to_face.items()
                    }
                    if fusion_ran and fusion is not None
                    else {}
                )
                _face_genders_for_gender = (
                    face_result.face_genders if face_result is not None else {}
                )
                _face_gender_confs_for_gender = (
                    face_result.face_gender_confs if face_result is not None else {}
                )
                # Build character_texts: gom original_text per CHAR_XXX cho
                # self-ref pattern match. Dùng merged (đã có character_id).
                _char_texts: dict[str, list[str]] = {}
                for seg in merged:
                    cid = seg.get("character_id")
                    txt = seg.get("text") or seg.get("original_text")
                    if cid and txt:
                        _char_texts.setdefault(cid, []).append(txt)

                gender_decisions, gender_conflicts = detect_all_character_genders(
                    registry=registry,
                    audio_speaker_genders={
                        spk: speaker_genders.get(spk, "unknown")
                        for spk in raw_speakers_for_reg
                    },
                    audio_speaker_gender_confs=sp_gender_confs_dict,
                    face_track_to_speaker=_face_track_to_speaker_for_gender,
                    face_genders=_face_genders_for_gender,
                    face_gender_confs=_face_gender_confs_for_gender,
                    character_texts=_char_texts,
                    apply_to_profiles=True,  # mutate profiles in-place
                )
                project["gender_conflicts"] = [
                    gc.model_dump(mode="json") for gc in gender_conflicts
                ]
                logger.info(
                    "Phase 7a gender_detection: %d chars decided · %d conflicts "
                    "(audio vs face disagree)",
                    len(gender_decisions), len(gender_conflicts),
                )
            except Exception as e:
                logger.warning("Phase 7a gender_detection fail: %s", e)
                logger.exception("gender_detection traceback:")

            # ── Persist registry summary vào project meta (Phase 11 qa_report) ──
            # Đặt SAU gender_detection để summary có gender mới (per-character).
            project["character_registry_summary"] = {
                "characters": [
                    {
                        "character_id": c.character_id,
                        "source_speakers": c.source_speakers,
                        "gender": c.gender,
                        "gender_confidence": c.gender_confidence,
                        "line_count": c.line_count,
                        "merge_confidence": c.merge_confidence,
                        "review_required": c.review_required,
                    }
                    for c in registry.characters.values()
                ],
                "possible_merges": [pm.model_dump() for pm in registry.possible_merges],
            }

            # ── PHASE 6 SEGMENT OWNERSHIP (opt-in cost guard) ──
            # Per-segment cosine sim validation: requires extracting 1 embedding
            # per segment (pyannote/embedding forward pass ~ 50-150ms each).
            # 200 segments × 100ms = 20s GPU cost. Default OFF — opt-in qua env
            # VOX_PHASE6_SEGMENT_OWNERSHIP=true. Service code đã sẵn sàng;
            # bật khi user muốn QA report đầy đủ rule 1-5.
            # Phase 11 auto-enable: default ON cho qa_report đầy đủ.
            # User có thể disable explicit qua VOX_PHASE6_SEGMENT_OWNERSHIP=false
            # nếu cost (≈20s/200 segs) là vấn đề. Trade-off ngược với Phase 6 plan.
            _env_seg_own = os.environ.get("VOX_PHASE6_SEGMENT_OWNERSHIP", "").lower()
            if _env_seg_own == "false":
                run_seg_ownership = False
            else:
                run_seg_ownership = True  # default ON Phase 11
            if run_seg_ownership and speaker_embeddings_dict:
                try:
                    from app.services.segment_ownership_service import (
                        compute_segment_embeddings,
                        validate_segments_batch,
                    )
                    char_embs_for_validate = build_character_embeddings(
                        registry, speaker_embeddings_dict,
                    )
                    seg_embs_dict = compute_segment_embeddings(
                        audio_path=str(vocals_path) if vocals_path.exists() else audio_path,
                        segments=merged,
                    )
                    ownership_infos, ownership_warnings = validate_segments_batch(
                        segments=merged,
                        character_embeddings=char_embs_for_validate,
                        segment_embeddings=seg_embs_dict,
                        registry=registry,
                        character_id_field="character_id",
                    )
                    project["ownership_warnings"] = [
                        w.model_dump() for w in ownership_warnings
                    ]
                    logger.info(
                        "Phase 6 segment_ownership: %d infos · %d warnings",
                        len(ownership_infos), len(ownership_warnings),
                    )
                except Exception as e_so:
                    logger.warning("Phase 6 segment_ownership fail: %s", e_so)
                    logger.exception("segment_ownership traceback:")
            else:
                logger.info(
                    "Phase 6 segment_ownership: skip (env "
                    "VOX_PHASE6_SEGMENT_OWNERSHIP=%s, embeddings=%s) "
                    "— set true để bật full validation",
                    os.environ.get("VOX_PHASE6_SEGMENT_OWNERSHIP", "false"),
                    bool(speaker_embeddings_dict),
                )
        except Exception as e:
            logger.warning("Phase 6 character_registry build fail: %s", e)
            logger.exception("character_registry traceback:")
            registry = None  # mark cho voice_map block dùng fallback path
    else:
        logger.info(
            "Phase 6 character_registry: skip (sp_result=%s, embeddings=%s). "
            "Face-only path → voice_map sẽ build keyed by raw FACE_XX/SPEAKER_XX.",
            sp_result is not None,
            bool(getattr(sp_result, "embeddings", None)) if sp_result else False,
        )
        registry = None

    # ═══════════════════════════════════════════════════════════════════
    # PHASE 8 UNIFIED voice_map BUILD (Phase 7b MAJ-6 + Phase 8 character-aware)
    # ═══════════════════════════════════════════════════════════════════
    # Voice_map keyed bằng character_id (CHAR_XXX) khi registry available,
    # else raw IDs (SPEAKER_XX / FACE_XX) làm fallback.
    # Phase 8: registry path dùng build_character_voice_map (3 modes explicit:
    # 1_voice / 2_voice / multi_voice), tie-breaker deterministic. Source gender
    # LUÔN từ CharacterProfile.gender (đã fuse audio+face+text).
    # Phase 8 mutates CharacterProfile.voice_profile_id in-place.
    # Phase 7b legacy build_speaker_voice_map giữ cho face-only / audio-only path.
    try:
        from app.services.speaker_pipeline import build_speaker_voice_map
        from app.services.speaker_pipeline.voice_mapping import (
            VoiceSlot, build_character_voice_map,
        )
        voice_slots_final = project.get("voice_slots") or []
        voice_count_final = int(project.get("voice_count") or 1)

        if registry is not None and registry.characters:
            # ── Phase 8 CHARACTER-AWARE path ──
            # Build VoiceSlot list từ project["voice_slots"] (list[str] legacy)
            # với gender hint convention: slot 0=male, slot 1=female, slot 2+=any.
            # User config (UI) sẽ gửi gender explicit ở Phase 9+ (UI panel).
            voice_slot_objs: list[VoiceSlot] = []
            for i, vid in enumerate(voice_slots_final):
                if not vid:
                    continue
                if i == 0:
                    g = "male"
                elif i == 1:
                    g = "female"
                else:
                    g = "any"
                voice_slot_objs.append(VoiceSlot(voice_id=vid, gender=g))

            # Phase 9 quick win (Phase 8 Risk 2 fix): auto-downgrade mode
            # if effective slot count < user-requested voice_count.
            # E.g. user chọn voice_count=3 nhưng chỉ chỉnh được 2 slot non-empty
            # → mode multi sẽ fail (chỉ 2 slot). Downgrade về 2_voice.
            effective_voice_count = sum(
                1 for s in voice_slot_objs if s.voice_id
            )
            mode_voice_count = min(voice_count_final, effective_voice_count)
            if effective_voice_count < voice_count_final:
                logger.warning(
                    "Phase 8 Risk 2 auto-downgrade: voice_count=%d nhưng chỉ "
                    "%d slot non-empty → mode = %d_voice",
                    voice_count_final, effective_voice_count, mode_voice_count,
                )

            # Phase 12 fix (Phase 8 UX bug): voice_count >= 2 → multi_voice mode.
            # 2_voice gender-first không phù hợp UX khi user pick N slot khác nhau —
            # nếu chars unknown gender, mode 2_voice fallback đẩy cả 2 vào cùng 1
            # slot. Multi_voice reserve slot riêng cho top N chars → đảm bảo
            # N voices distinct.
            if mode_voice_count <= 1:
                vm_mode = "1_voice"
            else:
                vm_mode = "multi_voice"

            # Phase 12 fix (UX bug): chỉ pass fallback_vid khi 1_voice mode.
            # Trong multi_voice/2_voice, UI vẫn auto-set project["voice_id"] =
            # 1 trong các slots → _fallback_resolve rule #1 (fallback wins
            # tuyệt đối) → COLLAPSE tất cả chars unknown gender vào fallback
            # voice. Bug user complain "1 giọng cho tất cả nhân vật".
            # Multi-voice intent: dùng N voice slots distinct → KHÔNG cần
            # fallback override Phase 12 slot reservation logic.
            if vm_mode == "1_voice":
                fallback_vid = project.get("voice_id") or None
            else:
                fallback_vid = None  # multi/2-voice: let Phase 12 slot logic decide

            if voice_slot_objs:
                voice_map_final, vm_warnings = build_character_voice_map(
                    characters=registry.characters,
                    voice_slots=voice_slot_objs,
                    mode=vm_mode,  # type: ignore[arg-type]
                    fallback_voice_id=fallback_vid,
                    apply_to_profiles=True,  # mutate CharacterProfile.voice_profile_id
                )
                project["speaker_voice_map"] = voice_map_final
                project["voice_map_keyspace"] = "character_id"
                project["voice_map_warnings"] = [
                    w.model_dump() for w in vm_warnings
                ]
                # Phase 12 fix: re-build character_registry_summary với voice_profile_id
                # đã mutate xong (Phase 7a save summary TRƯỚC Phase 8 → summary cũ
                # thiếu voice_profile_id). qa_report cần data này.
                project["character_registry_summary"] = {
                    "characters": [
                        {
                            "character_id": c.character_id,
                            "source_speakers": c.source_speakers,
                            "gender": c.gender,
                            "gender_confidence": c.gender_confidence,
                            "voice_profile_id": c.voice_profile_id,
                            "line_count": c.line_count,
                            "merge_confidence": c.merge_confidence,
                            "review_required": c.review_required,
                        }
                        for c in registry.characters.values()
                    ],
                    "possible_merges": [
                        pm.model_dump() for pm in registry.possible_merges
                    ],
                }
                logger.info(
                    "Phase 8 character-aware voice_map (mode=%s, CHAR_XXX, "
                    "%d slots, %d warnings): %s",
                    vm_mode, len(voice_slot_objs), len(vm_warnings),
                    voice_map_final,
                )

                # Phase 12 invariant — enforce: gender_conf < GENDER_MEDIUM → unknown.
                # Gọi NGAY sau summary persist. Catch chars có gender label
                # với conf thấp (Phase 7a confidence < 0.60) → reset về unknown
                # trước khi voice_map / TTS dùng làm signal.
                try:
                    from app.services.voice_routing_svc import enforce_gender_invariant
                    _gender_fixes = enforce_gender_invariant(project)
                    if _gender_fixes:
                        logger.warning(
                            "Phase 12 gender_invariant (transcribe end): "
                            "reset %d chars: %s",
                            len(_gender_fixes),
                            [(f["character_id"], f["old_gender"], f["old_confidence"])
                             for f in _gender_fixes],
                        )
                except Exception as e:
                    logger.warning(
                        "Phase 12 gender_invariant (transcribe) fail: %s", e,
                    )
            else:
                logger.warning(
                    "Phase 8 voice_map: registry exists but voice_slots rỗng → "
                    "no map built. TTS sẽ dùng default voice.",
                )
        elif fusion_ran and fusion is not None:
            # Face-only path (no pyannote registry). Raw IDs từ fusion.char_genders.
            raw_speakers_for_map = sorted(fusion.char_genders.keys())
            voice_map_final = build_speaker_voice_map(
                speakers=raw_speakers_for_map,
                voice_slots=voice_slots_final,
                user_overrides={},
                speaker_genders=fusion.char_genders,  # raw_id → gender
                gender_confidences={
                    rid: 0.6 for rid in raw_speakers_for_map  # face CNN default
                },
            )
            project["speaker_voice_map"] = voice_map_final
            project["voice_map_keyspace"] = "raw_face_speaker"
            logger.info(
                "Phase 7b unified voice_map (face-only path, raw FACE/SPEAKER): %s",
                voice_map_final,
            )
        elif sp_result is not None and getattr(sp_result, "speakers", None):
            # Audio-only path (no fusion, no registry). Raw SPEAKER_XX.
            voice_map_final = build_speaker_voice_map(
                speakers=list(sp_result.speakers),
                voice_slots=voice_slots_final,
                user_overrides={},
                speaker_genders=speaker_genders,
                gender_confidences=(sp_result.stats or {}).get(
                    "gender_confidences", {},
                ),
            )
            project["speaker_voice_map"] = voice_map_final
            project["voice_map_keyspace"] = "raw_speaker"
            logger.info(
                "Phase 7b unified voice_map (audio-only path, raw SPEAKER_XX): %s",
                voice_map_final,
            )
        else:
            logger.info(
                "Phase 7b unified voice_map: SKIP (no registry, no fusion, "
                "no pyannote). TTS sẽ dùng default voice.",
            )
    except Exception as e:
        logger.warning("Phase 7b unified voice_map build fail: %s", e)
        logger.exception("voice_map traceback:")

    segments = []
    for i, seg in enumerate(merged):
        # Phase 7b: seg["speaker_gender"] source priority:
        #   1. CharacterProfile.gender via character_id (registry path)
        #   2. speaker_genders[raw_id] (fusion/audio-only fallback)
        _cid = seg.get("character_id")
        _seg_gender = None
        if _cid and registry is not None and _cid in registry.characters:
            _seg_gender = registry.characters[_cid].gender
            if _seg_gender == "unknown":
                _seg_gender = None
        if _seg_gender is None:
            _raw = seg.get("speaker")
            _seg_gender = speaker_genders.get(_raw) if _raw else None
            if _seg_gender == "unknown":
                _seg_gender = None

        word_items = []
        for w in seg.get("words") or []:
            if w.get("start") is None or w.get("end") is None:
                continue
            word_items.append({
                "word": w.get("word") or w.get("text") or "",
                "start": round(float(w.get("start") or 0.0), 3),
                "end": round(float(w.get("end") or 0.0), 3),
                "score": float(w.get("score") or w.get("probability") or 0.0),
            })

        segments.append({
            "id": uuid.uuid4().hex[:8],
            "index": i,
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "original_text": seg["text"],
            "translated_text": "",
            "speech_text": "",
            "emotion": "neutral",
            "voice_id": None,
            "speaker": seg.get("speaker"),
            "speaker_gender": _seg_gender,
            "words": word_items,
            # Face detection fields — set bởi face_speaker_svc hook ở trên
            "face_id": seg.get("face_id"),
            "face_confidence": seg.get("face_confidence"),
            # Phase 6 — character_id (canonical CHAR_XXX từ character_registry) +
            # ownership tracking. Có thể None khi character_registry không build
            # được (face-only path) hoặc segment không match speaker nào.
            "character_id": seg.get("character_id"),
            "ownership_confidence": seg.get("ownership_confidence"),
            "ownership_decision_reason": seg.get("ownership_decision_reason"),
            "ownership_tier": seg.get("ownership_tier"),
            "volume": 1.0,
            "fade_in": 0.0,
            "fade_out": 0.0,
            "status": "pending",
        })

    project["segments"] = segments
    project["source_language"] = result.get("language")
    project["speaker_genders"] = speaker_genders
    if gender_confidences:
        existing_confs = project.get("speaker_gender_confs") or {}
        existing_confs.update(gender_confidences)
        project["speaker_gender_confs"] = existing_confs
    project["status"] = "editing"
    _save_meta(project)
    logger.info("Transcribed %d segments for project %s", len(segments), project_id)
    return project


# ── Translate ──────────────────────────────────────

def _build_registry_block_for_translate(project: dict) -> str | None:
    """Phase 11 wrapper — delegate to translation_character_helper.
    Real logic ở `translation_character_helper.build_registry_block_for_translate`
    để test env nhẹ (dubbing_svc cần ffmpeg-python, helper module thì không).
    """
    try:
        from app.services.translation_character_helper import (
            build_registry_block_for_translate as _impl,
        )
        return _impl(project)
    except Exception as e:
        logger.warning("_build_registry_block_for_translate fail: %s", e)
        return None


def translate_project(
    project_id: str,
    use_llm: bool = False,
    engine: str = "google",
    api_key: str | None = None,
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    enable_visual_context: bool = False,
    visual_engine: str | None = None,
    visual_model: str | None = None,
    visual_api_key: str | None = None,
) -> dict:
    """Auto-translate all segments to target language.

    Engines text:
      · google_free / google_cloud / deepl / gemini / openai / claude / qwen

    Visual context (optional, BYOK, +cost):
      · enable_visual_context=True → sample keyframes + VLM call trước translate
      · visual_engine: gemini/openai/claude (cùng/khác text engine)
      · visual_model: optional override (default = bản rẻ trong VISION_MODELS)
      · visual_api_key: BYOK cho VLM (có thể trùng api_key text)
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError(f"Project '{project_id}' not found")

    target_lang = project["target_language"]
    source_lang = project.get("source_language") or "auto"
    try:
        from app.services import cloud_translate_svc as _cloud_translate_for_cache
        _cloud_translate_for_cache.clear_llm_genders()
    except Exception:
        pass

    # Normalize engine alias (legacy "google" == "google_free")
    eng = (engine or "google_free").lower()
    if eng == "google":
        eng = "google_free"

    # Fallback: nếu caller không pass, đọc topic_hint + glossary từ project
    if topic_hint is None:
        topic_hint = project.get("topic_hint") or None
    if glossary is None:
        from app.services import glossary_svc
        glossary = glossary_svc.parse_glossary(project.get("glossary") or "")

    # Phase 12 — Prepend character_registry_block vào topic_hint cho Path B
    # (BYOK cloud_translate_svc). Cùng pattern wire như Path A đã có.
    # Đảm bảo Gemini/OpenAI/Claude/Qwen LLM thấy CHAR_XXX + vocative addressee
    # rules + locked character preservation.
    _reg_block_for_byok = _build_registry_block_for_translate(project)
    if _reg_block_for_byok:
        if topic_hint:
            topic_hint = _reg_block_for_byok + "\n\n" + topic_hint
        else:
            topic_hint = _reg_block_for_byok
        logger.info(
            "Phase 12 BYOK: character_registry_block prepended (len=%d chars)",
            len(_reg_block_for_byok),
        )

    # Auto-detect genre nếu chưa có (user-explicit luôn ưu tiên).
    # Detect 1 lần từ tổng original_text rồi persist vào meta để LLM prompt
    # các batch sau dùng nhất quán + UI hiển thị genre cho user verify.
    if not project.get("film_genre") or project.get("film_genre") == "auto":
        try:
            from app.services.llm import detect_genre
            full_text = " ".join(
                (s.get("original_text") or "") for s in project.get("segments", [])
            )
            detected = detect_genre(full_text)
            if detected and detected != "generic":
                project["film_genre"] = detected
                _save_meta(project)
                logger.info("Auto-detected genre: %s", detected)
        except Exception as e:
            logger.warning("Genre detection failed: %s — fallback generic", e)

    # ── Pass-(-1): Visual Context Analysis (optional, BYOK) ──
    # Sample 8 keyframe → VLM call → JSON (genre/register/characters/relationships)
    # → feed Pass-0 audio analyze làm ground truth → giảm đoán mò pronoun/gender.
    # Fallback engine: nếu user bật "nâng cao" nhưng không pick riêng → reuse
    # text translate engine + key. User đã chấp nhận trả phí khi bật toggle →
    # mặc định dùng model PRO/cao cấp (không rẻ) để xứng đáng tiền.
    if enable_visual_context and not visual_engine and eng in ("gemini", "openai", "claude"):
        visual_engine = eng
        if not visual_api_key:
            visual_api_key = api_key
    if enable_visual_context and visual_engine and not visual_model:
        # Auto-pick PRO model khi user bật nâng cao mà không chỉ định model.
        # "Nâng cao" = chất lượng cao → đáng dùng pro thay vì flash/mini/haiku.
        pro_model_for = {
            "gemini": "gemini-2.5-pro",
            "openai": "gpt-4o",
            "claude": "claude-sonnet-4-6",
        }
        visual_model = pro_model_for.get(visual_engine)
        if visual_model:
            logger.info("Visual context: auto-pick PRO model %s cho %s", visual_model, visual_engine)
    if enable_visual_context and visual_engine and visual_api_key:
        if not project.get("visual_context"):
            video_path = _project_dir(project_id) / "original.mp4"
            if video_path.exists():
                try:
                    from app.services import visual_context_svc
                    logger.info("Visual context: analyzing keyframes via %s/%s…",
                                 visual_engine, visual_model or "(default)")
                    vctx = visual_context_svc.analyze_video(
                        video_path=video_path,
                        engine=visual_engine,
                        api_key=visual_api_key,
                        model=visual_model,
                        source_lang=source_lang,
                    )
                    if vctx:
                        project["visual_context"] = vctx
                        _save_meta(project)
                        logger.info("Visual context ok: %d characters, genre=%r",
                                     len(vctx.get("characters", [])),
                                     vctx.get("genre", ""))
                    else:
                        logger.warning("Visual context returned empty — fallback no anchor")
                except Exception as e:
                    logger.warning("Visual context fail: %s — fallback no anchor", e)
            else:
                logger.warning("Visual context: video %s không tồn tại — skip", video_path)
        else:
            logger.info("Visual context: dùng cached từ trước")

    # Phase 12 — Gemini env path REMOVED. BYOK only (user paste API key UI).
    # User spec: "BYOK chỉ dùng cái này bỏ hắn cái kia, nếu không có key thì
    # không cho chạy, báo phải nhập key."
    if eng == "gemini" and not api_key:
        raise ValueError(
            "❌ Gemini cần API key. Vào UI Settings → AI & API keys → "
            "paste Gemini API key (lấy free tại https://aistudio.google.com/apikey)."
        )

    # ── Path B: Qwen local ──
    if eng == "qwen":
        logger.info("Translating %d segments with Qwen (local LLM)…",
                    len(project["segments"]))
        results = llm_translate_svc.translate_segments(
            project["segments"], target_lang, source_lang,
            topic_hint=topic_hint, glossary=glossary,
            speaker_genders=project.get("speaker_genders") or {},
            film_genre=project.get("film_genre"),
        )
        for seg, result in zip(project["segments"], results):
            if result.get("translated_text"):
                seg["translated_text"] = result["translated_text"]
                seg["speech_text"] = result["speech_text"] or result["translated_text"]
                seg["emotion"] = result.get("emotion", "neutral")
        _apply_translation_post_fixes(project)
        method = "Qwen"
        _save_meta(project)
        logger.info("Translated %d segs → %s (%s)",
                    len(project["segments"]), target_lang, method)
        return project

    # ── Path C: BYOK / Google Free qua cloud_translate_svc ──
    # 1 endpoint chung: Google Free / Google Cloud / DeepL / Gemini (BYOK) /
    # OpenAI / Claude. Validate key trước khi đổ batch để fail nhanh.
    needs_key = eng in ("google_cloud", "deepl", "gemini", "openai", "claude")
    if needs_key and not api_key:
        raise ValueError(
            f"Engine '{eng}' yêu cầu API key. Vui lòng thêm key trong "
            f"Cài đặt → AI & API keys, hoặc đổi sang Google miễn phí."
        )

    from app.services import cloud_translate_svc
    texts = [seg["original_text"] for seg in project["segments"]]
    logger.info("Translating %d segs via %s…", len(texts), eng)

    # Engine fallback chain — KHI primary fail (quota/network) tự thử engine
    # khác để pipeline không chết hoàn toàn. Nguyên tắc thiết kế:
    #
    # 1) Nếu user chọn LLM (gemini/openai/claude) → KHÔNG silent fallback sang
    #    google_free. Google Translate ra output kiểu "Bạn/Tôi" robot —
    #    biến quality cliff thành ảo giác user nghĩ LLM đang work.
    # 2) Chỉ add vào chain engine có ĐÚNG key (không guess từ api_key chéo).
    # 3) Auth error → đã abort ngay ở FatalAuthError check bên dưới.
    eng_is_llm = eng in ("gemini", "openai", "claude")
    fallback_chain = [eng]
    if not eng_is_llm:
        # Non-LLM (google_free / google_cloud / deepl) → có thể fallback chéo
        for fallback_eng in ("google_cloud", "google_free"):
            if fallback_eng != eng and fallback_eng not in fallback_chain:
                if fallback_eng == "google_free":
                    fallback_chain.append(fallback_eng)
    # LLM engine → KHÔNG add google_free fallback. User chọn LLM thì phải
    # ra LLM quality hoặc thấy error rõ để fix key/quota.

    # Build segments_meta đầy đủ + speaker_genders cho mọi LLM engine
    # để OpenAI/Claude có rich prompt giống Gemini (genre + pronoun + budget).
    segments_meta = list(project.get("segments") or [])
    speaker_genders_meta = project.get("speaker_genders") or {}
    film_genre_meta = project.get("film_genre")

    # Task 1 v2: entity scan toàn file → registry inject vào prompt
    # để LLM giữ name nhất quán + không drift.
    entity_registry = build_entity_registry(project)
    if entity_registry["proper_nouns"]:
        logger.info(
            "Entity scan: %d proper nouns + %d vocatives (top: %s)",
            len(entity_registry["proper_nouns"]),
            len(entity_registry["vocatives"]),
            [n for n, _ in entity_registry["proper_nouns"][:5]],
        )
        # Persist vào project meta → Pass-0/1/2 đều đọc được
        project["entity_registry"] = entity_registry

    translated: list[str] = []
    primary_error: Exception | None = None  # error của engine USER CHỌN
    last_error: Exception | None = None     # error của attempt gần nhất
    used_engine = eng

    # Phase 12 Fix A — skip Pass-0 speaker_relationships analyze khi đã có
    # character_registry (source of truth). character_registry_block đã được
    # prepend vào topic_hint ở block trên → LLM có đầy đủ char info từ registry.
    # Không cần Pass-0 redundant → giảm prompt confusion, dịch quality lên.
    from app.services.voice_routing_svc import should_skip_pass0_analysis
    _skip_pass0 = should_skip_pass0_analysis(project)
    if _skip_pass0:
        logger.info(
            "Phase 12 Fix A: using character_registry_only_prompt=true, "
            "skip_legacy_speaker_relationships=true",
        )

    for idx, try_eng in enumerate(fallback_chain):
        try:
            translated = cloud_translate_svc.translate_texts(
                texts=texts, target=target_lang, source=source_lang,
                engine=try_eng, api_key=api_key if try_eng == eng else None,
                topic_hint=topic_hint, glossary=glossary,
                segments_meta=segments_meta,
                speaker_genders=speaker_genders_meta,
                film_genre=film_genre_meta,
                visual_context=project.get("visual_context") or None,
                skip_speaker_analysis=_skip_pass0,
            )
            # Check thực sự có output (không phải all empty)
            non_empty = sum(1 for t in translated if t and t.strip())
            if non_empty < max(1, len(texts) // 3):
                # < 1/3 segments có dịch — coi như fail, thử fallback
                raise ValueError(
                    f"Engine {try_eng} chỉ trả {non_empty}/{len(texts)} segments — fallback",
                )
            used_engine = try_eng
            if idx > 0:
                # Log primary_error (engine user chọn), không phải last_error
                # (có thể là error của engine intermediate khác)
                logger.warning(
                    "Translate fallback %s → %s thành công (primary [%s] fail: %s)",
                    eng, try_eng, eng, primary_error,
                )
            break
        except cloud_translate_svc.FatalAuthError as e:
            # 401/403/402 — KHÔNG fallback. User phải fix key trước.
            # Bypass cả engine fallback chain, fail NGAY với message rõ.
            logger.error("Engine %s FATAL auth error — abort fallback: %s",
                          try_eng, e)
            raise ValueError(
                f"❌ {try_eng}: {e}\n\n"
                f"Hãy kiểm tra API key trong Cài đặt và thử lại. "
                f"Pipeline KHÔNG tự đổi engine khác vì lỗi key cần user fix.",
            ) from e
        except Exception as e:
            last_error = e
            if idx == 0:
                primary_error = e  # save engine USER chọn's lỗi
            logger.warning("Engine %s failed: %s", try_eng, e)
            translated = []
            continue

    if not translated:
        # Khi user chọn LLM mà tất cả fallback (chỉ chính nó) fail → message
        # tập trung vào primary_error (= lỗi engine user chọn), không nhồi
        # lỗi gemini "thiếu key" gây hiểu nhầm.
        err_msg = primary_error or last_error
        if eng_is_llm:
            raise ValueError(
                f"❌ {eng}: {err_msg}\n\n"
                f"Vào Cài đặt → AI & API keys kiểm tra key {eng} hoặc đổi sang engine khác.",
            )
        raise ValueError(
            f"Mọi engine dịch đều fail. Last error: {err_msg}. "
            f"Đã thử: {fallback_chain}",
        )
    if used_engine != eng:
        logger.info("Final engine = %s (yêu cầu ban đầu = %s)", used_engine, eng)

    # Tag character_name + age + gender vào mỗi segment để output JSON sạch
    # (theo format kịch bản: id/character/gender/age/text).
    #
    # Phase 9 migration (Phase 7b Risk 1 fix):
    # GENDER source = CharacterProfile via character_id (registry path),
    #   fallback chars_meta[raw_speaker] cho face-only (no registry).
    # NAME + AGE source = chars_meta (LLM Pass-0 analyze, keyed by raw speaker).
    # 2 namespace tồn tại song song có lý do — registry là phân loại
    # đáng tin (cosine clustering), chars_meta là content metadata (LLM
    # named entity extraction). Phase 11 sẽ unify khi UI panel cho user
    # edit character_name per CHAR_XXX trực tiếp.
    chars_meta = project.get("speaker_characters") or {}
    reg_summary = (project.get("character_registry_summary") or {}).get("characters") or []
    char_id_to_profile_meta = {c.get("character_id"): c for c in reg_summary}

    missing_indices: list[int] = []
    for idx, (seg, trans) in enumerate(zip(project["segments"], translated)):
        if trans and trans.strip():
            seg["translated_text"] = trans
            seg["speech_text"] = trans
        else:
            # Translation rỗng cho segment này → tránh mất sub + voice bằng
            # cách fallback về original_text. User sẽ thấy/nghe nguyên gốc cho
            # segment đó (Edge TTS thường vẫn đọc được nhiều ngôn ngữ).
            orig = (seg.get("original_text") or "").strip()
            if orig:
                seg["translated_text"] = orig
                seg["speech_text"] = orig
                missing_indices.append(idx)

        # Phase 9 — registry-first GENDER lookup
        cid = seg.get("character_id")
        char_profile = char_id_to_profile_meta.get(cid) if cid else None
        if char_profile and char_profile.get("gender") in ("male", "female"):
            seg["speaker_gender"] = char_profile["gender"]

        # NAME + AGE via chars_meta (raw speaker keyed — LLM analyze pass)
        spk = seg.get("speaker")
        if spk and spk in chars_meta:
            ci = chars_meta[spk]
            seg["character_name"] = ci.get("character_name", "")
            seg["age"] = ci.get("age", "adult")
            # Gender từ chars_meta CHỈ apply nếu registry không có
            # (face-only path / pre-Phase 9 project meta backward compat).
            if not char_profile and ci.get("gender"):
                seg["speaker_gender"] = ci["gender"]
            seg["emotion"] = "neutral"
    if missing_indices:
        logger.warning(
            "Translation rỗng %d/%d segments (idx=%s) — fallback nguyên gốc.",
            len(missing_indices), len(project["segments"]),
            ",".join(str(i) for i in missing_indices[:20]),
        )
    # Apply post-fix sau khi đã set translated_text cho tất cả segments
    # (gồm cả fallback nguyên gốc). Chạy 1 lần cuối → sub + dub đều dùng
    # text đã clean.
    _apply_translation_post_fixes(project)

    # ── PHASE 10: TRANSLATION QA SERVICE ──
    # 4 checks post-translation + conservative auto-fix:
    #   1. Locked + high conf char pronoun mismatch
    #   2. Cross-batch pronoun drift
    #   3. Low ownership over-gendered
    #   4. Unknown gender forced
    # Auto-fix CHỈ khi confidence >= 0.90; medium → neutral_safe rewrite;
    # low → keep + warning only.
    try:
        from app.services.translation_qa_service import (
            apply_qa_rewrites, run_translation_qa,
        )
        from app.models.character_schemas import CharacterProfile, CharacterRegistry
        # Reconstruct registry from project summary (transcribe persisted it)
        reg_summary = (project.get("character_registry_summary") or {}).get("characters") or []
        qa_registry = None
        if reg_summary:
            reconstructed_chars = {}
            for c in reg_summary:
                cid = c.get("character_id")
                if not cid:
                    continue
                try:
                    reconstructed_chars[cid] = CharacterProfile(
                        character_id=cid,
                        source_speakers=c.get("source_speakers") or [],
                        gender=c.get("gender", "unknown"),
                        gender_confidence=float(c.get("gender_confidence") or 0.0),
                        line_count=int(c.get("line_count") or 0),
                        merge_confidence=float(c.get("merge_confidence") or 1.0),
                        locked=bool(c.get("locked") or False),
                        review_required=bool(c.get("review_required") or False),
                    )
                except Exception:
                    continue
            if reconstructed_chars:
                qa_registry = CharacterRegistry(
                    project_id=project_id,
                    characters=reconstructed_chars,
                )

        qa_result = run_translation_qa(
            project["segments"], qa_registry, batch_size=20,
        )
        applied_count = apply_qa_rewrites(
            project["segments"], qa_result["rewrites"],
        )
        project["translation_warnings"] = [
            w.model_dump() for w in qa_result["warnings"]
        ]
        project["translation_qa_stats"] = qa_result["stats"]
        logger.info(
            "Phase 10 translation_qa: %d warnings, %d auto-fixed (%d applied)",
            len(qa_result["warnings"]), qa_result["stats"]["auto_fixed"],
            applied_count,
        )
    except Exception as e:
        logger.warning("Phase 10 translation_qa fail: %s", e)
        logger.exception("translation_qa traceback:")

    # ── PHASE 11: BUILD qa_report.json ──
    # Aggregate warnings từ tất cả phases (5, 6, 7a, 8, 9, 10) + summary stats.
    # Output: <project_dir>/qa_report.json — user/UI reads for review.
    try:
        from app.services.qa_report_service import build_qa_report, save_qa_report
        qa_report = build_qa_report(project, registry=qa_registry)
        qa_report_path = _project_dir(project_id) / "qa_report.json"
        save_qa_report(qa_report, qa_report_path)
        project["qa_report_path"] = str(qa_report_path.name)
        project["qa_report_summary"] = qa_report.summary.model_dump()
        logger.info(
            "Phase 11 qa_report: written → %s (summary: %s)",
            qa_report_path.name, qa_report.summary.model_dump(),
        )
    except Exception as e:
        logger.warning("Phase 11 qa_report build fail: %s", e)
        logger.exception("qa_report traceback:")

    # ── LLM Self-verify gender (Option A) ──
    # LLM trả speaker_genders cuối output → so sánh với pipeline detect →
    # override nếu LLM tự tin (có evidence). LLM giỏi infer từ CONTEXT
    # (lời nói "bố/mẹ/anh/em") hơn pipeline F0/F1 heuristic.
    try:
        llm_genders = cloud_translate_svc.get_last_llm_genders()
        pipeline_genders = project.get("speaker_genders") or {}
        if llm_genders:
            # Save FULL speaker characters meta (character_name, age, gender, role)
            # → cho TTS routing + UI hiển thị nhân vật như bản dịch kịch bản.
            project["speaker_characters"] = {
                spk: {
                    "character_name": info.get("character_name", ""),
                    "age": info.get("age", "adult"),
                    "gender": info.get("gender", "unsure"),
                    "role": info.get("role", ""),
                    "evidence": info.get("evidence", ""),
                }
                for spk, info in llm_genders.items()
            }

            # Pipeline gender confidence (per speaker) — saved bởi pipeline.
            # Conf cao = audio detect rõ → tin pipeline. Conf thấp = ambiguous
            # → tin LLM Pass-0 (đọc context text chuẩn hơn audio biên).
            pipeline_confs = project.get("speaker_gender_confs") or {}

            overridden = {}
            for spk, info in llm_genders.items():
                llm_g = info.get("gender", "unsure")
                pipeline_g = pipeline_genders.get(spk, "unknown")
                pipeline_conf = float(pipeline_confs.get(spk, 0.5) or 0.5)
                evidence = info.get("evidence", "") or ""

                # LLM trả "unsure" → skip, không có ý kiến
                if llm_g not in ("male", "female"):
                    continue
                # Agree → no action
                if llm_g == pipeline_g:
                    continue

                # Disagree — quyết định theo pipeline confidence + chất lượng evidence:
                # • pipeline_g = "unknown"/"unsure" → LLM THẮNG TUYỆT ĐỐI
                #   (face CNN bias với face Á trẻ hay mark "unknown" sai)
                # • conf < 0.70 → audio yếu → LLM thắng (kể cả không evidence)
                # • 0.70 ≤ conf < 0.90 → ambiguous → cần LLM evidence ≥ 5 chars
                # • 0.90 ≤ conf < 0.98 → audio mạnh nhưng có thể bị nhiễu (cluster
                #     gộp nhiều speakers) → cần LLM evidence DÀI ≥ 20 chars
                #     (chứng tỏ LLM thấy multiple self-ref signals).
                # • conf ≥ 0.98 → audio cực mạnh → giữ pipeline.
                # Evidence chứa "diarization merge" hoặc "self-ref" → LLM có context
                # mạnh → tăng priority thắng.
                should_override = False
                reason = ""
                ev_len = len(evidence) if evidence else 0
                # Phase 7b: deprecate ev_len > LLM_GENDER_HINT_EVIDENCE_STRONG_CHARS
                # → preferred path: detect_self_reference_gender (gender_detection_service)
                # đã pattern match Vietnamese self-ref rồi. ev_len char count
                # quá rough. Giữ ev_strong cho compat code paths cũ; Phase 12
                # sẽ xóa.
                _self_ref_g = None
                try:
                    from app.services.gender_detection_service import (
                        detect_self_reference_gender as _det_selfref,
                    )
                    _self_ref_g = _det_selfref(evidence or "")
                except Exception:
                    _self_ref_g = None
                ev_strong = bool(evidence and (
                    _self_ref_g in ("male", "female")  # pattern-matched self-ref
                    or "self-ref" in evidence.lower()
                    or "diarization" in evidence.lower()
                    or "merge" in evidence.lower()
                    or ev_len > LLM_GENDER_HINT_EVIDENCE_STRONG_CHARS  # DEPRECATED Phase 7b
                ))
                # ABSOLUTE PRIORITY: pipeline unknown → LLM thắng vô điều kiện
                # (CNN gender bias với face Á trẻ → hay vote "unknown" → cần
                # text context override mạnh).
                if pipeline_g in ("unknown", "unsure", None, ""):
                    should_override = True
                    reason = f"pipeline_g={pipeline_g} → LLM thắng tuyệt đối"
                elif pipeline_conf < LLM_GENDER_HINT_PIPELINE_LOW:
                    should_override = True
                    reason = f"pipeline_conf={pipeline_conf:.2f} thấp → LLM thắng"
                elif pipeline_conf < LLM_GENDER_HINT_PIPELINE_MID and ev_len > LLM_GENDER_HINT_EVIDENCE_MIN_CHARS:
                    should_override = True
                    reason = f"pipeline_conf={pipeline_conf:.2f} ambiguous + LLM có evidence"
                elif pipeline_conf < LLM_GENDER_HINT_PIPELINE_HIGH and ev_strong:
                    should_override = True
                    reason = f"pipeline_conf={pipeline_conf:.2f} cao nhưng LLM evidence MẠNH ({ev_len} chars)"
                else:
                    reason = f"pipeline_conf={pipeline_conf:.2f} cao + evidence yếu → giữ audio"

                if should_override:
                    overridden[spk] = llm_g
                    logger.info(
                        "Gender %s: pipeline=%s → LLM=%s (%s, evidence: %s)",
                        spk, pipeline_g, llm_g, reason, evidence[:80] or "(none)",
                    )
                else:
                    logger.info(
                        "Gender %s: KEEP pipeline=%s (LLM said %s but %s)",
                        spk, pipeline_g, llm_g, reason,
                    )
            if overridden:
                # Update project meta
                new_genders = dict(pipeline_genders)
                new_genders.update(overridden)
                project["speaker_genders"] = new_genders
                project["speaker_genders_llm"] = llm_genders  # save full for UI
                logger.info("Gender overrides applied: %s", overridden)
                # Phase 7b MAJ-6 fix: rebuild voice_map dùng source character_id
                # (CHAR_XXX từ character_registry_summary nếu có) → gender source
                # ưu tiên CharacterProfile-derived genders đã store trong meta.
                # Fallback raw SPEAKER_XX cho legacy projects chưa có registry.
                char_gender_updates: dict[str, str] = {}
                try:
                    from app.services.speaker_pipeline import build_speaker_voice_map
                    voice_slots = project.get("voice_slots") or []
                    char_summary = project.get("character_registry_summary") or {}
                    char_entries = char_summary.get("characters") or []
                    keyspace = project.get("voice_map_keyspace", "raw_speaker")

                    if char_entries and keyspace == "character_id":
                        # Registry-aware path: map LLM overrides về char_id qua
                        # source_speakers. Nếu LLM nói SPEAKER_00=female → tìm
                        # char chứa SPEAKER_00, override CharacterProfile.gender.
                        spk_to_char: dict[str, str] = {}
                        char_genders_rebuild: dict[str, str] = {}
                        for c in char_entries:
                            cid = c.get("character_id")
                            char_genders_rebuild[cid] = c.get("gender", "unknown")
                            for spk in c.get("source_speakers", []) or []:
                                spk_to_char[spk] = cid
                        for raw_spk, new_g in overridden.items():
                            cid = spk_to_char.get(raw_spk)
                            if cid:
                                char_genders_rebuild[cid] = new_g
                                char_gender_updates[cid] = new_g
                        new_voice_map = build_speaker_voice_map(
                            speakers=sorted(char_genders_rebuild.keys()),
                            voice_slots=voice_slots,
                            user_overrides={},
                            speaker_genders=char_genders_rebuild,
                        )
                        project["speaker_voice_map"] = new_voice_map
                        logger.info(
                            "Voice map rebuilt (Phase 7b MAJ-6, CHAR_XXX namespace, "
                            "LLM overrides re-applied via source_speakers): %s",
                            new_voice_map,
                        )
                    else:
                        # Legacy fallback: raw speaker namespace (no registry).
                        speakers = list(new_genders.keys())
                        new_voice_map = build_speaker_voice_map(
                            speakers=speakers,
                            voice_slots=voice_slots,
                            user_overrides={},  # KHÔNG dùng prev map làm override
                            speaker_genders=new_genders,
                        )
                        project["speaker_voice_map"] = new_voice_map
                        logger.info(
                            "Voice map rebuilt (Phase 7b fallback raw namespace): %s",
                            new_voice_map,
                        )
                except Exception as e:
                    logger.warning("Voice map rebuild fail: %s", e)
                if char_gender_updates:
                    # Phase 12 fix: LLM override gender PHẢI set
                    # gender_confidence cao (>= GENDER_MEDIUM) để pass invariant.
                    # Trước fix: chỉ override gender, conf giữ 0.00 → vi phạm
                    # spec "gender_conf < GENDER_MEDIUM → gender phải unknown".
                    from app.config import LLM_GENDER_HINT_PIPELINE_LOW
                    for c in (project.get("character_registry_summary") or {}).get("characters") or []:
                        cid = c.get("character_id")
                        if cid in char_gender_updates:
                            c["gender"] = char_gender_updates[cid]
                            # Set conf = LLM threshold (0.70) → pass invariant
                            c["gender_confidence"] = max(
                                float(c.get("gender_confidence") or 0.0),
                                LLM_GENDER_HINT_PIPELINE_LOW,
                            )
                for seg in project.get("segments", []):
                    spk = seg.get("speaker")
                    cid = seg.get("character_id")
                    if cid in char_gender_updates:
                        seg["speaker_gender"] = char_gender_updates[cid]
                    elif spk in new_genders and new_genders[spk] in ("male", "female"):
                        seg["speaker_gender"] = new_genders[spk]

        # Phase 12 invariant — enforce: gender_conf < GENDER_MEDIUM → unknown.
        # Catch bất kỳ residual violation (LLM forgot confidence, legacy meta, ...).
        try:
            from app.services.voice_routing_svc import enforce_gender_invariant
            _gender_fixes = enforce_gender_invariant(project)
            if _gender_fixes:
                logger.warning(
                    "Phase 12 gender_invariant: reset %d chars (low conf male/female → unknown): %s",
                    len(_gender_fixes),
                    [(f["character_id"], f["old_gender"], f["old_confidence"]) for f in _gender_fixes],
                )
        except Exception as e:
            logger.warning("Phase 12 gender_invariant fail: %s", e)
        # Clear cache cho project sau
        cloud_translate_svc.clear_llm_genders()
    except Exception as e:
        logger.warning("LLM self-verify gender failed: %s", e)

    method = eng
    # Polish bằng Qwen — chỉ áp dụng khi engine là Google Free + CUDA có
    # (LLM-based engines như openai/claude/gemini đã polish sẵn).
    if eng == "google_free" and use_llm and IS_CUDA:
        logger.info("Step 2: Qwen polish for emotion + pacing…")
        try:
            durations = [seg["end"] - seg["start"] for seg in project["segments"]]
            speaker_ids = [seg.get("speaker") for seg in project["segments"]]
            polished = llm_translate_svc.polish_for_speech(
                translated, target_lang, durations=durations,
                speaker_ids=speaker_ids if any(speaker_ids) else None,
                speaker_genders=project.get("speaker_genders") or {},
            )
            for seg, result in zip(project["segments"], polished):
                if result.get("speech_text"):
                    seg["speech_text"] = result["speech_text"]
                    seg["emotion"] = result.get("emotion", "neutral")
            method = "Google Free + Qwen polish"
        except Exception as e:
            logger.warning("Qwen polish failed, giữ kết quả Google: %s", e)

    _save_meta(project)
    logger.info("Translated %d segs → %s (%s)",
                len(project["segments"]), target_lang, method)
    return project


# ── Segment CRUD ────────────────────────────────────

def update_segment(project_id: str, seg_id: str, update: dict) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    # Fields that can be set to None (to reset to project default)
    nullable_fields = {"voice_id"}

    for seg in project["segments"]:
        if seg["id"] == seg_id:
            for k, v in update.items():
                if k in seg and (v is not None or k in nullable_fields):
                    seg[k] = v
            _save_meta(project)
            return project
    raise ValueError(f"Segment '{seg_id}' not found")


def delete_segment(project_id: str, seg_id: str) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    project["segments"] = [s for s in project["segments"] if s["id"] != seg_id]
    # Re-index
    for i, seg in enumerate(project["segments"]):
        seg["index"] = i
    _save_meta(project)

    # Remove audio file if exists
    audio = _segments_dir(project_id) / f"{seg_id}.wav"
    if audio.exists():
        audio.unlink()

    return project


def split_segment(project_id: str, seg_id: str, split_at: float) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    new_segments = []
    for seg in project["segments"]:
        if seg["id"] == seg_id:
            if split_at <= seg["start"] or split_at >= seg["end"]:
                raise ValueError("split_at must be between start and end")

            # First half
            seg1 = {**seg, "id": uuid.uuid4().hex[:8], "end": round(split_at, 2)}
            # Second half
            seg2 = {**seg, "id": uuid.uuid4().hex[:8], "start": round(split_at, 2),
                     "translated_text": "", "speech_text": "", "emotion": "neutral",
                     "status": "pending"}
            new_segments.extend([seg1, seg2])
        else:
            new_segments.append(seg)

    for i, s in enumerate(new_segments):
        s["index"] = i

    project["segments"] = new_segments
    _save_meta(project)
    return project


def merge_segments(project_id: str, seg_ids: list[str]) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    to_merge = [s for s in project["segments"] if s["id"] in seg_ids]
    if len(to_merge) < 2:
        raise ValueError("Need at least 2 segments to merge")

    to_merge.sort(key=lambda s: s["start"])
    merged = {
        "id": uuid.uuid4().hex[:8],
        "index": 0,
        "start": to_merge[0]["start"],
        "end": to_merge[-1]["end"],
        "original_text": " ".join(s["original_text"] for s in to_merge),
        "translated_text": " ".join(s["translated_text"] for s in to_merge if s["translated_text"]),
        "speech_text": " ".join(s.get("speech_text", "") for s in to_merge if s.get("speech_text")),
        "emotion": to_merge[0].get("emotion", "neutral"),
        "voice_id": to_merge[0].get("voice_id"),
        "volume": to_merge[0]["volume"],
        "fade_in": to_merge[0]["fade_in"],
        "fade_out": to_merge[-1]["fade_out"],
        "status": "pending",
    }

    merge_set = set(seg_ids)
    new_segments = []
    inserted = False
    for seg in project["segments"]:
        if seg["id"] in merge_set:
            if not inserted:
                new_segments.append(merged)
                inserted = True
        else:
            new_segments.append(seg)

    for i, s in enumerate(new_segments):
        s["index"] = i

    project["segments"] = new_segments
    _save_meta(project)

    # Clean up old audio files
    for sid in seg_ids:
        f = _segments_dir(project_id) / f"{sid}.wav"
        if f.exists():
            f.unlink()

    return project


# ── Generate TTS ────────────────────────────────────

def generate_segment(project_id: str, seg_id: str) -> dict:
    """Generate TTS audio for one segment with duration matching."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    seg = next((s for s in project["segments"] if s["id"] == seg_id), None)
    if not seg:
        raise ValueError(f"Segment '{seg_id}' not found")

    # Use speech_text for TTS (has pauses/rewrites), fall back to translated_text
    tts_text = (seg.get("speech_text") or seg["translated_text"] or "").strip()
    if not tts_text:
        raise ValueError("No translated text for this segment")

    seg["status"] = "generating"
    _save_meta(project)

    target_duration = seg["end"] - seg["start"]
    tts_engine = project.get("tts_engine", "edge")
    auto_pace = project.get("auto_pace", True)  # default ON
    out_path = _segments_dir(project_id) / f"{seg_id}.wav"

    try:
        if tts_engine == "edge":
            # ── Edge TTS with smart speed matching ──
            seg_dir = _segments_dir(project_id)
            mp3_path = seg_dir / f"{seg_id}.mp3"
            # Auto per-speaker voice based on diarization gender
            edge_voice = _pick_edge_voice_for_segment(seg, project)
            lang = project["target_language"] or "vietnamese"

            # Pass 1: generate at 1x
            _edge_generate_sync(tts_text, str(mp3_path), language=lang,
                                voice=edge_voice, speed=1.0)
            _mp3_to_wav(mp3_path, out_path)

            audio_np, sr = sf.read(str(out_path))
            actual_dur = len(audio_np) / sr

            # ── Tier 1.1 + 1.4: rate-aware speed matching ──
            # Tính speed factor dựa trên rate gốc + slot time, clamp ≤ 1.10x.
            speed_factor, reason = _compute_target_speed(
                seg, target_duration, tts_text, actual_dur,
            )

            # Pass 2: re-generate CHỈ KHI cần speedup (speed_factor > 1.0).
            # speed_factor < 1.0 không bao giờ xảy ra sau fix _compute_target_speed,
            # nhưng giữ guard rõ để tránh slow audio.
            if auto_pace and speed_factor > 1.0 + SPEED_TOLERANCE:
                edge_speed = max(1.0, min(MAX_EDGE_SPEED, speed_factor))
                logger.info("[dub] edge speedup: target=%.2fs actual=%.2fs "
                            "speed=%.2fx reason=%s",
                            target_duration, actual_dur, edge_speed, reason)
                mp3_v2 = seg_dir / f"{seg_id}_v2.mp3"
                _edge_generate_sync(tts_text, str(mp3_v2), language=lang,
                                    voice=edge_voice, speed=edge_speed)
                _mp3_to_wav(mp3_v2, out_path)
                audio_np, sr = sf.read(str(out_path))
                actual_dur = len(audio_np) / sr

            # Fine-tune với atempo CHỈ KHI cần speedup (final_ratio > 1.0).
            # KHÔNG stretch chậm — câu Việt ngắn hơn slot để silence tự nhiên fill.
            if auto_pace and actual_dur > 0 and target_duration > 0:
                final_ratio = actual_dur / target_duration
                # Chỉ atempo khi cần SPEEDUP (ratio > 1.03) và trong giới hạn strict.
                if final_ratio > 1.03 and final_ratio <= MAX_SPEED_FACTOR:
                    stretched = seg_dir / f"{seg_id}_stretched.wav"
                    _atempo_stretch(out_path, stretched, final_ratio)
                    audio_np, sr = sf.read(str(stretched))
                    stretched.unlink(missing_ok=True)
                elif final_ratio > MAX_SPEED_FACTOR:
                    logger.warning("[dub] segment %s overflow: actual=%.2fs target=%.2fs "
                                   "ratio=%.2f > MAX %.2f — accepting overflow",
                                   seg.get("id", "?"), actual_dur, target_duration,
                                   final_ratio, MAX_SPEED_FACTOR)
                # final_ratio < 1.0 (audio ngắn hơn slot) → KHÔNG làm gì, silence fill

        else:
            # ── OmniVoice (local GPU) ──
            voice_prompt = None

            # Voice resolution:
            #   1. User pick voice clone/preset trong slot → dùng đúng slot đó.
            #   2. Multi-voice không pick slot → tự chọn preset nam/nữ mặc định.
            #   3. Single-voice không pick → baseline seed cố định cho cả video.
            voice_id = _pick_omni_voice_id_for_segment(seg, project)
            voice_count = int(project.get("voice_count") or 1)

            if voice_id:
                voice_prompt = load_voice(voice_id)
            else:
                # Strong deterministic seeding — tất cả random source.
                # Cùng seed_key + cùng text → cùng output → giọng nhất quán.
                import torch as _torch
                import numpy as _np
                import random as _rand
                import hashlib as _hashlib
                # Phase 12 Item 4 STRICT — seed_key dùng character_id, KHÔNG
                # dùng raw_speaker. Cùng character (dù từ SPEAKER_00 hay
                # SPEAKER_03 sau registry merge) sẽ ra cùng baseline voice.
                if voice_count > 1:
                    _char_id = seg.get("character_id")
                    if _char_id:
                        seed_key = f"{_char_id}|{project_id}"
                    else:
                        # Missing character_id → fallback (KHÔNG raw_speaker)
                        seed_key = f"fallback|{project_id}"
                        _log_voice_fallback(
                            project, seg, None, "(omnivoice_baseline)",
                            "missing_character_id_seed_fallback",
                        )
                else:
                    seed_key = str(project_id)
                seed = int.from_bytes(_hashlib.md5(seed_key.encode()).digest()[:4], "big")
                _torch.manual_seed(seed)
                _np.random.seed(seed)
                _rand.seed(seed)
                if _torch.cuda.is_available():
                    _torch.cuda.manual_seed_all(seed)
                _torch.backends.cudnn.deterministic = True
                _torch.backends.cudnn.benchmark = False
                voice_prompt = None  # explicit — OmniVoice tự sinh giọng baseline

            from omnivoice import OmniVoiceGenerationConfig
            # Match TTS preview params (no duration constraint, default guidance) —
            # forcing `duration=` + high guidance_scale was producing choppy/muddy voice
            gen_config = OmniVoiceGenerationConfig(
                num_step=TTS_DEFAULT_STEPS,
                guidance_scale=TTS_DEFAULT_GUIDANCE,
            )
            kwargs = {"generation_config": gen_config}
            if project["target_language"]:
                kwargs["language"] = project["target_language"]

            waveform = gpu.generate_tts(tts_text, voice_prompt=voice_prompt, **kwargs)
            # Cắt khoảng lặng đầu/cuối — quan trọng cho dubbing vì nếu TTS có
            # 0.3s im đầu, voice sẽ delay so với mouth movement của video gốc.
            # Dubbing: trim hơi tight hơn TTS thường (-45dB / 50ms) vì cần align
            # lip-sync với video — tránh delay 0.3s so với mouth movement.
            waveform = trim_silence(waveform, gpu.sampling_rate, threshold_db=-45, pad_ms=50)
            sr = gpu.sampling_rate
            audio_np = waveform.cpu().numpy()

            # ── Tier 1.1 + 1.4: rate-aware auto-align ──
            # Atempo < 1.0 muddies voice → chỉ speedup, slowdown để silence fill.
            # Strict cap MAX_SPEED_FACTOR (1.10x) thay vì 1.3x để tránh chipmunk.
            actual_dur = len(audio_np) / sr
            if auto_pace and target_duration > 0 and actual_dur > target_duration:
                speed_factor, reason = _compute_target_speed(
                    seg, target_duration, tts_text, actual_dur,
                )
                # Speed factor luôn trong [MIN, MAX]. Nếu reason=overflow_clamped
                # → segment sẽ overflow nhẹ vào silence kế (chấp nhận được).
                if speed_factor > 1.0 + 0.03:
                    logger.info("[dub] Vox Premium speed-match: actual=%.2fs target=%.2fs "
                                "speed=%.2fx reason=%s",
                                actual_dur, target_duration, speed_factor, reason)
                    seg_dir = _segments_dir(project_id)
                    raw_wav = seg_dir / f"{seg_id}_raw.wav"
                    stretched_wav = seg_dir / f"{seg_id}_stretched.wav"
                    sf.write(str(raw_wav), audio_np, sr)
                    try:
                        _atempo_stretch(raw_wav, stretched_wav, speed_factor)
                        audio_np, sr = sf.read(str(stretched_wav))
                    finally:
                        raw_wav.unlink(missing_ok=True)
                        stretched_wav.unlink(missing_ok=True)
                if reason == "overflow_clamped":
                    logger.warning("[dub] Vox Premium segment %s overflow: clamped to "
                                   "%.2fx — dub will be %.0fms longer than slot",
                                   seg.get("id", "?"), MAX_SPEED_FACTOR,
                                   (actual_dur / MAX_SPEED_FACTOR - target_duration) * 1000)
            elif actual_dur < target_duration * 0.9:
                # Audio ngắn hơn slot rõ rệt → gentle slowdown để khớp timing
                # thay vì cụt + silence pad gây cảm giác "đứt" giữa câu.
                # Tier theo độ dài text — text càng dài, slowdown càng nhẹ để
                # tránh muddy (atempo < 0.92 cho text dài → voice méo).
                n_chars = len(tts_text.strip())
                slow_factor = 1.0
                # Tier 1: text RẤT ngắn (≤12 chars) + slot dài → slow aggressive
                if (n_chars <= 12 and target_duration > 1.5
                        and actual_dur < target_duration * 0.65):
                    desired_dur = target_duration * 0.85
                    slow_factor = max(0.88, actual_dur / desired_dur)
                # Tier 2 (MỚI): text MEDIUM (13-40 chars) + slot khá dài
                # → slow nhẹ hơn (floor 0.92) để fill timing không bị đứt
                elif (13 <= n_chars <= 40 and target_duration > 2.0
                        and actual_dur < target_duration * 0.75):
                    desired_dur = target_duration * 0.88
                    slow_factor = max(0.92, actual_dur / desired_dur)
                # Tier 3 (MỚI): text DÀI (41-80 chars) + slot dài hơn nhiều
                # → slow rất nhẹ (floor 0.95) — tránh muddy nhưng vẫn fill
                elif (41 <= n_chars <= 80 and target_duration > 3.5
                        and actual_dur < target_duration * 0.80):
                    desired_dur = target_duration * 0.92
                    slow_factor = max(0.95, actual_dur / desired_dur)

                if slow_factor < 0.97:
                    logger.info("[dub] gentle slowdown tier %s: %d chars · "
                                "actual=%.2fs target=%.2fs speed=%.2fx",
                                ("short" if n_chars <= 12 else
                                 "medium" if n_chars <= 40 else "long"),
                                n_chars, actual_dur, target_duration, slow_factor)
                    seg_dir = _segments_dir(project_id)
                    raw_wav = seg_dir / f"{seg_id}_raw.wav"
                    stretched_wav = seg_dir / f"{seg_id}_stretched.wav"
                    sf.write(str(raw_wav), audio_np, sr)
                    try:
                        _atempo_stretch(raw_wav, stretched_wav, slow_factor)
                        audio_np, sr = sf.read(str(stretched_wav))
                        actual_dur = len(audio_np) / sr
                    finally:
                        raw_wav.unlink(missing_ok=True)
                        stretched_wav.unlink(missing_ok=True)
                logger.info("Vox Premium short-fill: actual=%.2fs target=%.2fs (silence padding)",
                            actual_dur, target_duration)

        # Tier 1.2: Insert internal pauses để giữ rhythm gốc
        internal_pauses = seg.get("internal_pauses") or []
        if internal_pauses:
            audio_np = _insert_pauses_in_audio(
                audio_np, sr, target_duration, internal_pauses,
            )
            logger.info("[dub] inserted %d internal pause(s) into segment %s",
                        len(internal_pauses), seg.get("id", "?"))

        # ── Studio chain per-segment (áp cho CẢ Edge và Vox Premium) ──
        # Áp dụng EQ theo gender + de-esser + RMS loudness norm. Bật/tắt
        # qua project["studio_mix"] (default ON).
        if project.get("studio_mix", True):
            try:
                from app.services.audio_mix_svc import (
                    apply_voice_chain, normalize_loudness_rms,
                )
                # Phase 12 Item 5 STRICT — gender từ registry character_id,
                # KHÔNG đọc seg["speaker_gender"] (per-segment, fluctuate).
                # speaker_gender chỉ giữ làm metadata/debug.
                _cid = seg.get("character_id")
                gender = "unknown"
                if _cid:
                    _char_summary = (
                        (project.get("character_registry_summary") or {}).get("characters") or []
                    )
                    _profile = next(
                        (c for c in _char_summary if c.get("character_id") == _cid),
                        None,
                    )
                    if _profile:
                        gender = (_profile.get("gender") or "unknown").lower()
                audio_np = apply_voice_chain(audio_np, sr, gender=gender)
                # RMS loudness norm — gentler -23dBFS, cap ±5dB (less harsh)
                audio_np = normalize_loudness_rms(audio_np, target_dbfs=-23.0, max_gain_db=5.0)
            except Exception as e:
                logger.warning("Segment %s: studio chain failed (%s) — raw output",
                               seg_id, e)

        # Apply volume
        if seg.get("volume", 1.0) != 1.0:
            audio_np = audio_np * seg["volume"]

        # Apply fade in/out
        if seg.get("fade_in", 0) > 0:
            fade_samples = min(int(seg["fade_in"] * sr), len(audio_np))
            audio_np[:fade_samples] *= np.linspace(0, 1, fade_samples)

        if seg.get("fade_out", 0) > 0:
            fade_samples = min(int(seg["fade_out"] * sr), len(audio_np))
            audio_np[-fade_samples:] *= np.linspace(1, 0, fade_samples)

        # Save final wav
        sf.write(str(out_path), audio_np, sr)

        seg["status"] = "done"
        _save_meta(project)
        logger.info("Generated segment %s (%.1fs) via %s", seg_id, target_duration, tts_engine)

    except Exception as e:
        seg["status"] = "error"
        _save_meta(project)
        import traceback
        logger.error("Generate segment %s FAILED (engine=%s): %s\n%s",
                     seg_id, tts_engine, e, traceback.format_exc())
        raise ValueError(f"Generation failed: {e}")

    return project


def generate_all(project_id: str):
    """Generate TTS for all segments using batch pipeline for Edge TTS."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    # ── Phase 12 Item 6: pre-TTS validation — 1 character → 1 voice ──
    # Detect & auto-resolve conflicts BEFORE TTS. Cùng character bị gán
    # multiple voices → rewrite về expected (registry voice_map) + log
    # voice_conflicts vào qa_report.
    try:
        from app.services.voice_routing_svc import (
            validate_character_voice_consistency,
        )
        _conflicts = validate_character_voice_consistency(project)
        if _conflicts:
            logger.warning(
                "Phase 12 Item 6: %d voice_conflicts auto-resolved trước TTS: %s",
                len(_conflicts),
                [(c["character_id"], c["voices_found"]) for c in _conflicts],
            )
            _save_meta(project)
    except Exception as e:
        logger.warning("Phase 12 Item 6 voice consistency validation fail: %s", e)

    tts_engine = project.get("tts_engine", "edge")

    if tts_engine == "edge":
        yield from _generate_all_batched(project_id, project)
    else:
        yield from _generate_all_single(project_id, project)


def _generate_all_single(project_id: str, project: dict):
    """Original per-segment generation (for VoxLocal/OmniVoice)."""
    segments = [s for s in project["segments"]
                if (s.get("speech_text") or s["translated_text"] or "").strip()]
    total = len(segments)

    for i, seg in enumerate(segments):
        if seg["status"] == "done":
            yield {"current": i + 1, "total": total, "segment_id": seg["id"], "status": "skipped"}
            continue
        try:
            generate_segment(project_id, seg["id"])
            yield {"current": i + 1, "total": total, "segment_id": seg["id"], "status": "done"}
        except Exception as e:
            yield {"current": i + 1, "total": total, "segment_id": seg["id"],
                   "status": "error", "error": str(e)}


# ── Batch TTS Pipeline (Edge TTS) ─────────────────

MAX_BATCH_DURATION = 30.0   # Max seconds per batch
MAX_BATCH_SEGMENTS = 8      # Max segments per batch
MIN_SEGMENT_GAP = 2.0       # If gap > this, start new batch


def _group_segments_into_batches(segments: list[dict]) -> list[list[dict]]:
    """Group consecutive segments into batches for natural TTS.

    Rules:
    - Combine adjacent segments until batch duration > MAX_BATCH_DURATION
    - Or segment count > MAX_BATCH_SEGMENTS
    - Or gap between segments > MIN_SEGMENT_GAP (scene change)
    """
    batches = []
    current_batch = []

    def seg_character(s):
        """Phase 12 STRICT — group strictly by character_id (single source).

        Trước Phase 12: group theo (speaker, speaker_gender) — bug khi raw
        speaker thay đổi giữa segments cùng character (fusion FACE_XX vs
        SPEAKER_XX) hoặc speaker_gender fluctuate per segment.

        Sau Phase 12: chỉ character_id. KHÔNG dùng raw_speaker, KHÔNG dùng
        speaker_gender. Mỗi batch character-stable → batch voice consistent.
        """
        return s.get("character_id") or "_missing_char_"

    for seg in segments:
        text = (seg.get("speech_text") or seg["translated_text"] or "").strip()
        if not text:
            continue

        if not current_batch:
            current_batch.append(seg)
            continue

        prev = current_batch[-1]
        gap = seg["start"] - prev["end"]
        batch_duration = seg["end"] - current_batch[0]["start"]

        # Start new batch if: too long, too many segments, big gap, or CHARACTER change
        if (batch_duration > MAX_BATCH_DURATION
                or len(current_batch) >= MAX_BATCH_SEGMENTS
                or gap > MIN_SEGMENT_GAP
                or seg_character(seg) != seg_character(prev)):
            batches.append(current_batch)
            current_batch = [seg]
        else:
            current_batch.append(seg)

    if current_batch:
        batches.append(current_batch)

    return batches


def _edge_generate_sync(text: str, out_path: str, language: str,
                        voice: str = None, speed: float = 1.0):
    """Run async edge_tts.generate in a separate thread (safe from FastAPI loop)."""
    def _run():
        asyncio.run(
            edge_tts_svc.generate(text, out_path, language=language,
                                  voice=voice, speed=speed)
        )
    with concurrent.futures.ThreadPoolExecutor() as pool:
        pool.submit(_run).result()


def _mp3_to_wav(mp3_path: Path, wav_path: Path, sr: int = 24000):
    """Convert mp3 → wav via ffmpeg."""
    (
        ffmpeg.input(str(mp3_path))
        .output(str(wav_path), acodec="pcm_s16le", ac=1, ar=sr)
        .overwrite_output()
        .run(quiet=True)
    )
    mp3_path.unlink(missing_ok=True)


def _trim_trailing_silence(audio: np.ndarray, sr: int, threshold_db: float = -40.0,
                            min_keep_sec: float = 0.05) -> np.ndarray:
    """Cắt khoảng im lặng cuối audio (RMS < threshold). Trả audio đã trim.

    Dùng cho batch TTS bị overflow slot — trim đuôi im lặng trước khi
    hard-crop, giúp giảm thiểu mất nội dung thực.
    """
    if audio.size == 0:
        return audio
    if audio.ndim > 1:
        mono = audio.mean(axis=1)
    else:
        mono = audio
    threshold_amp = 10 ** (threshold_db / 20.0)
    win = max(1, int(0.02 * sr))  # 20ms windows
    n_full_wins = len(mono) // win
    if n_full_wins == 0:
        return audio
    rms = np.sqrt(np.mean(mono[:n_full_wins * win].reshape(n_full_wins, win) ** 2, axis=1))
    # Lùi từ cuối về đầu, dừng ở window đầu tiên có RMS > threshold
    last_voiced = -1
    for i in range(n_full_wins - 1, -1, -1):
        if rms[i] > threshold_amp:
            last_voiced = i
            break
    if last_voiced < 0:
        return audio  # toàn im lặng → giữ nguyên (caller xử lý)
    end = (last_voiced + 1) * win
    end = min(end + int(min_keep_sec * sr), len(audio))  # giữ thêm 50ms cho âm cuối
    return audio[:end]


def _atempo_stretch(in_path: Path, out_path: Path, tempo: float):
    """Time-stretch audio với ffmpeg atempo. Support cả speedup VÀ slowdown.

    Caller responsibility chọn tempo trong range an toàn:
      • Speedup: 1.0 → 2.0+ (atempo phải chain nếu > 2.0, hàm tự handle)
      • Slowdown: 0.5 → 1.0 (ffmpeg native range; < 0.85 nghe muddy)

    Trước đây hàm guard slowdown về copy file — bug khiến mọi caller gọi
    với tempo < 1.0 (gentle slowdown cho text ngắn để fill slot) bị no-op
    silently → audio vẫn ngắn → silence pad đáng kể → cảm giác "đứt đứt".

    Clamp ngoài range vẫn áp dụng cho an toàn (avoid ffmpeg error).
    """
    # Clamp range an toàn của atempo filter
    if tempo < 0.5:
        tempo = 0.5
    elif tempo > 4.0:
        tempo = 4.0
    # Nếu sát 1.0 (no change) → copy file để tránh re-encode loss
    if abs(tempo - 1.0) < 0.01:
        import shutil
        shutil.copy(str(in_path), str(out_path))
        return
    # ffmpeg atempo native range 0.5-2.0. Speedup > 2.0 phải chain (2.0 * 2.0...).
    # Slowdown < 0.5 không cần chain (caller đã clamp).
    filters = []
    t = tempo
    while t > 2.0:
        filters.append("atempo=2.0")
        t /= 2.0
    filters.append(f"atempo={t:.4f}")

    (
        ffmpeg.input(str(in_path))
        .output(str(out_path), af=",".join(filters),
                acodec="pcm_s16le", ac=1, ar=24000)
        .overwrite_output()
        .run(quiet=True)
    )


# ── TTS speed matching ──
# Speedup tối đa 1.40x (Edge TTS giữ chất lượng tốt đến ~1.30x, push lên
# 1.40 cho overflow nặng — nghe hơi nhanh nhưng không chipmunk).
# Nếu vẫn không đủ, trim trailing silence + cap cứng để KHÔNG bleed.
SPEED_TOLERANCE = 0.05      # 5% — chỉ skip atempo nếu lệch < 5%
# 1.40x: kinh nghiệm thực tế phim Trung — câu Việt thường +25-35% dài hơn
# tiếng Trung do thừa các tiểu từ ("đó", "nhỉ", "thế..."). Cap 1.30 cũ
# vẫn để overflow nhẹ (5-10% segments bleed). 1.40 chấp nhận speedup mạnh
# hơn cho extreme case — vẫn nghe tự nhiên, không chipmunk.
MAX_SPEED_FACTOR = 1.40     # speedup tối đa (atempo)
# Slowdown được phép cho text ngắn/medium (fill slot dài). Floor cứng 0.85
# vì atempo < 0.85 → voice muddy. Caller (gentle slowdown logic) chọn
# floor riêng theo độ dài text (0.88 short / 0.92 medium / 0.95 long).
MIN_SPEED_FACTOR = 0.85     # slowdown tối đa (atempo)
MAX_EDGE_SPEED = 1.40       # Edge TTS rate max (đồng bộ với atempo)
MIN_EDGE_SPEED = 1.0        # KHÔNG slowdown Edge TTS (regenerate phải tốc bình thường)
# Sau khi đã max speed, cho phép overflow X% rồi mới hard-trim. 15% grace
# để cuối câu không bị cụt giật khi ratio nhỏ (1.10–1.20x).
OVERFLOW_GRACE = 1.15
# Tốc độ nói tiếng Việt trung bình (chars/sec, không tính space/punct).
# Dùng làm fallback khi không tính được rate gốc (vd Whisper không có
# original_text, hoặc segment có text rỗng).
DEFAULT_VN_RATE = 13.0


def _count_meaningful_chars(text: str) -> int:
    """Đếm ký tự "có nghĩa" — bỏ space, dấu câu, ký tự control. Dùng để
    tính speech rate (chars/sec) cho TTS speed matching."""
    if not text:
        return 0
    import re
    # Giữ chữ cái + số + dấu thanh tiếng Việt (Unicode L category)
    cleaned = re.sub(r"[^\w]", "", text, flags=re.UNICODE)
    return len(cleaned)


def _emotion_speed_cap(emotion: str | None) -> float:
    """Speed cap thông minh theo emotion. Production: phim cảnh khác cảnh,
    không thể dùng 1 cap cứng nhắc.

    - angry/argument/cao trào: chấp nhận nhanh hơn (dồn nhịp tự nhiên)
    - whisper/sad/cảm xúc: cap thấp hơn (giữ giọng truyền cảm)
    - happy/surprised/fearful: trung bình
    - neutral / default: cap chuẩn
    """
    if not emotion:
        return MAX_SPEED_FACTOR
    e = emotion.lower().strip()
    if e in ("angry", "argument", "shouting"):
        return 1.45  # Cãi nhau/giận → nhanh OK (cao hơn neutral 1.40)
    if e in ("whisper", "sad", "tender", "intimate"):
        return 1.20  # Truyền cảm → giữ chậm
    if e in ("happy", "surprised", "fearful", "excited"):
        return 1.38  # Cảm xúc tăng — nhẹ hơn neutral
    return MAX_SPEED_FACTOR  # neutral / unknown → 1.40


def _compute_target_speed(seg: dict, target_dur: float, dub_text: str,
                          tts_natural_dur: float) -> tuple[float, str]:
    """Tính tỉ số speedup tối ưu cho TTS dub.

    Trả về (speed_factor, reason) — speed_factor nằm trong [MIN, emotion_cap].

    Logic:
      1. Tính rate gốc (orig_chars / orig_dur). Nếu thiếu → DEFAULT_VN_RATE.
      2. Estimate dub_dur_at_orig_rate.
      3. Compare với target_dur (slot time).
      4. **Adaptive cap theo emotion** (production fix S4.D6):
         - angry → 1.32x (cao trào nhanh OK)
         - whisper/sad → 1.15x (truyền cảm)
         - default → 1.25x
      5. Tránh slowdown < MIN (TTS slow xuống nghe muddy).
    """
    orig_text = seg.get("original_text") or seg.get("text") or ""
    orig_dur = seg.get("end", 0) - seg.get("start", 0)
    emotion = seg.get("emotion") or "neutral"
    speed_cap = _emotion_speed_cap(emotion)

    orig_chars = _count_meaningful_chars(orig_text)
    if orig_chars > 0 and orig_dur > 0.5:
        orig_rate = orig_chars / orig_dur
    else:
        orig_rate = DEFAULT_VN_RATE

    # Use TTS natural duration as baseline if available
    if tts_natural_dur > 0 and target_dur > 0:
        ratio = tts_natural_dur / target_dur
    else:
        dub_chars = _count_meaningful_chars(dub_text)
        est_dur = dub_chars / orig_rate if orig_rate > 0 else target_dur
        ratio = est_dur / target_dur if target_dur > 0 else 1.0

    # ── KHÔNG SLOWDOWN ──
    # Audio Việt ngắn hơn slot → để silence tự nhiên fill, KHÔNG kéo dài.
    # Slowdown làm voice nghe lờ đờ, méo (timbre artifact của atempo < 1.0).
    if ratio <= 1.0:
        return (1.0, "natural_no_slowdown")
    # Speedup nhỏ trong tolerance → giữ natural 1.0
    if ratio <= 1.0 + SPEED_TOLERANCE:
        return (1.0, "natural")
    # Speedup vừa phải trong cap (1.05-1.32 tuỳ emotion)
    if ratio <= speed_cap:
        return (ratio, "speedup_within_limit")
    # Overflow vượt cap — clamp để audio không bị chipmunk
    reason = f"overflow_clamped_{emotion}" if emotion != "neutral" else "overflow_clamped"
    return (speed_cap, reason)


def _process_one_batch_audio(
    batch_idx: int, batch: list[dict], project: dict, batches: list,
    target_lang: str, seg_dir: Path, sr: int, video_duration: float,
) -> dict:
    """Generate + post-process audio cho 1 batch (pure function — không có
    shared state). Trả {batch_idx, batch_start, audio, segments, ok, error?}.

    Pipeline per batch:
      1. Combine text
      2. Edge TTS @ 1x
      3. Speed-adjust (re-gen at native speed if ratio off)
      4. atempo fine-tune (cap MAX_SPEED_FACTOR)
      5. Hard-trim overflow (silence-aware)
      6. Voice EQ chain theo gender (pedalboard)
      7. RMS loudness normalize (consistent volume across batches)
      8. Fade-in/out edges (tránh click ở junction)
    """
    try:
        # Step 1: combine text
        combined_parts = []
        for s in batch:
            text = (s.get("speech_text") or s["translated_text"] or "").strip()
            combined_parts.append(text)
        combined_text = "... ".join(combined_parts)

        batch_start = batch[0]["start"]
        batch_end = batch[-1]["end"]
        target_duration = batch_end - batch_start

        # Phase 12 STRICT — voice từ character_id của batch, KHÔNG từ batch[0].
        # Sau Item 2 (batch grouping by character_id), TẤT CẢ segments trong
        # batch share character_id. Pick voice qua registry strict resolver.
        batch_character_id = batch[0].get("character_id")  # safe — batch
        # character-stable per Item 2 _group_segments_into_batches
        edge_voice, _vfb_reason = _resolve_voice_by_character_id(
            batch_character_id, project,
        )
        if _vfb_reason:
            _log_voice_fallback(
                project, batch[0], batch_character_id, edge_voice, _vfb_reason,
            )

        # Gender CHỈ dùng cho log (KHÔNG dùng cho voice selection).
        # Source = registry profile (NOT batch[0].speaker_gender — vi phạm Rule 1).
        _char_summary_list = (
            (project.get("character_registry_summary") or {}).get("characters") or []
        )
        _profile = next(
            (c for c in _char_summary_list if c.get("character_id") == batch_character_id),
            None,
        )
        gender = (_profile.get("gender") if _profile else "") or ""

        batch_mp3 = seg_dir / f"_batch_{batch_idx}.mp3"
        batch_wav = seg_dir / f"_batch_{batch_idx}.wav"

        # Step 2: Edge TTS @ 1x
        _edge_generate_sync(combined_text, str(batch_mp3),
                            language=target_lang, voice=edge_voice, speed=1.0)
        _mp3_to_wav(batch_mp3, batch_wav)
        batch_audio, _ = sf.read(str(batch_wav))
        actual_duration = len(batch_audio) / sr
        speed_ratio = actual_duration / target_duration if target_duration > 0 else 1.0

        logger.info("Batch %d: target=%.1fs, actual=%.1fs, ratio=%.2f, gender=%s",
                    batch_idx + 1, target_duration, actual_duration, speed_ratio, gender or "?")

        # Step 3: Re-gen với speed CAO HƠN nếu audio dài hơn slot. KHÔNG slowdown.
        # speed_ratio > 1.0 = audio dài hơn slot → cần speedup.
        # speed_ratio < 1.0 = audio ngắn hơn → silence tự fill, không re-gen.
        if speed_ratio > 1.0 + SPEED_TOLERANCE:
            edge_speed = max(1.0, min(MAX_EDGE_SPEED, speed_ratio))
            batch_mp3_v2 = seg_dir / f"_batch_{batch_idx}_v2.mp3"
            _edge_generate_sync(combined_text, str(batch_mp3_v2),
                                language=target_lang, voice=edge_voice, speed=edge_speed)
            _mp3_to_wav(batch_mp3_v2, batch_wav)
            batch_audio, _ = sf.read(str(batch_wav))
            actual_duration = len(batch_audio) / sr
            speed_ratio = actual_duration / target_duration if target_duration > 0 else 1.0

        # Step 4: atempo CHỈ KHI cần speedup (ratio > 1.03). KHÔNG stretch chậm.
        if actual_duration > 0 and speed_ratio > 1.03:
            atempo_factor = min(speed_ratio, MAX_SPEED_FACTOR)
            if atempo_factor > 1.03:
                stretched_wav = seg_dir / f"_batch_{batch_idx}_final.wav"
                _atempo_stretch(batch_wav, stretched_wav, atempo_factor)
                batch_audio, _ = sf.read(str(stretched_wav))
                stretched_wav.unlink(missing_ok=True)
                actual_duration = len(batch_audio) / sr
                speed_ratio = actual_duration / target_duration if target_duration > 0 else 1.0

        # Step 5: Overflow trim (silence-aware)
        if batch_idx + 1 < len(batches):
            next_batch_start = batches[batch_idx + 1][0]["start"]
        else:
            next_batch_start = video_duration
        extension = max(0.0, next_batch_start - batch_end - 0.1)
        max_allowed = max(target_duration * OVERFLOW_GRACE, target_duration + extension)
        if actual_duration > max_allowed and actual_duration > 0:
            trimmed = _trim_trailing_silence(batch_audio, sr, threshold_db=-40.0)
            trim_dur = len(trimmed) / sr
            if trim_dur <= max_allowed:
                batch_audio = trimmed
                actual_duration = trim_dur
            else:
                target_samples = int(max_allowed * sr)
                fade_samples = min(int(0.05 * sr), target_samples // 4)
                batch_audio = batch_audio[:target_samples].copy()
                if fade_samples > 0:
                    fade = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
                    batch_audio[-fade_samples:] *= fade
                actual_duration = len(batch_audio) / sr

        batch_wav.unlink(missing_ok=True)

        # Step 6-8: Studio chain (gender EQ + loudness + fade edges)
        # Bật/tắt qua project["studio_mix"] (default True). Tắt → place raw
        # audio để giữ tone gốc của Edge TTS (không nhuộm phòng thu).
        studio_on = bool(project.get("studio_mix", True))
        if studio_on:
            try:
                from app.services.audio_mix_svc import (
                    apply_voice_chain, normalize_loudness_rms, fade_edges,
                )
                batch_audio = apply_voice_chain(batch_audio, sr, gender=gender)
                # RMS loudness norm — target -23dBFS (gentler than -20 để
                # tránh over-amplify noise floor → âm thanh chói).
                # Cap gain ±5dB (was ±8) để không boost segment quá quiet.
                batch_audio = normalize_loudness_rms(batch_audio, target_dbfs=-23.0, max_gain_db=5.0)
                # Fade edges 30ms để place vào silent track không click
                batch_audio = fade_edges(batch_audio, sr, fade_ms=30.0)
            except Exception as e:
                logger.warning("Batch %d: studio chain failed (%s) — placing raw",
                               batch_idx + 1, e)

        return {
            "batch_idx": batch_idx,
            "batch_start": batch_start,
            "audio": batch_audio,
            "segments": batch,
            "target_duration": target_duration,
            "ok": True,
        }
    except Exception as e:
        return {
            "batch_idx": batch_idx,
            "segments": batch,
            "ok": False,
            "error": str(e),
        }


def _generate_all_batched(project_id: str, project: dict):
    """Batch TTS → continuous dubbed track (parallel TTS + studio mix per batch).

    1. Group segments into batches
    2. PARALLEL: generate + process audio per batch (Edge TTS network-bound,
       ffmpeg atempo CPU-bound — concurrent 4 workers giảm 60-70% time)
    3. SEQUENTIAL: place processed audio at correct timestamps in full track
    4. Save as dubbed_track.wav
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    segments = project["segments"]
    batches = _group_segments_into_batches(segments)
    total = sum(len(b) for b in batches)
    done_count = 0

    target_lang = project.get("target_language") or "vietnamese"
    seg_dir = _segments_dir(project_id)
    sr = 24000

    # Full track: silence array covering entire video duration
    video_duration = project.get("video_duration", 0)
    if video_duration <= 0:
        # Estimate from last segment
        video_duration = max((s["end"] for s in segments), default=60)
    track_samples = int(video_duration * sr) + sr  # +1s buffer
    full_track = np.zeros(track_samples, dtype=np.float64)

    # ── Phase A: Skip already-done batches (load existing audio) ──
    pending_indices = []
    for batch_idx, batch in enumerate(batches):
        if all(s["status"] == "done" for s in batch):
            for s in batch:
                done_count += 1
                yield {"current": done_count, "total": total,
                       "segment_id": s["id"], "status": "skipped"}
            _load_existing_into_track(full_track, batch, seg_dir, sr)
        else:
            pending_indices.append(batch_idx)

    # ── Phase B: Parallel TTS + studio mix per batch ──
    # Edge TTS chủ yếu network-bound → 4 workers concurrent giảm ~60-70% time.
    # Mỗi batch độc lập (không share state với các batch khác trong phase này).
    MAX_TTS_WORKERS = 4
    n_pending = len(pending_indices)
    if n_pending > 0:
        logger.info("Generating %d batches in parallel (max %d workers)...",
                    n_pending, MAX_TTS_WORKERS)

    results: dict[int, dict] = {}
    if pending_indices:
        with ThreadPoolExecutor(max_workers=min(MAX_TTS_WORKERS, n_pending)) as ex:
            future_to_idx = {
                ex.submit(
                    _process_one_batch_audio,
                    bi, batches[bi], project, batches,
                    target_lang, seg_dir, sr, video_duration,
                ): bi
                for bi in pending_indices
            }
            # Yield progress as each batch completes
            for fut in as_completed(future_to_idx):
                bi = future_to_idx[fut]
                try:
                    res = fut.result()
                except Exception as e:
                    logger.error("Batch %d worker crashed: %s", bi + 1, e)
                    res = {"batch_idx": bi, "ok": False, "error": str(e),
                           "segments": batches[bi]}
                results[bi] = res
                # Yield per-segment progress for SSE
                if res.get("ok"):
                    for s in res["segments"]:
                        s["status"] = "done"
                        done_count += 1
                        yield {"current": done_count, "total": total,
                               "segment_id": s["id"], "status": "done"}
                else:
                    err = res.get("error", "unknown")
                    for s in res["segments"]:
                        if s.get("status") != "done":
                            s["status"] = "error"
                            done_count += 1
                            yield {"current": done_count, "total": total,
                                   "segment_id": s["id"], "status": "error",
                                   "error": err}
                _save_meta(project)

    # ── Phase C: Sequential placement in full track ──
    # Phải sequential vì có overlap detection + np.pad có thể realloc array.
    # Sort theo batch_idx để placement đúng thứ tự thời gian.
    # GIỮ batch_start nguyên — không shift để không lệch lip-sync. Smoothness
    # đến từ cosine fade-out (80ms) ở cuối mỗi batch, đủ làm mềm transition.
    for bi in pending_indices:
        res = results.get(bi)
        if not res or not res.get("ok"):
            continue
        batch_audio = res["audio"]
        if batch_audio is None or len(batch_audio) == 0:
            continue
        start_sample = int(res["batch_start"] * sr)
        end_sample = start_sample + len(batch_audio)
        if end_sample > len(full_track):
            full_track = np.pad(full_track, (0, end_sample - len(full_track)))
        # Mix additive (consistent with old behavior). Trường hợp prev batch
        # overflow vào start_sample (rare khi MAX_SPEED_FACTOR=1.30 đã trim),
        # additive mix tạo blend tự nhiên với cosine fade-out của prev.
        full_track[start_sample:start_sample + len(batch_audio)] += batch_audio
        logger.info("Batch %d placed: %d segs, dur=%.1fs",
                    bi + 1, len(res["segments"]), res.get("target_duration", 0))

    # ── Phase D: Master bus chain trước khi save dubbed_track ──
    # Glue compression + true-peak limiter. LUFS final normalize sẽ apply
    # ở step export_video (cùng với BGM mix) — không double normalize.
    studio_on = bool(project.get("studio_mix", True))
    if studio_on:
        try:
            from pedalboard import Pedalboard, Compressor, Limiter
            master_chain = Pedalboard([
                # Glue rất nhẹ — chỉ touch peaks, không squash voice
                Compressor(threshold_db=-12, ratio=1.5, attack_ms=30, release_ms=400),
                # True-peak limiter: ceiling -1 dBTP (broadcast safe)
                Limiter(threshold_db=-1.0, release_ms=150),
            ])
            full_track_f32 = full_track.astype(np.float32)
            full_track_f32 = master_chain(full_track_f32, sr)
            full_track = full_track_f32
            logger.info("Master bus chain applied (glue comp + limiter)")
        except Exception as e:
            logger.warning("Master chain failed (%s) — peak normalize fallback", e)
            peak = np.max(np.abs(full_track))
            if peak > 0.95:
                full_track = full_track * (0.95 / peak)
    else:
        # Studio mix tắt → chỉ peak normalize tránh clipping
        peak = np.max(np.abs(full_track))
        if peak > 0.95:
            full_track = full_track * (0.95 / peak)
        logger.info("Studio mix DISABLED — raw output")

    track_path = _project_dir(project_id) / "dubbed_track.wav"
    sf.write(str(track_path), full_track.astype(np.float32), sr)
    logger.info("Dubbed track saved: %s (%.1fs) — parallel x%d",
                track_path, len(full_track) / sr, MAX_TTS_WORKERS)


def _load_existing_into_track(full_track: np.ndarray, batch: list[dict],
                               seg_dir: Path, sr: int):
    """Load previously generated batch audio into the full track (for skipped batches)."""
    # Try to find any existing segment audio and place it
    for s in batch:
        wav_path = seg_dir / f"{s['id']}.wav"
        if wav_path.exists():
            audio, _ = sf.read(str(wav_path))
            start = int(s["start"] * sr)
            end = start + len(audio)
            if end <= len(full_track):
                full_track[start:end] += audio


def get_segment_audio_path(project_id: str, seg_id: str) -> Path | None:
    path = _segments_dir(project_id) / f"{seg_id}.wav"
    return path if path.exists() else None


# ── Export Video ────────────────────────────────────

def _apply_ducking(bgm: np.ndarray, dubbed: np.ndarray, sr: int,
                   duck_level: float = 0.15, attack: float = 0.05,
                   release: float = 0.3) -> np.ndarray:
    """Apply smart audio ducking — reduce BGM volume when dubbed voice is present.

    Uses an envelope follower with attack/release smoothing:
    - When voice detected → BGM fades down to duck_level
    - When voice stops → BGM fades back up (release time)
    """
    # Handle stereo BGM → convert to mono for processing, remix later
    bgm_stereo = None
    if bgm.ndim == 2:
        bgm_stereo = bgm.copy()
        bgm = np.mean(bgm, axis=1)
    if dubbed.ndim == 2:
        dubbed = np.mean(dubbed, axis=1)

    # Ensure same length
    max_len = max(len(bgm), len(dubbed))
    if len(bgm) < max_len:
        bgm = np.pad(bgm, (0, max_len - len(bgm)))
    if len(dubbed) < max_len:
        dubbed = np.pad(dubbed, (0, max_len - len(dubbed)))
    if bgm_stereo is not None:
        if len(bgm_stereo) < max_len:
            bgm_stereo = np.pad(bgm_stereo, ((0, max_len - len(bgm_stereo)), (0, 0)))

    # Create voice presence envelope from dubbed audio
    envelope = np.abs(dubbed).astype(np.float64)

    # Smooth with attack/release follower
    attack_coeff = np.exp(-1.0 / (sr * max(attack, 0.001)))
    release_coeff = np.exp(-1.0 / (sr * max(release, 0.01)))
    smoothed = np.zeros_like(envelope)
    for i in range(1, len(envelope)):
        if envelope[i] > smoothed[i - 1]:
            smoothed[i] = attack_coeff * smoothed[i - 1] + (1 - attack_coeff) * envelope[i]
        else:
            smoothed[i] = release_coeff * smoothed[i - 1] + (1 - release_coeff) * envelope[i]

    # Normalize envelope to 0-1
    peak = np.max(smoothed)
    if peak > 0:
        smoothed = smoothed / peak

    # Apply gain curve: 1.0 when no voice → duck_level when voice present
    gain = 1.0 - smoothed * (1.0 - duck_level)

    # Apply ducking to stereo or mono BGM
    if bgm_stereo is not None:
        ducked_bgm = bgm_stereo * gain[:, np.newaxis]
        # Mix: stereo BGM + mono dubbed (broadcast to both channels)
        mixed = ducked_bgm + dubbed[:, np.newaxis]
    else:
        ducked_bgm = bgm * gain
        mixed = ducked_bgm + dubbed
    # Normalize to prevent clipping
    mix_peak = np.max(np.abs(mixed))
    if mix_peak > 0.95:
        mixed = mixed * (0.95 / mix_peak)

    return mixed.astype(np.float32)


def export_video(project_id: str, keep_original_audio: bool = False,
                 original_audio_volume: float = 0.1,
                 enable_ducking: bool = True, duck_level: float = 0.15,
                 duck_attack: float = 0.05, duck_release: float = 0.3,
                 use_pro_mix: bool = True, target_lufs: float = -16.0) -> str:
    """Assemble dubbed audio and/or burn subtitles based on project toggles.

    use_pro_mix=True (default): use pedalboard + LUFS chain for broadcast-quality mix.
    Falls back to legacy envelope-follower ducking if pro_mix fails.
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    project["status"] = "exporting"
    _save_meta(project)

    pdir = _project_dir(project_id)
    video_path = pdir / "original.mp4"
    export_path = pdir / "export.mp4"
    do_dubbing = project.get("enable_dubbing", True)
    do_subtitle = project.get("enable_subtitle", False)
    aspect_ratio = project.get("aspect_ratio", "original")
    trim_s = project.get("trim_start", 0)
    trim_e = project.get("trim_end", project["video_duration"])

    # User config từ project settings override API params (nếu user đã set ở UI)
    if project.get("keep_original_audio") is not None:
        keep_original_audio = bool(project["keep_original_audio"])
    if project.get("original_audio_volume") is not None:
        original_audio_volume = float(project["original_audio_volume"])
    crop_mode = project.get("crop_mode", "smart")  # smart | center | letterbox

    # ── 2 luồng audio mix riêng (mới) ──
    # accompaniment = nhạc nền/SFX (đã loại giọng qua Demucs) — default ON
    # vocals        = giọng người gốc (đã tách) — default OFF
    keep_accomp = project.get("keep_accompaniment",
                              keep_original_audio if keep_original_audio else True)
    accomp_vol  = float(project.get("accompaniment_volume",
                                    original_audio_volume if original_audio_volume else 0.35))
    keep_vocals = bool(project.get("keep_original_voice", False))
    vocals_vol  = float(project.get("original_voice_volume", 0.20))

    try:
        # ── Step 1: Prepare dubbed audio if enabled ──
        dubbed_audio_path = None
        if do_dubbing:
            sr = gpu.sampling_rate
            video_duration = project["video_duration"]
            total_samples = int(video_duration * sr)
            full_audio = np.zeros(total_samples, dtype=np.float32)

            # Prefer the continuous dubbed_track.wav produced by batch mode (Edge TTS)
            dubbed_track_path = pdir / "dubbed_track.wav"
            if dubbed_track_path.exists():
                track_audio, track_sr = sf.read(str(dubbed_track_path), dtype="float32")
                if track_audio.ndim > 1:
                    track_audio = track_audio.mean(axis=1)
                # Resample if sr differs
                if track_sr != sr:
                    from scipy.signal import resample
                    track_audio = resample(
                        track_audio, int(len(track_audio) * sr / track_sr)
                    ).astype(np.float32)
                # Fit to target length
                copy_len = min(len(track_audio), total_samples)
                full_audio[:copy_len] = track_audio[:copy_len]
                logger.info("Export using dubbed_track.wav (%.1fs)", copy_len / sr)
            else:
                # Fallback: build from individual segment files (per-segment TTS mode).
                # Áp fade edges 30ms cho mỗi segment (tránh click ở junction
                # khi place vào silent track) — chỉ khi studio_mix bật.
                studio_on = bool(project.get("studio_mix", True))
                fade_edges_fn = None
                if studio_on:
                    try:
                        from app.services.audio_mix_svc import fade_edges as _fe
                        fade_edges_fn = _fe
                    except Exception as e:
                        logger.warning("fade_edges import failed (%s) — TTS edges có thể click/pop", e)
                for seg in project["segments"]:
                    seg_audio_path = _segments_dir(project_id) / f"{seg['id']}.wav"
                    if not seg_audio_path.exists():
                        continue
                    seg_audio, _ = sf.read(str(seg_audio_path), dtype="float32")
                    if fade_edges_fn is not None:
                        seg_audio = fade_edges_fn(seg_audio, sr, fade_ms=30.0)
                    start_sample = int(seg["start"] * sr)
                    end_sample = start_sample + len(seg_audio)
                    end_sample = min(end_sample, total_samples)
                    seg_len = end_sample - start_sample
                    if seg_len > 0:
                        full_audio[start_sample:end_sample] += seg_audio[:seg_len]
                logger.info("Export built full_audio from %d individual segment files",
                            len(project["segments"]))
                # Master bus chain cho per-segment path (Vox Premium) — Edge
                # path đã apply trong _generate_all_batched. Skip nếu user tắt.
                if studio_on:
                    try:
                        from pedalboard import Pedalboard, Compressor, Limiter
                        master_chain = Pedalboard([
                            Compressor(threshold_db=-14, ratio=2.0, attack_ms=20, release_ms=300),
                            Limiter(threshold_db=-1.0, release_ms=100),
                        ])
                        full_audio = master_chain(full_audio.astype(np.float32), sr)
                        logger.info("Master bus chain applied (per-segment path)")
                    except Exception as e:
                        logger.warning("Master chain failed in per-segment path: %s", e)

            # ── Mix accompaniment (nhạc nền + SFX, đã loại giọng) ──
            # CHỈ dùng accompaniment.wav (đã loại giọng qua Demucs).
            # KHÔNG fallback dùng original_audio.wav — file đó chứa cả giọng
            # người gốc, sẽ kéo tiếng gốc vào mix dù user đã tắt
            # "Giữ giọng gốc". Nếu accompaniment.wav không có (Demucs fail)
            # → skip block này, log warning để user biết.
            if keep_accomp:
                accomp_path = pdir / "accompaniment.wav"
                if not accomp_path.exists():
                    logger.warning(
                        "keep_accompaniment=True nhưng accompaniment.wav không có "
                        "(Demucs chưa chạy hoặc fail) — SKIP mix BGM. "
                        "KHÔNG fallback original_audio.wav để tránh kéo giọng gốc vào mix."
                    )
                else:
                    bg_audio, bg_sr = sf.read(str(accomp_path), dtype="float32")
                    if len(bg_audio) != total_samples:
                        from scipy.signal import resample
                        bg_audio = resample(bg_audio, total_samples).astype(np.float32)

                    if enable_ducking:
                        # Pro mix: voice EQ + sidechain compressor + LUFS normalize.
                        used_pro = False
                        if use_pro_mix:
                            try:
                                from app.services.audio_mix_svc import pro_mix
                                logger.info(
                                    "Applying PRO audio mix (LUFS=%.1f, bgm_vol=%.2f)",
                                    target_lufs, accomp_vol,
                                )
                                bg_mono = bg_audio.mean(axis=1) if bg_audio.ndim > 1 else bg_audio
                                # Convert linear vol (0-1) → dB gain. Vol=1.0 → 0dB,
                                # vol=0.5 → -6dB, vol=0.1 → -20dB. Floor ở -40dB.
                                import math
                                bgm_gain_db = 20.0 * math.log10(max(accomp_vol, 0.01))
                                full_audio = pro_mix(
                                    voice=full_audio,
                                    bgm=bg_mono,
                                    sr=sr,
                                    bgm_gain_db=bgm_gain_db,
                                    target_lufs=target_lufs,
                                )
                                used_pro = True
                            except TypeError:
                                # pro_mix signature cũ không nhận bgm_gain_db
                                logger.warning("pro_mix legacy signature — bgm_gain_db ignored")
                                try:
                                    full_audio = pro_mix(
                                        voice=full_audio,
                                        bgm=bg_mono,
                                        sr=sr,
                                        target_lufs=target_lufs,
                                    )
                                    used_pro = True
                                except Exception as e:
                                    logger.warning("Pro mix failed: %s", e)
                            except Exception as e:
                                logger.warning("Pro mix failed, falling back to envelope ducking: %s", e)

                        if not used_pro:
                            logger.info("Applying legacy audio ducking (level=%.2f, vol=%.2f)",
                                        duck_level, accomp_vol)
                            full_audio = _apply_ducking(
                                bg_audio * accomp_vol, full_audio, sr,
                                duck_level=duck_level,
                                attack=duck_attack,
                                release=duck_release,
                            )
                    else:
                        mix_len = min(len(full_audio), len(bg_audio))
                        full_audio[:mix_len] += bg_audio[:mix_len] * accomp_vol

            # ── Mix vocals (giọng người gốc, đã tách qua Demucs) — KHÔNG ducking ──
            if keep_vocals:
                vocals_path = pdir / "vocals.wav"
                if vocals_path.exists():
                    voc_audio, voc_sr = sf.read(str(vocals_path), dtype="float32")
                    if voc_audio.ndim > 1:
                        voc_audio = voc_audio.mean(axis=1)
                    if voc_sr != sr:
                        from scipy.signal import resample
                        voc_audio = resample(voc_audio, int(len(voc_audio) * sr / voc_sr)).astype(np.float32)
                    mix_len = min(len(full_audio), len(voc_audio))
                    full_audio[:mix_len] += voc_audio[:mix_len] * vocals_vol
                    logger.info("Mixed original vocals at vol=%.2f (%.1fs)", vocals_vol, mix_len / sr)
                else:
                    logger.warning("keep_original_voice=True but vocals.wav not found")

            dubbed_audio_path = pdir / "dubbed_audio.wav"
            sf.write(str(dubbed_audio_path), full_audio, sr)

        # ── Step 2: Generate ASS subtitle if enabled ──
        ass_path = None
        if do_subtitle:
            generate_ass(project_id, use_translated=True)
            ass_path = pdir / "subtitles.ass"

        # ── Step 3: Build ffmpeg command with trim + crop ──
        has_trim = trim_s > 0 or trim_e < project["video_duration"]
        input_kwargs = {}
        if has_trim:
            input_kwargs["ss"] = trim_s
            input_kwargs["to"] = trim_e
        video_in = ffmpeg.input(str(video_path), **input_kwargs)

        # Build crop / letterbox filter for aspect ratio
        crop_ratios = {"16:9": (16, 9), "9:16": (9, 16), "4:5": (4, 5), "1:1": (1, 1),
                       "16:9w": (16, 9)}
        needs_crop = aspect_ratio in crop_ratios
        needs_encode = needs_crop or do_subtitle  # crop/subtitle requires re-encode

        def apply_video_filters(stream):
            """Apply crop/letterbox + subtitle filters to video stream."""
            if needs_crop:
                tw, th = crop_ratios[aspect_ratio]
                if crop_mode == "letterbox":
                    # Giữ full video, thêm viền đen để đạt aspect đích
                    # Output W = max(iw, ih*tw/th), H = max(ih, iw*th/tw)
                    # KHÔNG escape commas trong expression — ffmpeg-python tự
                    # quote/escape khi compile thành -filter_complex.
                    stream = stream.filter(
                        "scale",
                        f"if(gt(a,{tw}/{th}),iw,ih*{tw}/{th})",
                        f"if(gt(a,{tw}/{th}),iw*{th}/{tw},ih)",
                        force_original_aspect_ratio="decrease",
                    ).filter(
                        "pad",
                        f"if(gt(a,{tw}/{th}),iw,ih*{tw}/{th})",
                        f"if(gt(a,{tw}/{th}),iw*{th}/{tw},ih)",
                        "(ow-iw)/2", "(oh-ih)/2", "black",
                    )
                else:
                    # smart (TODO ML detect chủ thể) + center fallback = center crop
                    stream = stream.filter(
                        "crop",
                        f"min(iw,ih*{tw}/{th})", f"min(ih,iw*{th}/{tw})",
                        f"(iw-min(iw,ih*{tw}/{th}))/2", f"(ih-min(ih,iw*{th}/{tw}))/2",
                    )
            if do_subtitle and ass_path:
                stream = stream.filter("ass", str(ass_path))
            return stream

        # Audio input
        if do_dubbing and dubbed_audio_path:
            # Trim the dubbed audio too
            audio_kwargs = {}
            if has_trim:
                audio_kwargs["ss"] = trim_s
                audio_kwargs["to"] = trim_e
            audio_in = ffmpeg.input(str(dubbed_audio_path), **audio_kwargs)
            audio_stream = audio_in.audio
        else:
            audio_stream = video_in.audio

        if do_dubbing or do_subtitle or needs_crop:
            video_stream = apply_video_filters(video_in.video)
            vcodec = "libx264" if needs_encode else "copy"
            (
                ffmpeg
                .output(video_stream, audio_stream, str(export_path),
                        vcodec=vcodec, acodec="aac", strict="experimental")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
        elif has_trim:
            # Trim only, no other processing
            (
                ffmpeg
                .output(video_in.video, video_in.audio, str(export_path),
                        vcodec="copy", acodec="copy")
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
        else:
            raise ValueError("No dubbing, subtitle, crop, or trim enabled")

    except ffmpeg.Error as e:
        # ffmpeg-python với capture_stderr=True trả stderr trong e.stderr (bytes).
        # Không log = không thể debug (như vụ export.mp4 0-byte).
        stderr_text = ""
        try:
            stderr_text = (e.stderr or b"").decode("utf-8", errors="replace")
        except Exception:
            stderr_text = repr(e.stderr)
        logger.error("ffmpeg export failed for project %s:\nSTDERR:\n%s", project_id, stderr_text)
        project["status"] = "error"
        project["error"] = (stderr_text or str(e))[-2000:]
        _save_meta(project)
        # Tail stderr ngắn cho user (thường dòng cuối là error message thực)
        tail = stderr_text.strip().splitlines()[-3:] if stderr_text else []
        msg = "\n".join(tail) if tail else str(e)
        raise ValueError(f"Export failed: {msg}")

    project["status"] = "done"
    _save_meta(project)
    logger.info("Exported video: %s (dubbing=%s, subtitle=%s)", export_path, do_dubbing, do_subtitle)
    return str(export_path)


# ── Subtitle Generation ────────────────────────────

def _hex_to_ass_color(hex_color: str, opacity: float = 1.0) -> str:
    """Convert #RRGGBB + opacity to ASS color &HAABBGGRR."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    a = int((1 - opacity) * 255)
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"


def generate_srt(project_id: str, use_translated: bool = True) -> str:
    """Generate SRT subtitle content."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    lines = []
    sub_cues: list[dict] = []
    for seg in project["segments"]:
        sub_cues.extend(_split_segment_for_subtitle(seg, max_chars=50, use_translated=use_translated))
    sub_cues = _normalize_subtitle_cues(
        sub_cues,
        video_duration=float(project.get("video_duration") or 0.0) or None,
    )
    for i, seg in enumerate(sub_cues):
        text = seg["translated_text"] if use_translated and seg["translated_text"].strip() else seg["original_text"]
        if not text.strip():
            continue
        start = _fmt_time(seg["start"]).replace(".", ",")
        end = _fmt_time(seg["end"]).replace(".", ",")
        lines.append(f"{i + 1}")
        lines.append(f"{start} --> {end}")
        lines.append(text.strip())
        lines.append("")

    content = "\n".join(lines)
    srt_path = _project_dir(project_id) / "subtitles.srt"
    srt_path.write_text(content, encoding="utf-8")
    return content


def generate_vtt(project_id: str, use_translated: bool = True) -> str:
    """Generate WebVTT subtitle content."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    lines = ["WEBVTT", ""]
    sub_cues: list[dict] = []
    for seg in project["segments"]:
        sub_cues.extend(_split_segment_for_subtitle(seg, max_chars=50, use_translated=use_translated))
    sub_cues = _normalize_subtitle_cues(
        sub_cues,
        video_duration=float(project.get("video_duration") or 0.0) or None,
    )
    for seg in sub_cues:
        text = seg["translated_text"] if use_translated and seg["translated_text"].strip() else seg["original_text"]
        if not text.strip():
            continue
        start = _fmt_time(seg["start"])
        end = _fmt_time(seg["end"])
        lines.append(f"{start} --> {end}")
        lines.append(text.strip())
        lines.append("")

    content = "\n".join(lines)
    vtt_path = _project_dir(project_id) / "subtitles.vtt"
    vtt_path.write_text(content, encoding="utf-8")
    return content


def _is_name_word(w: str) -> bool:
    """Word khởi đầu bằng chữ hoa = ứng viên 1 phần của tên riêng.
    Hán-Việt names: "Diệp", "Thần", "Tiểu", "Bảo", "Lâm", "Tòng", "An"…
    Vietnamese capitalization: chỉ trigger với từ thuần chữ cái."""
    if not w:
        return False
    first = w[0]
    return first.isupper() and first.isalpha() and w.isalpha()


def _split_at_safe_space(cue: str, max_chars: int) -> tuple[str, str]:
    """Chia 1 chuỗi tại space, ưu tiên:
    1. Space gần max_chars nhất (không vượt)
    2. Tránh chia giữa 2 từ chữ hoa liên tiếp (= tên riêng kiểu "Diệp Thần")

    Trả về (left, rest). Nếu không có space nào an toàn → vượt budget
    để giữ tên nguyên vẹn.
    """
    spaces = [i for i, ch in enumerate(cue) if ch == " "]
    if not spaces:
        return cue, ""

    def is_name_split(pos: int) -> bool:
        """True nếu chia tại pos sẽ cắt giữa 2 từ tạo thành tên riêng."""
        left = cue[:pos].rstrip()
        right = cue[pos + 1:].lstrip()
        if not left or not right:
            return False
        left_tail = left.rsplit(None, 1)[-1] if " " in left else left
        right_head = right.split(None, 1)[0]
        return _is_name_word(left_tail) and _is_name_word(right_head)

    safe_within = [sp for sp in spaces if sp <= max_chars and not is_name_split(sp)]
    if safe_within:
        best = safe_within[-1]
        return cue[:best].strip(), cue[best + 1:].strip()

    # Không có space an toàn trong budget — chấp nhận vượt budget để bảo vệ tên.
    safe_after = [sp for sp in spaces if not is_name_split(sp)]
    if safe_after:
        best = safe_after[0]
        return cue[:best].strip(), cue[best + 1:].strip()

    # Toàn space đều cắt tên → fallback chia gần max_chars nhất (cuối cùng đành chịu)
    best = max(spaces, key=lambda sp: -abs(sp - max_chars))
    return cue[:best].strip(), cue[best + 1:].strip()


def _split_text_for_subtitle(text: str, max_chars: int = 50) -> list[str]:
    """Chia 1 đoạn text dài thành nhiều subtitle cues ≤ max_chars.

    Mục tiêu: hiển thị 1 dòng (~50 chars). Ưu tiên chia tại:
    1. Sentence-end (.!?…)
    2. Comma/semicolon
    3. Space gần max_chars nhất — KHÔNG cắt giữa tên riêng kiểu "Diệp Thần"

    Nếu cue vẫn vượt max_chars vì có tên dài → chấp nhận vượt budget,
    không cắt ngang tên.
    """
    text = text.strip()
    if len(text) <= max_chars:
        return [text]

    import re
    # Split tại sentence-end punctuation, giữ punctuation đi với phần trước
    sent_pattern = re.compile(r'([.!?…。！？]+["\')\]]?)\s+')
    parts = sent_pattern.split(text)
    sentences: list[str] = []
    if len(parts) > 1:
        i = 0
        while i < len(parts):
            sent = parts[i]
            sep = parts[i + 1] if i + 1 < len(parts) else ""
            full = (sent + sep).strip()
            if full:
                sentences.append(full)
            i += 2
    else:
        sentences = [text]

    # Gom các sentence ngắn lại đến gần max_chars
    cues: list[str] = []
    cur = ""
    for sent in sentences:
        if not cur:
            cur = sent
            continue
        candidate = cur + " " + sent
        if len(candidate) <= max_chars:
            cur = candidate
        else:
            cues.append(cur)
            cur = sent
    if cur:
        cues.append(cur)

    # Pass 2: nếu còn cue > max_chars → chia tại comma/semicolon trước, space sau
    final: list[str] = []
    for cue in cues:
        if len(cue) <= max_chars:
            final.append(cue)
            continue
        # Chia tại comma/semicolon
        sub_parts = re.split(r'(,|，|;|；)\s+', cue)
        if len(sub_parts) > 1:
            buf = ""
            i = 0
            while i < len(sub_parts):
                piece = sub_parts[i]
                sep = sub_parts[i + 1] if i + 1 < len(sub_parts) else ""
                seg_w_sep = (piece + sep).strip()
                cand = (buf + " " + seg_w_sep).strip() if buf else seg_w_sep
                if len(cand) <= max_chars:
                    buf = cand
                else:
                    if buf:
                        final.append(buf)
                    buf = seg_w_sep
                i += 2
            if buf:
                # buf có thể vẫn > max_chars → tiếp tục split bằng space-safe
                if len(buf) > max_chars:
                    while len(buf) > max_chars:
                        left, rest = _split_at_safe_space(buf, max_chars)
                        if not left or left == buf:
                            break
                        final.append(left)
                        buf = rest
                    if buf:
                        final.append(buf)
                else:
                    final.append(buf)
        else:
            # Không có comma → chia tại space-safe (không cắt tên)
            buf = cue
            while len(buf) > max_chars:
                left, rest = _split_at_safe_space(buf, max_chars)
                if not left or left == buf:
                    break
                final.append(left)
                buf = rest
            if buf:
                final.append(buf)

    return [c for c in final if c.strip()]


def _valid_word_times(seg: dict) -> list[dict]:
    words = []
    seg_start = float(seg.get("start", 0.0) or 0.0)
    seg_end = float(seg.get("end", seg_start) or seg_start)
    for w in seg.get("words") or []:
        if w.get("start") is None or w.get("end") is None:
            continue
        start = float(w.get("start") or 0.0)
        end = float(w.get("end") or 0.0)
        if end <= start:
            continue
        if end < seg_start - 0.2 or start > seg_end + 0.2:
            continue
        words.append({
            "word": w.get("word") or w.get("text") or "",
            "start": start,
            "end": end,
            "score": w.get("score") or w.get("probability") or 0.0,
        })
    return sorted(words, key=lambda item: item["start"])


def _timed_ranges_for_chunks(seg: dict, chunks: list[str]) -> list[tuple[float, float, list[dict]]]:
    """Map subtitle chunks vào timeline. Ưu tiên word timestamps thật."""
    seg_start = float(seg.get("start", 0.0) or 0.0)
    seg_end = float(seg.get("end", seg_start) or seg_start)
    duration = max(0.05, seg_end - seg_start)
    if len(chunks) <= 1:
        return [(seg_start, seg_end, _valid_word_times(seg))]

    words = _valid_word_times(seg)
    if len(words) >= len(chunks):
        weights = [max(1, len(str(w.get("word") or "").strip())) for w in words]
        total_weight = sum(weights) or len(words)
        total_units = sum(max(1, len(c)) for c in chunks) or len(chunks)
        cum_weights = []
        cursor = 0
        for weight in weights:
            cursor += weight
            cum_weights.append(cursor)

        ranges: list[tuple[float, float, list[dict]]] = []
        start_idx = 0
        used_units = 0
        prev_end = seg_start
        for i, chunk in enumerate(chunks):
            used_units += max(1, len(chunk))
            if i == len(chunks) - 1:
                end_idx = len(words) - 1
            else:
                target = total_weight * (used_units / total_units)
                end_idx = start_idx
                while end_idx < len(words) - 1 and cum_weights[end_idx] < target:
                    end_idx += 1
                # Giữ tối thiểu 1 word cho mỗi cue còn lại.
                max_end = len(words) - (len(chunks) - i)
                end_idx = min(max(end_idx, start_idx), max_end)
            chunk_words = words[start_idx:end_idx + 1]
            start = max(seg_start, chunk_words[0]["start"]) if i == 0 else max(prev_end, chunk_words[0]["start"])
            end = min(seg_end, chunk_words[-1]["end"])
            if end <= start:
                frac_start = sum(max(1, len(c)) for c in chunks[:i]) / total_units
                frac_end = used_units / total_units
                start = seg_start + frac_start * duration
                end = seg_start + frac_end * duration
            ranges.append((start, end, chunk_words))
            prev_end = end
            start_idx = min(end_idx + 1, len(words) - 1)
        return ranges

    total_chars = sum(max(1, len(c)) for c in chunks) or len(chunks)
    ranges = []
    acc_chars = 0
    for chunk in chunks:
        cue_start = seg_start + (acc_chars / total_chars) * duration
        acc_chars += max(1, len(chunk))
        cue_end = seg_start + (acc_chars / total_chars) * duration
        ranges.append((cue_start, cue_end, []))
    return ranges


def _normalize_subtitle_cues(
    cues: list[dict],
    video_duration: float | None = None,
    min_duration: float = 0.35,
    gap: float = 0.02,
) -> list[dict]:
    out: list[dict] = []
    for cue in sorted(cues, key=lambda c: float(c.get("start", 0.0) or 0.0)):
        start = max(0.0, float(cue.get("start", 0.0) or 0.0))
        end = max(start + 0.05, float(cue.get("end", start + min_duration) or start + min_duration))
        if out and start < out[-1]["end"] + gap:
            prev = out[-1]
            if start - prev["start"] >= min_duration:
                prev["end"] = round(max(prev["start"] + min_duration, start - gap), 3)
            start = max(start, prev["end"] + gap)
        if end < start + min_duration:
            end = start + min_duration
        if video_duration and video_duration > 0 and end > video_duration:
            end = video_duration
            if start >= end:
                start = max(0.0, end - min_duration)
        clean = dict(cue)
        clean["start"] = round(start, 3)
        clean["end"] = round(max(start + 0.05, end), 3)
        out.append(clean)
    return out


def _split_segment_for_subtitle(
    seg: dict,
    max_chars: int = 50,
    use_translated: bool = True,
) -> list[dict]:
    """Split 1 segment thành nhiều subtitle cues, ưu tiên word-level timing."""
    text = (
        seg.get("translated_text")
        if use_translated and (seg.get("translated_text") or "").strip()
        else seg.get("original_text")
    ) or ""
    text = text.strip()
    if not text:
        return []
    cues_text = _split_text_for_subtitle(text, max_chars)
    if len(cues_text) <= 1:
        cue = dict(seg)
        cue["translated_text"] = text
        cue["original_text"] = text
        return [cue]

    out = []
    for ctxt, (cue_start, cue_end, cue_words) in zip(cues_text, _timed_ranges_for_chunks(seg, cues_text)):
        cue = dict(seg)
        cue["start"] = cue_start
        cue["end"] = cue_end
        cue["translated_text"] = ctxt
        cue["original_text"] = ctxt  # subtitle dùng text đã chia
        cue["words"] = cue_words
        out.append(cue)
    return out


def _pick_subtitle_font(target_lang: str, user_font: str) -> str:
    """Auto-pick font theo ngôn ngữ đích — tránh hiện □□□ cho CJK/Thai/etc.

    User config "Arial" mặc định không có Hangul/Hiragana/Han glyph →
    libass render □ chữ bị hỏng. Map ngôn ngữ sang font universal
    (Noto Sans CJK / Noto Sans) đã cài sẵn trên pod.

    Nếu user explicit pick font khác Arial → respect (assume họ biết
    font đó có support glyph cần thiết).
    """
    if user_font and user_font.lower() not in ("arial", "default", ""):
        return user_font  # user explicit choice — keep

    lang = (target_lang or "").lower().strip()
    cjk_map = {
        "korean": "Noto Sans CJK KR",
        "ko": "Noto Sans CJK KR",
        "japanese": "Noto Sans CJK JP",
        "ja": "Noto Sans CJK JP",
        "jp": "Noto Sans CJK JP",
        "chinese": "Noto Sans CJK SC",
        "zh": "Noto Sans CJK SC",
        "zh_cn": "Noto Sans CJK SC",
        "zh_tw": "Noto Sans CJK TC",
        "thai": "Noto Sans Thai",
        "th": "Noto Sans Thai",
        "arabic": "Noto Sans Arabic",
        "ar": "Noto Sans Arabic",
        "hindi": "Noto Sans Devanagari",
        "hi": "Noto Sans Devanagari",
    }
    return cjk_map.get(lang, "Noto Sans")  # default Noto Sans hỗ trợ Latin+Cyrillic+VN


def generate_ass(project_id: str, use_translated: bool = True) -> str:
    """Generate ASS subtitle with styling."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    style = project.get("subtitle_style", {})
    user_font = style.get("font_family", "Arial")
    target_lang = project.get("target_language", "vi")
    font = _pick_subtitle_font(target_lang, user_font)
    size = style.get("font_size", 24)
    bold = -1 if style.get("font_bold", False) else 0
    italic = -1 if style.get("font_italic", False) else 0
    primary_color = _hex_to_ass_color(style.get("font_color", "#FFFFFF"))
    outline_color = _hex_to_ass_color(style.get("outline_color", "#000000"))
    bg_opacity = style.get("bg_opacity", 0.6)
    back_color = _hex_to_ass_color(style.get("bg_color", "#000000"), bg_opacity)
    outline_w = style.get("outline_width", 2)
    shadow = style.get("shadow_offset", 1)
    margin_v = style.get("margin_v", 30)

    # BorderStyle=3 (opaque box) khi user muốn nền mờ, khớp với CSS preview.
    # BorderStyle=1 (outline+shadow) khi không có nền.
    border_style = 3 if bg_opacity > 0.01 else 1

    # Khi có nền (BorderStyle=3), tham số Outline không còn là độ rộng stroke
    # mà là padding của hộp nền quanh chữ. Preview CSS dùng padding ~0.2em
    # trên/dưới → quy đổi sang px theo font size để ASS render giống hệt.
    if border_style == 3:
        outline_w = max(2, round(size * 0.22))

    # Alignment: bottom=2, top=8, center=5
    alignment = {"bottom": 2, "top": 8, "center": 5}.get(style.get("position", "bottom"), 2)

    # PlayRes phải khớp độ phân giải video thật để Fontsize/MarginV giống preview.
    video_w, video_h = 1920, 1080
    try:
        probe = ffmpeg.probe(str(_project_dir(project_id) / "original.mp4"))
        for s in probe.get("streams", []):
            if s.get("codec_type") == "video":
                video_w = int(s.get("width") or 1920)
                video_h = int(s.get("height") or 1080)
                break
    except Exception as e:
        logger.warning("ffprobe for ASS PlayRes failed: %s", e)

    header = f"""[Script Info]
Title: VoxStudio Subtitles
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},{italic},0,0,100,100,0,0,{border_style},{outline_w},{shadow},{alignment},20,20,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    # Custom overrides — drag position, rotation từ preview
    cx = style.get("custom_x")
    cy = style.get("custom_y")
    rot_val = float(style.get("rotation", 0.0) or 0.0)
    max_width_pct = style.get("max_width_pct")

    overrides = ""
    if cx is not None and cy is not None:
        px = round(cx / 100 * video_w, 1)
        py = round(cy / 100 * video_h, 1)
        overrides += f"\\pos({px},{py})"
    if abs(rot_val) > 0.1:
        overrides += f"\\frz{round(-rot_val, 1)}"  # ASS xoay ngược chiều CSS

    # MarginL/R per-dialogue để wrap text theo max_width_pct
    if isinstance(max_width_pct, (int, float)) and 10 <= max_width_pct <= 100:
        margin_side = int(round(video_w * (1 - max_width_pct / 100) / 2))
    else:
        margin_side = 0  # 0 = dùng Style default (20)

    # Animation prefix tags
    anim = (style.get("animation") or project.get("animation") or "none").lower()
    anim_tag = ""
    if anim == "fade":
        anim_tag = "\\fad(200,200)"
    elif anim == "slide":
        anim_tag = "\\move(0,30,0,0,0,200)"  # slide up nhẹ vào đầu

    # Dynamic font size — co chữ khi câu quá dài, tránh tràn dòng
    auto_font = bool(project.get("auto_font_size", False))
    def _size_tag_for(t):
        if not auto_font:
            return ""
        n = len(t)
        if n <= 60:
            return ""
        # 60→1.0, 90→0.85, 120→0.7, >150→0.6
        scale = max(0.6, 1.0 - (n - 60) / 200.0)
        return f"\\fs{int(round(size * scale))}"

    # Highlight từ khoá — wrap word matches với màu vàng
    raw_kw = (project.get("highlight_keywords") or "").strip()
    keywords = [w.strip() for w in raw_kw.split(",") if w.strip()] if raw_kw else []
    hl_color = "&H0000F2FF&"  # ASS BGR vàng đậm

    def _apply_highlight(t):
        if not keywords:
            return t
        out = t
        for kw in keywords:
            if not kw:
                continue
            # Wrap không phân biệt hoa thường
            import re
            pattern = re.compile(re.escape(kw), re.IGNORECASE)
            out = pattern.sub(lambda m: f"{{\\c{hl_color}}}{m.group(0)}{{\\r}}", out)
        return out

    # Pre-split long merged segments thành cues subtitle ≤ 50 chars (1 dòng).
    # _split_at_safe_space sẽ bảo vệ tên riêng đa từ ("Diệp Thần"…) khỏi bị
    # cắt giữa, kể cả khi phải vượt budget vài chars.
    sub_cues: list[dict] = []
    for seg in project["segments"]:
        s_text = (seg.get("translated_text") if use_translated else "") or seg.get("original_text") or ""
        if not s_text.strip():
            continue
        sub_cues.extend(_split_segment_for_subtitle(seg, max_chars=50, use_translated=use_translated))
    sub_cues = _normalize_subtitle_cues(
        sub_cues,
        video_duration=float(project.get("video_duration") or 0.0) or None,
    )

    for seg in sub_cues:
        text = seg["translated_text"] if use_translated and seg["translated_text"].strip() else seg["original_text"]
        if not text.strip():
            continue
        start = _fmt_time(seg["start"])
        end = _fmt_time(seg["end"])
        start_ass = start[1:]
        end_ass = end[1:]
        clean_text = text.strip().replace("\n", "\\N")
        clean_text = _apply_highlight(clean_text)
        # Tổng hợp tag override: position + rotation + animation + auto-fontsize
        seg_overrides = overrides + anim_tag + _size_tag_for(text)
        seg_tag = ("{" + seg_overrides + "}") if seg_overrides else ""
        events.append(
            f"Dialogue: 0,{start_ass},{end_ass},Default,,{margin_side},{margin_side},0,,{seg_tag}{clean_text}"
        )

    content = header + "\n".join(events) + "\n"
    ass_path = _project_dir(project_id) / "subtitles.ass"
    ass_path.write_text(content, encoding="utf-8")
    return content


def update_subtitle_style(project_id: str, style: dict) -> dict:
    """Update subtitle styling."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")
    project["subtitle_style"] = {**project.get("subtitle_style", {}), **style}
    _save_meta(project)
    return project


def update_project_settings(project_id: str, settings: dict) -> dict:
    """Update project toggles/settings."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")
    allowed = {
        "enable_dubbing", "enable_subtitle",
        "target_language", "voice_id", "source_language_input",
        "tts_engine", "edge_voice",
        "aspect_ratio", "trim_start", "trim_end",
        # Mix audio — 2 luồng riêng:
        #  · accompaniment (nhạc nền/SFX) — default ON
        #  · vocals (giọng người gốc) — default OFF (tránh đụng giọng dub)
        "keep_accompaniment", "accompaniment_volume",
        "keep_original_voice", "original_voice_volume",
        # Backward compat — flag cũ, vẫn đọc nếu set
        "keep_original_audio", "original_audio_volume",
        # Crop mode — apply trong ffmpeg ở export_video
        "crop_mode",
        # Cảm xúc mặc định — fallback khi LLM không set
        "default_emotion",
        # Auto features
        "auto_font_size", "auto_pace", "smart_chunk", "highlight_keywords",
        # Translate engine — không lưu api_key (chỉ truyền theo từng job)
        "translate_engine",
        # Topic hint + glossary để cải thiện chất lượng dịch
        "topic_hint", "glossary",
        # Multi-voice Premium: số giọng + voice_id cho từng slot.
        # voice_count: int 1-5. voice_slots: list[str] (voice_id hoặc "" = default).
        # Backend map speaker (theo gender từ diarization) → slot khi generate.
        "voice_count", "voice_slots",
        # Chất lượng pipeline: "fast" (default) | "high"
        # high → bật WhisperX + pyannote (nếu có HF_TOKEN), word-level align
        # chính xác hơn ~20ms (vs ~200ms), nam/nữ chính xác hơn. Chậm ~2x.
        "quality_mode",
        # Studio mixing on/off — apply pedalboard chain (gender EQ +
        # de-esser + loudness norm + master glue/limiter) per batch.
        # Default ON cho voice quality phòng thu. Tắt cho output raw.
        "studio_mix",
        # Music/singing filter — lọc segment hát/nhạc trước khi dub.
        # Default ON cho video có nhạc nền + lời hát.
        "filter_music",
        # Film genre — inject context-specific prompts vào LLM dịch
        # Values: drama, romance, action, comedy, historical, crime, family,
        # horror, anime, documentary, kpop_drama, cdrama, wuxia, auto
        "film_genre",
        # Visual context (Pass-(-1)) — bật VLM analyze keyframe trước translate.
        # BYOK. enable_visual_context = toggle; visual_engine = gemini/openai/claude;
        # visual_model = optional override.
        "enable_visual_context", "visual_engine", "visual_model",
        # STT input source: True (default) = vocals.wav đã tách (sạch nhạc,
        # chuẩn hơn); False = audio gốc (bắt được whisper/voice nhỏ).
        "whisper_use_vocals",
    }
    nullable = {"edge_voice", "voice_id", "default_emotion", "topic_hint", "glossary",
                 "visual_engine", "visual_model"}
    for k, v in settings.items():
        if k in allowed and (v is not None or k in nullable):
            project[k] = v
    # Allow restoring segments (for undo/redo)
    if "segments" in settings and isinstance(settings["segments"], list):
        project["segments"] = settings["segments"]
    _save_meta(project)
    return project


def get_subtitle_path(project_id: str, fmt: str = "srt") -> Path | None:
    path = _project_dir(project_id) / f"subtitles.{fmt}"
    return path if path.exists() else None


def get_dubbed_track_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "dubbed_track.wav"
    return path if path.exists() else None


def get_export_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "export.mp4"
    return path if path.exists() else None


def get_video_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "original.mp4"
    return path if path.exists() else None


def get_thumbnail_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "thumbnail.jpg"
    return path if path.exists() else None


# ── Auto-Dub Pipeline ─────────────────────────────

def _chunk_sentences_timed(text: str):
    """Chia text dài thành các câu CON, giữ NGUYÊN câu/ý nếu đủ ngắn.

    Triết lý:
    - Câu hoàn chỉnh (. ! ? …) luôn là 1 chunk độc lập, KHÔNG cắt.
    - Chỉ chia thêm khi câu quá DÀI (> CHUNK_MAX chars).
    - Khi chia: ưu tiên ranh giới mệnh đề (, ;), KHÔNG bao giờ cắt giữa từ/tên.
    - Fallback cuối: KHÔNG slice theo số ký tự — giữ nguyên thay vì cắt từ.
    """
    import re
    CHUNK_MAX = 80          # Mỗi chunk tối đa ~80 ký tự (≈ 1 câu Việt vừa)
    SHORT_OK = 100          # Nếu câu < 100 chars → giữ nguyên (không chia)

    # Split theo câu hoàn chỉnh — ranh giới chắc chắn (dấu kết câu)
    sents = [s.strip() for s in re.split(r'(?<=[.!?。！？…])\s+|\n+', text) if s.strip()]
    out: list[str] = []

    for s in sents:
        # Câu ngắn/vừa → giữ nguyên, KHÔNG cắt
        if len(s) <= SHORT_OK:
            out.append(s)
            continue

        # Câu quá dài → chia theo clauses (dấu phẩy/chấm phẩy/dash)
        clauses = [c.strip() for c in re.split(r'(?<=[,;—–])\s+', s) if c.strip()]
        if len(clauses) <= 1:
            # Không có dấu phẩy nào → đành giữ nguyên (KHÔNG cắt giữa từ/tên)
            out.append(s)
            continue

        # Gom clauses lại thành chunks ≤ CHUNK_MAX, không cắt giữa clause
        buf = ""
        for c in clauses:
            if not buf:
                buf = c
            elif len(buf) + len(c) + 2 <= CHUNK_MAX:
                buf = buf + ", " + c
            else:
                out.append(buf)
                buf = c
        if buf:
            out.append(buf)

    return out if out else [text]


def auto_chunk_project_segments(project_id: str) -> dict:
    """Tách mỗi segment thành nhiều sub-segment theo CÂU, time chia tỷ lệ
    độ dài ký tự. Gọi sau translate_project. Mỗi câu nhỏ = 1 segment backend
    riêng → export sẽ burn từng câu đúng khoảng thời gian của riêng nó."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")
    new_segments = []
    for seg in project.get("segments", []):
        text = (seg.get("translated_text") or "").strip()
        chunks = _chunk_sentences_timed(text) if text else []
        if len(chunks) <= 1:
            new_segments.append(seg)
            continue
        timed_ranges = _timed_ranges_for_chunks(seg, chunks)
        for i, (ch, (sub_start, sub_end, cue_words)) in enumerate(zip(chunks, timed_ranges)):
            source_chunk = "".join(w.get("word", "") for w in cue_words).strip()
            new_segments.append({
                **seg,
                "id": uuid.uuid4().hex[:8],
                "start": round(sub_start, 2),
                "end": round(sub_end, 2),
                "original_text": source_chunk or seg.get("original_text", ""),
                "translated_text": ch,
                "speech_text": ch,
                "words": cue_words,
                # Reset TTS status vì text thay đổi
                "status": "pending",
            })
    for i, s in enumerate(new_segments):
        s["index"] = i
    project["segments"] = new_segments
    _save_meta(project)
    logger.info("Auto-chunked segments → %d sub-segments", len(new_segments))
    return project


def _run_step_with_progress(func, args, kwargs, start_pct, end_pct, label,
                             estimated_sec=30, hard_timeout_sec=None):
    """Chạy `func(*args, **kwargs)` trong 1 thread, vừa chạy vừa yield tick
    tiến trình. Có HARD TIMEOUT để tránh treo vô hạn.

    Args:
      hard_timeout_sec: nếu thread chạy quá X giây → raise TimeoutError.
                       Default 10x estimated_sec (vd estimate 30s → cap 300s).

    Returns: generator. Item cuối có `_result` hoặc `step=error`.
    """
    import threading, time
    box = {}
    def run():
        try:
            box["result"] = func(*args, **kwargs)
        except Exception as e:
            box["error"] = e
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    t0 = time.time()
    timeout_s = hard_timeout_sec if hard_timeout_sec else max(120, estimated_sec * 10)

    while thread.is_alive():
        elapsed = time.time() - t0

        # Hard timeout — fail fast thay vì treo
        if elapsed > timeout_s:
            box["error"] = TimeoutError(
                f"Phase '{label}' treo >{timeout_s}s — auto kill. "
                f"Có thể do API LLM hang, network issue, hoặc bug code.",
            )
            logger.error("Phase TIMEOUT: %s after %.0fs", label, elapsed)
            yield {"step": "error", "label": str(box["error"]), "progress": -1}
            return

        if estimated_sec > 0 and elapsed < estimated_sec:
            frac = elapsed / estimated_sec
        else:
            overshoot = elapsed - estimated_sec
            frac = 0.95 + 0.04 * (1 - 1 / (1 + overshoot / 10))
        frac = min(0.99, frac)
        cur = start_pct + (end_pct - start_pct) * frac
        yield {"step": "progress", "label": label, "progress": round(cur, 1)}
        time.sleep(0.25)
    thread.join()
    if "error" in box:
        yield {"step": "error", "label": str(box["error"]), "progress": -1}
        return
    yield {"step": "progress", "label": label, "progress": end_pct,
           "_result": box.get("result")}


# ── Cancellation registry ─────────────────────────────────────────────
# Client bấm huỷ → gọi request_cancel(project_id) → auto_dub kiểm tra
# giữa các bước + trong vòng lặp TTS và thoát sớm.
_cancel_flags: dict[str, threading.Event] = {}
_cancel_lock = threading.Lock()


def request_cancel(project_id: str) -> bool:
    """Báo cho pipeline đang chạy biết user muốn huỷ.

    No-op nếu không có pipeline đang chạy (auto_dub chưa register listener).
    Tránh tạo ghost Event tồn đọng trong _cancel_flags khi DELETE/cancel
    được gọi cho project không chạy.
    """
    with _cancel_lock:
        ev = _cancel_flags.get(project_id)
        if ev is None:
            return False
        ev.set()
    return True


def is_canceled(project_id: str) -> bool:
    with _cancel_lock:
        ev = _cancel_flags.get(project_id)
    return bool(ev and ev.is_set())


def _register_cancel(project_id: str):
    """Auto_dub gọi ở startup để register listener. Replace event cũ nếu có
    để không carry-over cancel từ run trước."""
    with _cancel_lock:
        _cancel_flags[project_id] = threading.Event()


def _reset_cancel(project_id: str):
    with _cancel_lock:
        _cancel_flags.pop(project_id, None)


class _Canceled(Exception):
    pass


def _mark_project_error(project_id: str, error_msg: str) -> None:
    """Set project.status = 'error' + project.error = msg. FE poll thấy
    status='error' → hiện thị "Thất bại" thay vì "đang chạy" giả lập.

    Idempotent: nếu meta đã missing hoặc status đã là done thì skip.
    """
    try:
        meta = _load_meta(project_id)
        if not meta:
            return
        if meta.get("status") == "done":
            return
        meta["status"] = "error"
        meta["error"] = (error_msg or "Pipeline thất bại")[:2000]
        _save_meta(meta)
        logger.info("[auto_dub] marked project=%s status=error: %s",
                    project_id, error_msg[:100])
    except Exception as e:
        logger.warning("Cannot mark project error: %s", e)


def auto_dub(
    project_id: str,
    engine: str = "google",
    api_key: str | None = None,
    enable_visual_context: bool = False,
    visual_engine: str | None = None,
    visual_model: str | None = None,
    visual_api_key: str | None = None,
):
    """Full pipeline: Demucs → Faster-Whisper → Translate → TTS → Export.

    Args:
        engine: translate engine — google_free / google_cloud / deepl /
                gemini / openai / claude / qwen.
        api_key: BYOK key cho engine cần.
        enable_visual_context: True → chạy Pass-(-1) VLM phân tích keyframe
                trước translate (nâng cao, +cost).
        visual_engine: gemini/openai/claude (BYOK).
        visual_model: optional, default = bản rẻ.
        visual_api_key: BYOK cho VLM.

    Yields progress updates as dicts for SSE streaming.
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    do_dubbing = project.get("enable_dubbing", True)
    do_subtitle = project.get("enable_subtitle", False)

    if not do_dubbing and not do_subtitle:
        msg = "Bật Lồng tiếng hoặc Phụ đề trước khi chạy."
        _mark_project_error(project_id, msg)
        yield {"step": "error", "label": msg, "progress": -1}
        return

    # Register listener huỷ — fresh Event, không carry-over từ run trước
    _register_cancel(project_id)

    def _check_cancel():
        if is_canceled(project_id):
            raise _Canceled()

    steps = [
        ("transcribing", "Đang nhận diện giọng nói gốc..."),
        ("translating", "Đang dịch thuật..."),
        ("generating_tts", "Đang chuyển giọng cho từng câu..."),
        ("exporting", "Đang ghép video + phụ đề + audio..."),
    ]

    # Tính range động: phân bổ % cho các bước sẽ chạy, tổng 0→100 mượt.
    # Trọng số (tương đối theo thời gian thực tế): transcribe 30, translate 15,
    # chunk 3, tts 40 (chỉ khi do_dubbing), export 12.
    weights = {
        "transcribe": 30,
        "translate": 15,
        "chunk": 3,
        "tts": 40 if do_dubbing else 0,
        "export": 12,
    }
    total_w = sum(weights.values())
    cursor = 0.0
    def _range(key):
        nonlocal cursor
        start = cursor
        cursor += (weights[key] / total_w) * 100
        return (round(start, 1), round(cursor, 1))
    r_trans  = _range("transcribe")
    r_transl = _range("translate")
    r_chunk  = _range("chunk")
    r_tts    = _range("tts") if weights["tts"] > 0 else None
    r_export = _range("export")

    try:
        _check_cancel()
        # Step 1: Transcribe
        for tick in _run_step_with_progress(
            transcribe_project, [project_id], {},
            start_pct=r_trans[0], end_pct=r_trans[1],
            label=steps[0][1], estimated_sec=45,
        ):
            _check_cancel()
            if tick.get("step") == "error":
                _mark_project_error(project_id, tick.get("label") or "Pipeline thất bại")
                yield tick
                return
            if "_result" not in tick:
                yield {"step": "transcribing", **{k: v for k, v in tick.items() if k != "step"}}

        _check_cancel()
        # Step 2: Translate — engine + key đến từ caller (worker payload).
        # Engine hợp lệ: google_free / google_cloud / deepl / gemini /
        # openai / claude / qwen. "google" là alias legacy.
        # Pre-translate: show user count info để biết đang đợi gì
        try:
            _proj = _load_meta(project_id)
            n_segs = len(_proj.get("segments", []))
            yield {
                "step": "translating",
                "label": f"Đang phân tích {n_segs} câu thoại + bối cảnh nhân vật...",
                "progress": r_transl[0],
            }
        except Exception:
            pass

        for tick in _run_step_with_progress(
            translate_project, [project_id],
            {
                "engine": engine or "google_free", "api_key": api_key,
                "enable_visual_context": enable_visual_context,
                "visual_engine": visual_engine,
                "visual_model": visual_model,
                "visual_api_key": visual_api_key,
            },
            start_pct=r_transl[0], end_pct=r_transl[1],
            label="Đang dịch + chuẩn hoá tên & xưng hô (đảm bảo nhất quán)...",
            estimated_sec=20,
            # Translate phase tổng = Pass-0 + N batches × thời gian/batch.
            # Phim 60-100 phút có 50-100 batches, dù chạy 4 concurrent thì
            # vẫn 25 waves × 90s = 37 phút. Cho 30 phút phase timeout
            # an toàn cho phim ≤ 90 phút. Phim siêu dài bypass timeout
            # qua hard_timeout_sec arg explicit.
            hard_timeout_sec=1800,
        ):
            if tick.get("step") == "error":
                _mark_project_error(project_id, tick.get("label") or "Pipeline thất bại")
                yield tick
                return
            if "_result" not in tick:
                yield {"step": "translating", **{k: v for k, v in tick.items() if k != "step"}}
        # Qwen rewrite: chỉ chạy khi engine KHÔNG phải LLM cloud.
        # LLM cloud (gemini/openai/claude/qwen) đã polish sẵn rồi → Qwen rewrite
        # thừa, tốn 5-6GB VRAM + thời gian + có thể làm tệ hơn.
        # Chỉ áp dụng cho engine google_free / google_cloud / deepl (non-LLM).
        eng_lower = (engine or "google_free").lower()
        is_llm_cloud_engine = eng_lower in ("gemini", "openai", "claude", "qwen")
        if IS_CUDA and not is_llm_cloud_engine:
            yield {"step": "translating", "label": "Đang tinh chỉnh lời thoại...", "progress": 42}
            try:
                project = _load_meta(project_id)
                translated = [seg.get("translated_text", "") for seg in project["segments"]]
                durations = [seg["end"] - seg["start"] for seg in project["segments"]]
                speaker_ids = [seg.get("speaker") for seg in project["segments"]]
                speaker_genders = project.get("speaker_genders", {})
                target_lang = project["target_language"]
                polished = llm_translate_svc.polish_for_speech(
                    translated, target_lang,
                    durations=durations,
                    speaker_ids=speaker_ids,
                    speaker_genders=speaker_genders,
                )
                for seg, result in zip(project["segments"], polished):
                    if result.get("speech_text"):
                        seg["speech_text"] = result["speech_text"]
                        seg["emotion"] = result.get("emotion", "neutral")
                _save_meta(project)
                logger.info("Qwen rewrote %d segments with duration + speaker context",
                            len(polished))
            except Exception as e:
                logger.warning("Qwen rewrite failed, using Google Translate only: %s", e)
            finally:
                # Free ~5-6GB VRAM — Qwen not needed for TTS/export phases
                yield {"step": "translating", "label": "Đang dọn bộ nhớ...",
                       "progress": r_transl[1]}
                gpu.unload_llm()
        elif is_llm_cloud_engine:
            logger.info("Skip Qwen rewrite — engine '%s' đã polish sẵn", eng_lower)
        else:
            logger.info("Skipping Qwen rewrite (no CUDA). Using Google Translate only.")
        yield {"step": "translating", "label": "Dịch thuật hoàn tất!", "progress": r_transl[1]}

        # Step 2.5: Auto-chunk (chỉ chạy khi user bật smart_chunk; default = True)
        proj_now = _load_meta(project_id)
        if proj_now.get("smart_chunk", True):
            yield {"step": "chunking", "label": "Chia nhỏ phụ đề theo từng câu...",
                   "progress": r_chunk[0]}
            try:
                auto_chunk_project_segments(project_id)
            except Exception as e:
                logger.warning("auto_chunk_project_segments failed: %s", e)
            yield {"step": "chunking", "label": "Chia nhỏ phụ đề theo từng câu...",
                   "progress": r_chunk[1]}

        # Step 2.6: Default emotion fallback — set cho seg chưa có emotion từ LLM
        proj_now = _load_meta(project_id)
        default_emo = (proj_now.get("default_emotion") or "").strip()
        if default_emo and default_emo != "normal":
            for seg in proj_now.get("segments", []):
                if not seg.get("emotion") or seg.get("emotion") == "neutral":
                    seg["emotion"] = default_emo
            _save_meta(proj_now)

        # Step 3: Generate TTS — stream + tick giữa các segment
        if do_dubbing and r_tts:
            import threading, time
            project = _load_meta(project_id)
            total_segs = max(1, len(project.get("segments", [])))
            yield {"step": "generating_tts", "label": steps[2][1], "progress": r_tts[0],
                   "detail": f"0/{total_segs}"}

            counter = {"done": 0, "error": None, "finished": False}

            def tts_runner():
                try:
                    for _ in generate_all(project_id):
                        counter["done"] += 1
                except Exception as e:
                    counter["error"] = e
                finally:
                    counter["finished"] = True

            thread = threading.Thread(target=tts_runner, daemon=True)
            thread.start()
            t_last = time.time()
            last_done = 0
            seg_est = 8.0  # dự đoán 8s/segment, cập nhật theo thực tế
            while not counter["finished"]:
                if is_canceled(project_id):
                    raise _Canceled()
                now = time.time()
                done = counter["done"]
                # Cập nhật seg_est theo segment vừa xong
                if done > last_done:
                    seg_est = max(2.0, (now - t_last) / (done - last_done))
                    t_last = now
                    last_done = done
                # Nội suy trong phạm vi segment kế tiếp
                frac_seg = min(1.0, (now - t_last) / max(1.0, seg_est))
                virtual = done + frac_seg * 0.95
                pct = r_tts[0] + min(1.0, virtual / total_segs) * (r_tts[1] - r_tts[0])
                # Label động: hiển thị câu hiện tại + ước lượng còn lại
                eta_sec = max(0, int((total_segs - done) * seg_est))
                eta_str = f"~{eta_sec//60}p{eta_sec%60:02d}s" if eta_sec >= 60 else f"~{eta_sec}s"
                live_label = f"Đang chuyển giọng câu {done+1}/{total_segs} (còn {eta_str})..."
                yield {"step": "generating_tts", "label": live_label,
                       "progress": round(pct, 1),
                       "detail": f"{done}/{total_segs}"}
                time.sleep(0.25)
            thread.join()
            if counter["error"]:
                yield {"step": "error", "label": str(counter["error"]), "progress": -1}
                return
            yield {"step": "generating_tts", "label": steps[2][1],
                   "progress": r_tts[1], "detail": f"{total_segs}/{total_segs}"}
        else:
            # Không có bước TTS → không emit gì (range đã = 0)
            logger.info("Skip TTS step (enable_dubbing=false)")

        _check_cancel()
        # Step 4: Export
        for tick in _run_step_with_progress(
            export_video, [project_id], {
                "keep_original_audio": not do_dubbing,
                "enable_ducking": do_dubbing,
            },
            start_pct=r_export[0], end_pct=r_export[1],
            label=steps[3][1], estimated_sec=15,
        ):
            _check_cancel()
            if tick.get("step") == "error":
                _mark_project_error(project_id, tick.get("label") or "Pipeline thất bại")
                yield tick
                return
            if "_result" not in tick:
                yield {"step": "exporting", **{k: v for k, v in tick.items() if k != "step"}}

        # Step 5: Free TTS VRAM (ready for next project or voice test)
        gpu._log_vram("end of pipeline (before TTS unload)")
        gpu.unload_tts()
        gpu._log_vram("end of pipeline (after TTS unload)")

        # Step 6: Compute + persist quality score → FE hiển thị badge
        try:
            from app.services.quality_score import compute_quality_score
            final_meta = _load_meta(project_id) or {}
            quality = compute_quality_score(final_meta)
            final_meta["quality_score"] = quality
            _save_meta(final_meta)
            logger.info(
                "Quality score: %.1f/100 (%s) — breakdown=%s | issues=%d",
                quality["overall"], quality["level"],
                quality["breakdown"], len(quality["issues"]),
            )
            for issue in quality["issues"][:5]:
                logger.info("  ⚠ %s", issue)
        except Exception as e:
            logger.warning("Quality score compute failed: %s", e)

        yield {"step": "done", "label": "Hoàn tất!", "progress": 100}

    except _Canceled:
        logger.info("Auto-dub canceled by user: %s", project_id)
        # Cancellation: status → "canceled" (không phải "error")
        try:
            meta = _load_meta(project_id)
            if meta and meta.get("status") not in ("done", "error"):
                meta["status"] = "canceled"
                _save_meta(meta)
        except Exception as e:
            logger.warning("Cannot mark project=%s as canceled: %s", project_id, e)
        yield {"step": "canceled", "label": "Đã huỷ", "progress": -1}
    except Exception as e:
        logger.error("Auto-dub failed at pipeline: %s", e, exc_info=True)
        _mark_project_error(project_id, f"Lỗi pipeline: {e}")
        yield {"step": "error", "label": f"Lỗi: {e}", "progress": -1}
    finally:
        _reset_cancel(project_id)
        # VRAM cleanup — đảm bảo dù pipeline xong, fail, hay canceled,
        # GPU models đều unload. Trước đây thiếu → 10 project consecutive
        # → VRAM full → next project OOM crash.
        try:
            gpu.unload_tts()
        except Exception as e:
            logger.warning("VRAM cleanup: unload_tts failed: %s", e)
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
