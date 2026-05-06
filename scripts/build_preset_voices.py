"""
Build 12 preset voices từ Voice Design feature của OmniVoice.

Workflow:
  1. Mỗi preset có instruct (gender + age + pitch + accent/whisper) + sample_text + gen_params riêng
  2. Generate audio bằng instruct (zero-shot, không cần ref audio)
  3. Dùng generated audio làm reference → create_voice_clone_prompt → .pt
  4. Save .pt vào voxstudio-engine/voices/ để VoxStudio backend pickup

Differentiation strategy (giữ quality cao + giọng khác nhau rõ):
  • Attribute space: gender × age (5 levels) × pitch (5 levels) + whisper.
    KHÔNG dùng accent EN — model train accent trên speaker English, apply
    lên text Việt làm prosody lai, mất tự nhiên.
  • Sample text per-preset: text khác nhau → embedding nhớ rhythm/intonation
    khác nhau (news anchor khác MC podcast, kể chuyện cổ khác ASMR).
  • Generation params giữ gần default cho naturalness — chỉ tweak nhẹ
    guidance_scale cho whisper preset.
  • Seed deterministic: hash(slug) → torch.manual_seed để reproducible.

Output:
  voxstudio-engine/voices/
    nu_mai_anh.pt + .wav (sample reference) + .json (metadata)
    nu_bao_chau.pt + .wav + .json
    ...

Usage:
  cd /Users/tienthuan/Desktop/VoxStudio
  python scripts/build_preset_voices.py
  python scripts/build_preset_voices.py --presets nu_mai_anh,nam_quoc_bao
  python scripts/build_preset_voices.py --redo   # ghi đè .pt đã có
"""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import soundfile as sf
import torch
from omnivoice import OmniVoice


# ──────────────────────────────────────────────────────────────────────────
# 12 PRESET VOICE — đa dạng giới + tuổi + pitch + accent + sample text + params
# Mỗi preset là dict thay vì tuple để dễ mở rộng & đọc.
# ──────────────────────────────────────────────────────────────────────────

