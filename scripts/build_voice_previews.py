"""
Build preview audio cho các preset voice — để user nghe thử trước khi chọn.

Workflow:
  1. Scan tất cả .pt + .json trong voxstudio-engine/voices/
  2. Mỗi voice → load voice_clone_prompt
  3. Generate audio với template text giới thiệu VoxStudio (personalize tên giọng)
  4. Save thành <slug>_preview.wav cùng folder

Script này chạy SAU khi đã có .pt files (do build_preset_voices.py tạo).
Có thể chạy lại bất kỳ lúc nào để refresh preview (vd khi đổi PREVIEW_TEXT).

Usage:
  cd /Users/tienthuan/Desktop/VoxStudio
  python scripts/build_voice_previews.py
  python scripts/build_voice_previews.py --voices nu_mai_anh,nam_quoc_bao
  python scripts/build_voice_previews.py --redo   # overwrite preview cũ
"""

import argparse
import gc
import json
import sys
import time
from pathlib import Path

import soundfile as sf
import torch
from omnivoice import OmniVoice


def _free_memory(device: str):
    """Force-free MPS/CUDA cache giữa các iteration để tránh OOM."""
    gc.collect()
    if device.startswith("cuda") and torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif device == "mps" and torch.backends.mps.is_available():
        torch.mps.empty_cache()


# Template preview — personalize {name}. ~8-10s, mention app capability.
# Mỗi voice tự đọc intro bằng ngôn ngữ NATIVE của giọng (Emma nói English,
# ゆき nói Japanese...) → user nghe demo voice trên text mà voice optimize cho.
PREVIEW_TEMPLATES = {
    "vietnamese": (
        "Xin chào, tôi là {name}, một trong những giọng đọc của VoxStudio. "
        "Tôi có thể giúp bạn lồng tiếng video, đọc sách nói, "
        "hoặc làm người dẫn chuyện cho nội dung của bạn."
    ),
    "english": (
        "Hello, I'm {name}, one of the voices from VoxStudio. "
        "I can help you narrate videos, read audiobooks, "
        "or be the voice for your content."
    ),
    "chinese": (
        "你好，我是{name}，VoxStudio的语音之一。"
        "我可以帮您为视频配音、朗读有声书，"
        "或为您的内容担任旁白。"
    ),
    "japanese": (
        "こんにちは、{name}と申します。VoxStudioの音声の一つです。"
        "動画のナレーション、オーディオブックの朗読、"
        "コンテンツのナレーターをお手伝いします。"
    ),
    "korean": (
        "안녕하세요, 저는 VoxStudio의 음성 중 하나인 {name}입니다. "
        "동영상 더빙, 오디오북 낭독, "
        "콘텐츠의 내레이션을 도와드릴 수 있습니다."
    ),
    "french": (
        "Bonjour, je suis {name}, l'une des voix de VoxStudio. "
        "Je peux vous aider à narrer des vidéos, à lire des livres audio, "
        "ou à donner voix à votre contenu."
    ),
    "spanish": (
        "Hola, soy {name}, una de las voces de VoxStudio. "
        "Puedo ayudarle a narrar videos, leer audiolibros, "
        "o ser la voz de su contenido."
    ),
}
# Fallback nếu language không match — dùng English (universal).
PREVIEW_FALLBACK_LANG = "english"
# Backward-compat alias — code cũ dùng PREVIEW_TEXT.
PREVIEW_TEXT = PREVIEW_TEMPLATES["vietnamese"]


