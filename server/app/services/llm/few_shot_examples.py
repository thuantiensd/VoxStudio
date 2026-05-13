"""Few-shot examples library cho LLM dịch — per genre/content_type.

LLM bắt chước pattern từ examples tốt hơn nhiều so với rule âm tính
("KHÔNG dịch máy móc"). Mỗi genre có 6-10 cặp source → good Việt dịch
+ optional bad (counter-example) để LLM học không bị dịch máy.

Format: (source_zh, vi_good, vi_bad_or_note)
- source_zh: nguồn tiếng Trung (mở rộng nhật/hàn sau)
- vi_good: dịch chuẩn người Việt
- vi_bad_or_note: counter-example HOẶC note context

Khi không có vi_bad → để None, dùng cho positive-only learning.
"""
from __future__ import annotations

from typing import Optional


# ── DRAMA / SHORT_DRAMA: phim gia đình, tâm lý, kịch ──────────────────────
DRAMA_EXAMPLES = [
    # Mẹ–con
    ("妈，我回来了。",
     "Mẹ, con về rồi.",
     "Mẹ, tôi đã về."),
    ("你又跑哪去了？妈担心死了！",
     "Con lại chạy đi đâu thế hả? Mẹ lo muốn chết!",
     "Bạn lại chạy đi đâu rồi? Tôi lo lắng vô cùng."),
    ("妈，你别生气，听我解释。",
     "Mẹ, mẹ đừng giận, nghe con giải thích.",
     "Mẹ, đừng tức giận, hãy nghe tôi giải thích."),

    # Vợ chồng
    ("老婆，今天累吗？",
     "Em, hôm nay mệt không?",
     "Vợ ơi, hôm nay bạn có mệt không?"),
    ("我跟你说过多少次了！",
     "Anh nói với em bao nhiêu lần rồi!",
     "Tôi đã nói với bạn nhiều lần rồi!"),
    ("我们离婚吧。",
     "Mình ly hôn đi.",
     "Chúng ta cùng ly hôn nhé."),

    # Anh chị em
    ("哥，等等我！",
     "Anh, đợi em với!",
     "Anh trai, chờ tôi với!"),
    ("姐，借我点钱。",
     "Chị, cho em mượn ít tiền.",
     "Chị gái, cho tôi vay một ít tiền."),

    # Bạn bè
    ("你怎么了？看起来不太好。",
     "Cậu sao thế? Trông không ổn lắm.",
     "Bạn sao vậy? Trông có vẻ không ổn."),

    # Sếp – nhân viên
    ("小李，把报告给我。",
     "Tiểu Lý, đưa báo cáo cho anh.",
     "Tiểu Lý, hãy đưa báo cáo cho tôi."),

    # Cảm xúc giận
    ("你给我滚！",
     "Mày cút đi!",
     "Hãy đi đi!"),

    # Cảm xúc yêu
    ("我爱你。",
     "Em yêu anh.",
     "Tôi yêu bạn."),
]


# ── ROMANCE / NGÔN TÌNH ────────────────────────────────────────────────
ROMANCE_EXAMPLES = [
    # Modern intimate
    ("我喜欢你，从第一次见你就喜欢。",
     "Em thích anh, từ lần đầu gặp đã thích rồi.",
     None),
    ("你一直都在我心里。",
     "Anh luôn ở trong tim em.",
     None),
    ("陪我一辈子好不好？",
     "Bên em cả đời nhé?",
     "Hãy ở bên cạnh tôi cả đời được không?"),

    # Confession
    ("我想和你在一起。",
     "Em muốn ở bên anh.",
     "Tôi muốn ở cùng bạn."),

    # Jealousy/argument
    ("她是谁？",
     "Cô ta là ai?",
     None),
    ("你心里有没有我？",
     "Trong lòng anh có em không?",
     None),

    # Soft
    ("别哭了，宝贝。",
     "Đừng khóc nữa, bé yêu.",
     None),
    ("我永远不会离开你。",
     "Anh sẽ không bao giờ rời xa em.",
     None),
]


# ── COMEDY / HÀI ─────────────────────────────────────────────────────
COMEDY_EXAMPLES = [
    ("这也太搞笑了吧！",
     "Hài quá đi mất!",
     "Cái này thật sự quá buồn cười."),
    ("你认真的？",
     "Mày nghiêm túc à?",
     "Bạn có nghiêm túc không?"),
    ("我笑死了！",
     "Cười chết mất!",
     "Tôi cười đến chết rồi."),
    ("不会吧不会吧！",
     "Không phải chứ, không phải chứ!",
     None),
    ("绝绝子！",
     "Đỉnh thật sự!",
     "Tuyệt đối."),
    ("社死现场。",
     "Quê độ tập thể.",
     "Hiện trường xấu hổ xã hội."),
    ("整不会了。",
     "Hết cứu rồi.",
     "Không thể làm được nữa."),
]