# Sample texts — mỗi loại register/rhythm khác nhau để embedding nhớ phong cách
TEXT_NEWS = (
    "Kính chào quý vị và các bạn, đây là bản tin thời sự lúc bảy giờ tối. "
    "Hôm nay có nhiều sự kiện quan trọng diễn ra trong và ngoài nước. "
    "Mời quý vị cùng theo dõi chi tiết ngay sau đây."
)
TEXT_PODCAST = (
    "Chào mọi người, lại là mình đây trong tập podcast tuần này. "
    "Hôm nay tụi mình sẽ cùng nhau bàn về một chủ đề rất thú vị, "
    "đó là cách quản lý thời gian sao cho hiệu quả nhất."
)
TEXT_WARM_ANNOUNCER = (
    "Xin chào các bạn thính giả thân mến. Một ngày mới lại bắt đầu "
    "với thật nhiều niềm vui và năng lượng tích cực. "
    "Hãy cùng nhau lan tỏa những điều tốt đẹp nhé."
)
TEXT_DOCUMENTARY = (
    "Sâu trong lòng đại dương, có những loài sinh vật chưa từng được "
    "khoa học khám phá. Chúng tồn tại lặng lẽ qua hàng triệu năm, "
    "lưu giữ những bí mật của hành tinh chúng ta."
)
TEXT_FOLK_STORY = (
    "Ngày xửa ngày xưa, ở một ngôi làng nhỏ ven sông, có một cô bé "
    "tên là Tấm. Cô sống cùng dì ghẻ và cô em cùng cha khác mẹ. "
    "Tấm phải làm việc vất vả từ sáng đến tối."
)
TEXT_ASMR = (
    "Hít thở sâu nào, thả lỏng vai và cằm. "
    "Hãy để mọi suy nghĩ trôi đi như đám mây trên bầu trời. "
    "Bây giờ bạn đang ở một nơi rất an toàn và yên bình."
)
TEXT_FUNNY_TEEN = (
    "Ê các bạn ơi, hôm nay mình mới khám phá ra một mẹo hay cực kỳ luôn nha! "
    "Cái này bảo đảm xài xong là phải bấm theo dõi liền cho coi. "
    "Lẹ lên nào, chuẩn bị bị wow ngay đây."
)
TEXT_VLOG = (
    "Xin chào mọi người, hôm nay mình sẽ dắt các bạn đi một chuyến "
    "khám phá Đà Lạt thật khác lạ. Chuẩn bị máy ảnh, áo khoác và "
    "tinh thần thật thoải mái nhé."
)
TEXT_TV_MC = (
    "Quý vị thân mến, chương trình của chúng ta hôm nay sẽ mang đến "
    "những câu chuyện đầy cảm xúc và ý nghĩa. "
    "Xin mời quý vị bước vào hành trình cùng chúng tôi."
)
TEXT_EXEC = (
    "Trong bối cảnh thị trường hiện nay, doanh nghiệp cần xác định rõ "
    "chiến lược dài hạn. Sự bền vững và đổi mới sẽ là hai trụ cột "
    "đưa chúng ta vượt qua mọi thách thức."
)
TEXT_OLD_STORYTELLER = (
    "Cháu của ông ơi, lại đây ông kể cho mà nghe. Ngày xưa, khi ông "
    "còn trẻ như tụi bây bây giờ, làng mình chưa có điện, chưa có "
    "đường nhựa, chỉ toàn cây xanh và đồng lúa thôi."
)
TEXT_BOOK_NARRATOR = (
    "Chương một. Buổi sáng mùa thu se lạnh, sương mỏng phủ trên những "
    "mái nhà cũ. Hắn bước ra hiên, châm điếu thuốc đầu tiên trong ngày, "
    "lặng nhìn con đường vắng tanh trước mặt."
)
# ── Vietnamese warm/studio additions ──
TEXT_VN_WARM_AUDIOBOOK = (
    "Em đứng đó rất lâu, nhìn con đường mòn nắng đọng trên những đám lá "
    "khô, lòng bồi hồi nhớ về mùa hè năm ấy — mùa hè cuối cùng của tuổi thơ. "
    "Tiếng ve hôm đó dài đến lạ."
)
TEXT_VN_RADIO_HOST = (
    "Chào quý vị thính giả đang lắng nghe sóng phát thanh. Đêm nay, "
    "chúng ta sẽ cùng nhau dành ít phút lắng đọng để cảm nhận những giai "
    "điệu đẹp nhất, nhẹ nhàng nhất của một ngày dài đã qua."
)
TEXT_VN_YOUTUBER = (
    "Chào các bạn, hôm nay chúng ta sẽ cùng tìm hiểu về một khái niệm thú vị "
    "trong cuộc sống. Mình sẽ giải thích thật đơn giản, dễ hiểu, các bạn "
    "chỉ cần thư giãn và lắng nghe."
)

# ── English (warm/studio quality) ──
TEXT_EN_PODCAST = (
    "Welcome back to another episode of our show. Today, we have a fascinating "
    "topic to explore together — one that touches on creativity, focus, and "
    "the small habits that shape who we become."
)
TEXT_EN_AUDIOBOOK = (
    "Chapter one. The autumn rain fell gently on the cobblestone streets "
    "as Eleanor stepped out into the evening air. She had been waiting for "
    "this moment for nearly a decade, and now, at last, the door was open."
)
TEXT_EN_DOCUMENTARY = (
    "Beneath the surface of the deep ocean, life flourishes in ways we are "
    "only beginning to understand. Creatures that have remained unchanged "
    "for millions of years quietly hold the secrets of our planet."
)

# ── Chinese (Mandarin) ──
TEXT_ZH_NEWS = (
    "各位观众朋友们晚上好，欢迎收看今天的新闻报道。"
    "今天我们将带您了解国内外最新动态，请您关注接下来的详细内容。"
)
TEXT_ZH_NARRATOR = (
    "在这座古老的城市里，每一条街巷都藏着一段不为人知的故事。"
    "今天，让我们一起走进时光，听一听那些被岁月轻声讲述的传奇。"
)