def get_preview_template(language: str) -> str:
    """Lookup template theo voice.language. Fallback English nếu không có."""
    return PREVIEW_TEMPLATES.get((language or "").lower(),
                                  PREVIEW_TEMPLATES[PREVIEW_FALLBACK_LANG])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voices-dir", default="./voxstudio-engine/voices",
                    help="Folder chứa .pt + .json files")
    ap.add_argument("--voices", default="all",
                    help="Comma-separated slugs hoặc 'all'")
    ap.add_argument("--model", default="k2-fsa/OmniVoice")
    ap.add_argument("--device", default="auto", help="auto | mps | cuda | cpu")
    ap.add_argument("--redo", action="store_true",
                    help="Regenerate kể cả khi _preview.wav đã có")
    ap.add_argument("--text", default=None,
                    help="Override PREVIEW_TEXT (sẽ {name}.format)")
    args = ap.parse_args()

    voices_dir = Path(args.voices_dir)
    if not voices_dir.exists():
        print(f"✗ Folder không tồn tại: {voices_dir}")
        sys.exit(1)

    # Scan .pt + .json pairs
    pt_files = sorted(voices_dir.glob("*.pt"))
    candidates = []
    for pt in pt_files:
        json_file = pt.with_suffix(".json")
        if not json_file.exists():
            # Voice cũ không có metadata — skip preview (cần display_name)
            print(f"  ⚠ Skip {pt.name}: không có .json metadata")
            continue
        try:
            meta = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  ⚠ Skip {pt.name}: invalid metadata ({e})")
            continue
        candidates.append((pt, meta))

    if not candidates:
        print("✗ Không tìm thấy preset voice nào (cần .pt + .json sidecar).")
        sys.exit(1)

    # Filter
    if args.voices != "all":
        wanted = set(args.voices.split(","))
        candidates = [(pt, m) for pt, m in candidates if m.get("slug") in wanted]
        if not candidates:
            print("✗ Không match voice nào.")
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

    # Override template (CLI flag) áp dụng cho mọi voice. Mặc định: tự pick
    # template theo voice.language → mỗi voice nói intro bằng ngôn ngữ native.
    cli_template = args.text  # None = pick theo language

    print(f"Loading OmniVoice on {device}...")
    t0 = time.time()
    model = OmniVoice.from_pretrained(args.model, device_map=device)
    print(f"✓ Model loaded in {time.time() - t0:.0f}s")
    sr = model.sampling_rate

    print(f"\nBuilding {len(candidates)} previews...\n")

    n_success = 0
    n_skipped = 0
    n_failed = 0
    for i, (pt_path, meta) in enumerate(candidates, 1):
        slug = meta.get("slug", pt_path.stem)
        display_name = meta.get("display_name", slug)
        gender = meta.get("gender", "")
        preview_path = voices_dir / f"{slug}_preview.wav"

        if preview_path.exists() and not args.redo:
            print(f"  [{i}/{len(candidates)}] {slug} — skipped (đã có preview, dùng --redo để override)")
            n_skipped += 1
            continue

        emoji = "👩" if gender == "female" else "👨"
        # Pick template theo voice.language (vd 'english' → English template).
        # CLI --text override luôn applies (cho dev cần test custom text).
        voice_lang = (meta.get("language") or "vietnamese").lower()
        template = cli_template or get_preview_template(voice_lang)
        print(f"  [{i}/{len(candidates)}] {emoji} {slug} · {display_name} · {voice_lang}")
        t1 = time.time()

        # Free memory TRƯỚC mỗi generate (quan trọng cho MPS)
        _free_memory(device)

        # Load voice embedding
        try:
            voice_prompt = torch.load(str(pt_path), map_location=device, weights_only=False)
        except Exception as e:
            print(f"       ✗ load .pt fail: {e}")
            n_failed += 1
            continue

        # Personalize text với tên giọng
        text = template.format(name=display_name)

        try:
            with torch.no_grad():
                audio_out = model.generate(
                    text=text,
                    voice_clone_prompt=voice_prompt,
                    num_step=32,
                    guidance_scale=2.0,
                )
            waveform = audio_out[0].squeeze(0).cpu().numpy()
            # Free GPU tensors NGAY trước khi write file
            del audio_out, voice_prompt
            _free_memory(device)
        except Exception as e:
            print(f"       ✗ generate fail: {e}")
            # Clean up partial state để iteration kế không bị poisoned
            try:
                del voice_prompt
            except UnboundLocalError:
                pass
            _free_memory(device)
            n_failed += 1
            continue

        sf.write(str(preview_path), waveform, sr)
        dur = len(waveform) / sr
        size_kb = preview_path.stat().st_size / 1024
        print(f"       ✓ {preview_path.name} · {dur:.1f}s · {size_kb:.0f} KB ({time.time() - t1:.0f}s)")
        n_success += 1

    total = time.time() - t0
    print(f"\n✓ Done in {total:.0f}s. Success: {n_success} · Skipped: {n_skipped} · Failed: {n_failed}")
    print(f"  Preview files: {voices_dir.resolve()}/<slug>_preview.wav")
    print(f"\n→ Backend có thể serve các file này qua endpoint /voices/<slug>/preview")
    # Exit non-zero nếu có failure → bash wrapper detect được đúng
    if n_failed > 0 and n_success == 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