# ── ACTION / HÀNH ĐỘNG ─────────────────────────────────────────────────
ACTION_EXAMPLES = [
    ("跑！",
     "Chạy!",
     "Hãy chạy đi!"),
    ("小心！",
     "Cẩn thận!",
     "Hãy cẩn thận!"),
    ("放下武器！",
     "Bỏ vũ khí xuống!",
     "Hãy hạ vũ khí của bạn xuống!"),
    ("不许动！",
     "Đứng yên!",
     None),
    ("快走！",
     "Đi nhanh!",
     "Hãy đi nhanh đi!"),
    ("我掩护你。",
     "Anh che chắn cho em.",
     None),
]


# ── HISTORICAL / WUXIA / CỔ TRANG ──────────────────────────────────────
CLASSICAL_EXAMPLES = [
    # Tự xưng
    ("臣妾告退。",
     "Thiếp xin cáo lui.",
     "Tôi xin rời đi."),
    ("微臣不敢。",
     "Thần không dám.",
     "Tôi không dám."),
    ("在下姓林。",
     "Tại hạ họ Lâm.",
     "Tôi họ Lâm."),

    # Gọi
    ("陛下英明。",
     "Bệ hạ anh minh.",
     "Vua thông minh."),
    ("大人请。",
     "Đại nhân mời.",
     "Ông mời."),
    ("公子，请用茶。",
     "Công tử, mời dùng trà.",
     "Cậu, mời uống trà."),

    # Hành động
    ("速速离去！",
     "Mau mau rời đi!",
     "Đi đi ngay!"),
    ("此乃天命。",
     "Đây là thiên mệnh.",
     "Đây là số phận."),

    # Tình yêu cổ trang
    ("此生非卿不娶。",
     "Đời này không phải nàng thì chàng không cưới.",
     "Cuộc đời này, không phải bạn thì tôi sẽ không cưới."),
    ("臣女愿意。",
     "Thần nữ tình nguyện.",
     "Tôi đồng ý."),
]


# ── NEWS / TIN TỨC ──────────────────────────────────────────────────────
NEWS_EXAMPLES = [
    ("据悉，事件发生于今晨。",
     "Theo nguồn tin, vụ việc xảy ra vào sáng nay.",
     "Được biết, sự kiện đã diễn ra vào buổi sáng hôm nay."),
    ("当局表示将彻查此事。",
     "Cơ quan chức năng cho biết sẽ điều tra triệt để vụ việc.",
     "Nhà chức trách nói rằng họ sẽ điều tra kỹ vấn đề này."),
    ("经济增长率达 5.2%。",
     "Tăng trưởng kinh tế đạt 5.2%.",
     None),
    ("会议将于明日召开。",
     "Cuộc họp sẽ diễn ra vào ngày mai.",
     None),
    ("发言人否认相关传闻。",
     "Người phát ngôn phủ nhận các tin đồn liên quan.",
     None),
]


# ── DOCUMENTARY / TÀI LIỆU ────────────────────────────────────────────
DOCUMENTARY_EXAMPLES = [
    ("这是地球上最古老的文明之一。",
     "Đây là một trong những nền văn minh cổ xưa nhất trên Trái Đất.",
     None),
    ("我们将带各位探索深海的奥秘。",
     "Chúng ta sẽ cùng khám phá những bí ẩn của đại dương sâu thẳm.",
     "Chúng tôi sẽ dẫn các bạn khám phá bí mật của biển sâu."),
    ("在自然界中，这种现象极为罕见。",
     "Trong tự nhiên, hiện tượng này cực kỳ hiếm gặp.",
     None),
]


# ── VLOG / ĐỜI SỐNG ──────────────────────────────────────────────────
VLOG_EXAMPLES = [
    ("今天带大家去吃一家超火的店！",
     "Hôm nay mình dẫn mọi người đi ăn quán đang hot lắm nhé!",
     "Hôm nay tôi dẫn các bạn đi ăn ở một cửa hàng rất hot."),
    ("味道真的绝了！",
     "Vị đỉnh thật sự luôn!",
     "Hương vị thực sự rất tuyệt vời."),
    ("我们继续走，下一站是…",
     "Mình đi tiếp nhé, điểm đến tiếp theo là…",
     "Chúng tôi tiếp tục đi, điểm dừng tiếp theo là..."),
    ("大家有去过的可以评论让我知道！",
     "Ai đã đi rồi thì comment cho mình biết với nhé!",
     "Nếu các bạn đã đến thì hãy bình luận cho tôi biết."),
]