# ── Japanese ──
TEXT_JP_NARRATOR = (
    "静かな夜、月明かりが窓辺に差し込む。"
    "彼女はゆっくりとページをめくり、長い間忘れていた言葉を読み返した。"
    "それは、遠い昔の自分への手紙だった。"
)

# ── Korean ──
TEXT_KR_NARRATOR = (
    "조용한 새벽, 거리는 아직 잠들어 있다. "
    "그는 따뜻한 커피 한 잔을 손에 쥐고 창밖을 바라보며 "
    "오늘 하루 무엇을 이루고 싶은지 천천히 떠올린다."
)

# ── French ──
TEXT_FR_NARRATOR = (
    "Le matin se levait doucement sur la ville endormie. "
    "Les rues, encore vides, semblaient retenir leur souffle, "
    "comme si elles attendaient le retour des pas familiers."
)

# ── Spanish ──
TEXT_ES_NARRATOR = (
    "En aquel pequeño pueblo costero, el tiempo parecía detenerse cada tarde. "
    "El sol se hundía lentamente en el horizonte, y las olas susurraban "
    "historias antiguas que sólo los viejos recordaban."
)


# Default params — giữ gần model default cho naturalness tối đa
DEFAULT_PARAMS = {
    "num_step": 32,
    "guidance_scale": 2.0,
    "position_temperature": 5.0,
    "class_temperature": 0.0,
    "t_shift": 0.1,
}
# Whisper preset cần guidance_scale thấp hơn để giọng nhẹ tự nhiên
WHISPER_PARAMS = {
    "num_step": 32,
    "guidance_scale": 1.8,
    "position_temperature": 5.0,
    "class_temperature": 0.0,
    "t_shift": 0.1,
}
# Warm/studio preset — guidance cao + position temp thấp = giọng giàu cảm xúc,
# ổn định, ít biến động. Phù hợp narrator audiobook, podcast, radio.
WARM_STUDIO_PARAMS = {
    "num_step": 32,
    "guidance_scale": 2.5,
    "position_temperature": 4.5,
    "class_temperature": 0.0,
    "t_shift": 0.1,
}


PRESETS = [
    # FEMALE — 6 giọng, attribute combos không trùng
    {
        "slug": "nu_mai_anh",
        "display_name": "Mai Anh",
        "gender": "female",
        "description": "Nữ thiếu niên giọng cao — tươi trẻ, năng động",
        "instruct": "female, teenager, very high pitch",
        "sample_text": TEXT_NEWS,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nu_bao_chau",
        "display_name": "Bảo Châu",
        "gender": "female",
        "description": "Nữ trẻ giọng cao vừa — host podcast, gần gũi",
        "instruct": "female, young adult, high pitch",
        "sample_text": TEXT_PODCAST,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nu_hong_hanh",
        "display_name": "Hồng Hạnh",
        "gender": "female",
        "description": "Nữ trung niên giọng trung — phát thanh viên ấm",
        "instruct": "female, middle-aged, moderate pitch",
        "sample_text": TEXT_WARM_ANNOUNCER,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nu_thu_lan",
        "display_name": "Thu Lan",
        "gender": "female",
        "description": "Nữ trung niên giọng trầm — narrator phim tài liệu",
        "instruct": "female, middle-aged, low pitch",
        "sample_text": TEXT_DOCUMENTARY,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nu_co_ba",
        "display_name": "Cô Ba",
        "gender": "female",
        "description": "Nữ lớn tuổi giọng cực trầm — bà kể chuyện cổ tích",
        "instruct": "female, elderly, very low pitch",
        "sample_text": TEXT_FOLK_STORY,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nu_thao_vy",
        "display_name": "Thảo Vy",
        "gender": "female",
        "description": "Nữ thì thầm — ASMR, thiền chánh niệm",
        "instruct": "female, young adult, low pitch, whisper",
        "sample_text": TEXT_ASMR,
        "params": WHISPER_PARAMS,
    },

    # MALE — 6 giọng, attribute combos không trùng
    {
        "slug": "nam_hoang_phuc",
        "display_name": "Hoàng Phúc",
        "gender": "male",
        "description": "Nam thiếu niên giọng cao — content hài hước, năng động",
        "instruct": "male, teenager, very high pitch",
        "sample_text": TEXT_FUNNY_TEEN,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nam_tuan_khang",
        "display_name": "Tuấn Khang",
        "gender": "male",
        "description": "Nam thanh niên giọng cao vừa — vlogger du lịch",
        "instruct": "male, young adult, high pitch",
        "sample_text": TEXT_VLOG,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nam_quoc_bao",
        "display_name": "Quốc Bảo",
        "gender": "male",
        "description": "Nam trung niên giọng trung — MC truyền hình chững chạc",
        "instruct": "male, middle-aged, moderate pitch",
        "sample_text": TEXT_TV_MC,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nam_duc_trong",
        "display_name": "Đức Trọng",
        "gender": "male",
        "description": "Nam trung niên giọng cực trầm — doanh nhân uy nghi, phát biểu",
        "instruct": "male, middle-aged, very low pitch",
        "sample_text": TEXT_EXEC,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nam_bac_tu",
        "display_name": "Bác Tư",
        "gender": "male",
        "description": "Nam lớn tuổi giọng cực trầm — ông kể chuyện cổ",
        "instruct": "male, elderly, very low pitch",
        "sample_text": TEXT_OLD_STORYTELLER,
        "params": DEFAULT_PARAMS,
    },
    {
        "slug": "nam_minh_duc",
        "display_name": "Minh Đức",
        "gender": "male",
        "description": "Nam thanh niên giọng trầm — narrator sách nói, audiobook nhẹ nhàng",
        "instruct": "male, young adult, low pitch",
        "sample_text": TEXT_BOOK_NARRATOR,
        "params": DEFAULT_PARAMS,
    },

    # ════════════════════════════════════════════════════════════
    # WARM STUDIO — giọng "phòng thu", giàu cảm xúc, đa ngôn ngữ.
    # ════════════════════════════════════════════════════════════

    # ── Vietnamese warm additions (4 voices) ──
    {
        "slug": "nu_thanh_nga",
        "display_name": "Thanh Nga",
        "gender": "female",
        "language": "vietnamese",
        "description": "Nữ trung niên ấm — narrator audiobook, đọc văn",
        "instruct": "female, middle-aged, moderate pitch",
        "sample_text": TEXT_VN_WARM_AUDIOBOOK,
        "params": WARM_STUDIO_PARAMS,
    },
    {
        "slug": "nu_phuong_anh",
        "display_name": "Phương Anh",
        "gender": "female",
        "language": "vietnamese",
        "description": "Nữ thanh niên ấm — radio host đêm khuya, gần gũi",
        "instruct": "female, young adult, moderate pitch",
        "sample_text": TEXT_VN_RADIO_HOST,
        "params": WARM_STUDIO_PARAMS,
    },
    {
        "slug": "nam_anh_quan",
        "display_name": "Anh Quân",
        "gender": "male",
        "language": "vietnamese",
        "description": "Nam trung niên ấm — DJ radio, MC sự kiện",
        "instruct": "male, middle-aged, moderate pitch",
        "sample_text": TEXT_VN_RADIO_HOST,
        "params": WARM_STUDIO_PARAMS,
    },
    {
        "slug": "nam_minh_quang",
        "display_name": "Minh Quang",
        "gender": "male",
        "language": "vietnamese",
        "description": "Nam thanh niên ấm — YouTuber, narrator content educational",
        "instruct": "male, young adult, moderate pitch",
        "sample_text": TEXT_VN_YOUTUBER,
        "params": WARM_STUDIO_PARAMS,
    },

    # ── English (3 voices) ──
    {
        "slug": "en_emma",
        "display_name": "Emma",
        "gender": "female",
        "language": "english",
        "description": "Warm female podcaster — American accent, polished delivery",
        "instruct": "female, young adult, moderate pitch, american accent",
        "sample_text": TEXT_EN_PODCAST,
        "params": WARM_STUDIO_PARAMS,
    },
    {
        "slug": "en_michael",
        "display_name": "Michael",
        "gender": "male",
        "language": "english",
        "description": "Audiobook narrator — British accent, rich and authoritative",
        "instruct": "male, middle-aged, moderate pitch, british accent",
        "sample_text": TEXT_EN_AUDIOBOOK,
        "params": WARM_STUDIO_PARAMS,
    },
    {
        "slug": "en_sophia",
        "display_name": "Sophia",
        "gender": "female",
        "language": "english",
        "description": "Documentary narrator — measured, mature, contemplative",
        # NOTE: trước đây dùng "low pitch + american accent" → OmniVoice
        # sinh noise (tách tách) cho combo này. Chuyển sang "moderate pitch"
        # + bỏ accent để dùng baseline English voice — ổn định hơn.
        "instruct": "female, middle-aged, moderate pitch",
        "sample_text": TEXT_EN_DOCUMENTARY,
        "params": WARM_STUDIO_PARAMS,
    },

    # ── Chinese / Mandarin (2 voices) ──
    {
        "slug": "zh_meilin",
        "display_name": "美琳",
        "gender": "female",
        "language": "chinese",
        "description": "中文女声 · 温暖播音员 — 适合新闻、纪录片",
        "instruct": "female, young adult, moderate pitch",
        "sample_text": TEXT_ZH_NEWS,
        "params": WARM_STUDIO_PARAMS,
    },
    {
        "slug": "zh_wei",
        "display_name": "伟",
        "gender": "male",
        "language": "chinese",
        "description": "中文男声 · 沉稳磁性 — 适合有声书、广告",
        "instruct": "male, middle-aged, moderate pitch",
        "sample_text": TEXT_ZH_NARRATOR,
        "params": WARM_STUDIO_PARAMS,
    },

    # ── Japanese (1 voice) ──
    {
        "slug": "jp_yuki",
        "display_name": "ゆき",
        "gender": "female",
        "language": "japanese",
        "description": "日本語女性 · 落ち着いた朗読 — オーディオブック、ナレーション",
        "instruct": "female, young adult, moderate pitch",
        "sample_text": TEXT_JP_NARRATOR,
        "params": WARM_STUDIO_PARAMS,
    },

    # ── Korean (1 voice) ──
    {
        "slug": "kr_minji",
        "display_name": "민지",
        "gender": "female",
        "language": "korean",
        "description": "한국어 여성 · 따뜻한 내레이션 — 오디오북, 다큐멘터리",
        "instruct": "female, young adult, moderate pitch",
        "sample_text": TEXT_KR_NARRATOR,
        "params": WARM_STUDIO_PARAMS,
    },

    # ── French (1 voice) ──
    {
        "slug": "fr_camille",
        "display_name": "Camille",
        "gender": "female",
        "language": "french",
        "description": "Voix française chaleureuse — narration, livre audio",
        "instruct": "female, young adult, moderate pitch",
        "sample_text": TEXT_FR_NARRATOR,
        "params": WARM_STUDIO_PARAMS,
    },
]