# ── TUTORIAL / HƯỚNG DẪN ──────────────────────────────────────────────
TUTORIAL_EXAMPLES = [
    ("点击右上角的按钮。",
     "Nhấn vào nút ở góc trên bên phải.",
     "Bấm vào cái nút ở phía trên bên phải."),
    ("打开设置，找到账户。",
     "Mở Cài đặt, tìm mục Tài khoản.",
     "Hãy mở Cài đặt rồi tìm tài khoản."),
    ("第一步，先连接电源。",
     "Bước 1, cắm nguồn trước.",
     "Bước đầu tiên, hãy kết nối nguồn điện."),
    ("注意，这里有个常见错误。",
     "Lưu ý, chỗ này hay sai.",
     "Chú ý, đây là lỗi thường gặp."),
    ("完成！很简单对不对？",
     "Xong! Đơn giản phải không?",
     "Hoàn thành rồi! Rất đơn giản đúng không?"),
]


# ── SALES / BÁN HÀNG ─────────────────────────────────────────────────
SALES_EXAMPLES = [
    ("这款真的太好用了！",
     "Mẫu này dùng đỉnh thật sự!",
     "Cái này thực sự rất dễ dùng."),
    ("买一送一，仅限今天！",
     "Mua 1 tặng 1, chỉ hôm nay thôi nha!",
     "Mua một được một, chỉ giới hạn trong ngày hôm nay."),
    ("姐妹们冲呀！",
     "Chị em quất đi!",
     "Các chị em hãy lao vào!"),
    ("不买亏死。",
     "Không mua là tiếc đó.",
     "Nếu không mua thì sẽ rất thiệt thòi."),
    ("限时优惠 50% off！",
     "Ưu đãi giảm 50%, có hạn!",
     None),
]


# ── ANIME / HOẠT HÌNH NHẬT/TRUNG ──────────────────────────────────────
ANIME_EXAMPLES = [
    ("わぁ、すごい！",  # JP
     "Wow, đỉnh thật!",
     "Wow, tuyệt vời!"),
    ("諦めないで！",
     "Đừng bỏ cuộc!",
     "Đừng từ bỏ!"),
    ("仲間を信じろ！",
     "Tin vào đồng đội đi!",
     None),
    ("えっ？！本当に？",
     "Hả?! Thật sao?",
     "Cái gì?! Có thật không?"),
]


GENRE_EXAMPLES_MAP = {
    "drama": DRAMA_EXAMPLES,
    "short_drama": DRAMA_EXAMPLES,
    "movie": DRAMA_EXAMPLES,
    "romance": ROMANCE_EXAMPLES,
    "comedy": COMEDY_EXAMPLES,
    "action": ACTION_EXAMPLES,
    "thriller": ACTION_EXAMPLES,
    "historical": CLASSICAL_EXAMPLES,
    "wuxia": CLASSICAL_EXAMPLES,
    "xianxia": CLASSICAL_EXAMPLES,
    "news": NEWS_EXAMPLES,
    "documentary": DOCUMENTARY_EXAMPLES,
    "vlog": VLOG_EXAMPLES,
    "tutorial": TUTORIAL_EXAMPLES,
    "sales": SALES_EXAMPLES,
    "livestream": SALES_EXAMPLES,
    "anime": ANIME_EXAMPLES,
    "kids": COMEDY_EXAMPLES,
}


def build_few_shot_block(
    genre: Optional[str] = None,
    content_type: Optional[str] = None,
    target_lang: str = "vi",
    max_examples: int = 8,
) -> str:
    """Build few-shot examples block để inject vào prompt.

    Priority:
    1. content_type match (vlog/news/tutorial...)
    2. genre match (drama/romance/comedy...)
    3. fallback drama (mặc định an toàn cho phim)

    Chỉ áp dụng target_lang=vi. Trả "" nếu không match hoặc lang khác.
    """
    if (target_lang or "").lower() not in ("vi", "vietnamese", "vn"):
        return ""

    examples = None
    if content_type:
        examples = GENRE_EXAMPLES_MAP.get(content_type.lower().strip())
    if not examples and genre:
        examples = GENRE_EXAMPLES_MAP.get(genre.lower().strip())
    if not examples:
        examples = DRAMA_EXAMPLES

    examples = examples[:max_examples]
    if not examples:
        return ""

    lines = [
        "\n📚 FEW-SHOT EXAMPLES (học pattern dịch chuẩn — KHÔNG copy nguyên xi,",
        "chỉ học STYLE / TONE / lựa chọn từ ngữ):",
        "",
    ]
    for i, ex in enumerate(examples, 1):
        if len(ex) >= 3 and ex[2]:
            src, good, bad = ex
            lines.append(f"{i}. NGUỒN: {src}")
            lines.append(f"   ✅ ĐÚNG:   {good}")
            lines.append(f"   ❌ SAI:    {bad}")
        else:
            src, good = ex[0], ex[1]
            lines.append(f"{i}. NGUỒN: {src}")
            lines.append(f"   ✅ {good}")
        lines.append("")

    lines.append("⚡ Học cách dịch trên — TỰ NHIÊN, đúng quan hệ, không máy móc.")
    lines.append("ÁP DỤNG cho dialogue thực tế ở phần dưới.")
    return "\n".join(lines) + "\n"