def _seed_for(slug: str) -> int:
    """Deterministic seed per preset — cùng slug luôn ra cùng giọng."""
    h = hashlib.md5(slug.encode("utf-8")).digest()
    return int.from_bytes(h[:4], "big")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./voxstudio-engine/voices",
                    help="Folder lưu .pt files")
    ap.add_argument("--presets", default="all",
                    help="Comma-separated preset slugs hoặc 'all'")
    ap.add_argument("--model", default="k2-fsa/OmniVoice")
    ap.add_argument("--device", default="auto", help="auto | mps | cuda | cpu")
    ap.add_argument("--redo", action="store_true",
                    help="Regenerate kể cả khi .pt đã tồn tại")
    args = ap.parse_args()

    # Filter presets
    if args.presets == "all":
        presets = PRESETS
    else:
        wanted = set(args.presets.split(","))
        presets = [p for p in PRESETS if p["slug"] in wanted]
    if not presets:
        print("✗ Không match preset nào.")
        sys.exit(1)

    # Detect device
    if args.device == "auto":
        if torch.cuda.is_available():
            device = "cuda:0"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = args.device

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading OmniVoice on {device}... (lần đầu mất 1-2 phút tải model)")
    t0 = time.time()
    model = OmniVoice.from_pretrained(args.model, device_map=device)
    print(f"✓ Model loaded in {time.time() - t0:.0f}s")
    sr = model.sampling_rate
    print(f"  Sampling rate: {sr} Hz")

    print(f"\nBuilding {len(presets)} presets...\n")

    for i, preset in enumerate(presets, 1):
        slug = preset["slug"]
        display_name = preset["display_name"]
        gender = preset["gender"]
        # language: read từ preset, fallback "vietnamese" cho VN presets cũ
        # không define field này (backward compat).
        language = preset.get("language", "vietnamese")
        description = preset["description"]
        instruct = preset["instruct"]
        sample_text = preset["sample_text"]
        params = preset["params"]

        pt_path = out_dir / f"{slug}.pt"
        wav_path = out_dir / f"{slug}.wav"
        json_path = out_dir / f"{slug}.json"
        if pt_path.exists() and not args.redo:
            print(f"  [{i}/{len(presets)}] {slug} — skipped (đã có .pt, dùng --redo để override)")
            continue

        gender_emoji = "👩" if gender == "female" else "👨"
        print(f"  [{i}/{len(presets)}] {gender_emoji} {slug} · {display_name}")
        print(f"       {description}")
        print(f"       instruct: {instruct!r}")
        print(f"       params: gs={params['guidance_scale']} pos_temp={params['position_temperature']} class_temp={params['class_temperature']}")
        t1 = time.time()

        # Seed deterministic per slug → cùng preset luôn ra cùng audio
        seed = _seed_for(slug)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)

        # Step 1: Generate ref audio bằng instruct (zero-shot voice design)
        try:
            audio_out = model.generate(
                text=sample_text,
                instruct=instruct,
                **params,
            )
        except Exception as e:
            print(f"       ✗ generate fail: {e}")
            continue
        waveform = audio_out[0].squeeze(0).cpu().numpy()
        sf.write(str(wav_path), waveform, sr)
        gen_dur = len(waveform) / sr
        print(f"       ✓ Generated audio: {gen_dur:.1f}s · {wav_path.name} ({time.time() - t1:.0f}s)")

        # Step 2: Tạo voice clone prompt từ generated audio → embedding cố định
        t2 = time.time()
        try:
            voice_prompt = model.create_voice_clone_prompt(
                ref_audio=str(wav_path),
                ref_text=sample_text,
            )
        except Exception as e:
            print(f"       ✗ create_voice_clone_prompt fail: {e}")
            continue

        # Step 3: Save .pt + metadata .json sidecar
        torch.save(voice_prompt, str(pt_path))
        meta = {
            "slug": slug,
            "display_name": display_name,
            "gender": gender,
            "language": language,
            "description": description,
            "instruct": instruct,
            "sample_text": sample_text,
            "params": params,
            "seed": seed,
            "model": args.model,
            "sample_rate": sr,
            "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        size_kb = pt_path.stat().st_size / 1024
        print(f"       ✓ Voice prompt: {pt_path.name} · {size_kb:.0f} KB ({time.time() - t2:.0f}s)")
        print(f"       ✓ Metadata: {json_path.name}")
        print()

    total = time.time() - t0
    print(f"\n✓ Done in {total:.0f}s. Output:")
    print(f"\n  GIỌNG NỮ:")
    for p in presets:
        if p["gender"] != "female":
            continue
        pt = out_dir / f"{p['slug']}.pt"
        if pt.exists():
            print(f"    • {p['slug']:20s} → {p['display_name']:12s} · {p['instruct']}")
    print(f"\n  GIỌNG NAM:")
    for p in presets:
        if p["gender"] != "male":
            continue
        pt = out_dir / f"{p['slug']}.pt"
        if pt.exists():
            print(f"    • {p['slug']:20s} → {p['display_name']:12s} · {p['instruct']}")
    print(f"\n→ Restart VoxStudio backend → các voice xuất hiện trong dropdown (group nam/nữ).")


if __name__ == "__main__":
    main()
