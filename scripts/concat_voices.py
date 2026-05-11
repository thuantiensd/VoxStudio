"""
Concat các file .wav trong folder thành 1 file dài (cho voice clone).
Mỗi đoạn cách nhau 0.3s silence để TTS engine pick rhythm tự nhiên.

Usage:
  python scripts/concat_voices.py [--src ./voices_aihoa] [--out Ái_Hòa_combined.wav]
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import soundfile as sf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="./voices_aihoa")
    ap.add_argument("--out", default=None,
                    help="Output filename (default: <speaker>_combined.wav trong --src)")
    ap.add_argument("--silence", type=float, default=0.3,
                    help="Silence giữa các đoạn (giây)")
    args = ap.parse_args()

    src_dir = Path(args.src)
    if not src_dir.exists():
        print(f"✗ Folder không tồn tại: {src_dir}")
        sys.exit(1)

    wav_files = sorted(src_dir.glob("*.wav"))
    # Loại bỏ file combined cũ
    wav_files = [f for f in wav_files if "_combined" not in f.name]
    if not wav_files:
        print(f"✗ Không có .wav nào trong {src_dir}")
        sys.exit(1)

    print(f"Tìm thấy {len(wav_files)} file .wav:")
    for f in wav_files:
        info = sf.info(str(f))
        print(f"  {f.name} · {info.duration:.2f}s · {info.samplerate}Hz")

    # Load tất cả → resample về same sr nếu khác
    audios = []
    sr_ref = None
    total_dur = 0
    for f in wav_files:
        arr, sr = sf.read(str(f))
        if sr_ref is None:
            sr_ref = sr
        elif sr != sr_ref:
            print(f"  ⚠ {f.name} có sr={sr} khác {sr_ref}, skip")
            continue
        # Mono only — nếu stereo, average
        if arr.ndim == 2:
            arr = arr.mean(axis=1)
        audios.append(arr)
        total_dur += len(arr) / sr_ref

    if not audios:
        print("✗ Không có audio hợp lệ")
        sys.exit(1)

    # Concat với silence
    silence_samples = int(args.silence * sr_ref)
    silence = np.zeros(silence_samples, dtype=audios[0].dtype)
    parts = []
    for i, arr in enumerate(audios):
        if i > 0:
            parts.append(silence)
        parts.append(arr)
    combined = np.concatenate(parts)
    final_dur = len(combined) / sr_ref

    # Output filename
    if args.out:
        out_path = Path(args.out)
    else:
        # Try detect speaker name từ first file
        stem = wav_files[0].stem  # e.g. "Ái_Hòa_01_8.2s"
        speaker = "_".join(stem.split("_")[:-2]) if "_" in stem else stem
        out_path = src_dir / f"{speaker}_combined_{final_dur:.0f}s.wav"

    sf.write(str(out_path), combined, sr_ref)

    # Concat all transcripts
    txt_path = out_path.with_suffix(".txt")
    full_text = []
    for f in wav_files:
        t = f.with_suffix(".txt")
        if t.exists():
            full_text.append(t.read_text(encoding="utf-8").strip())
    txt_path.write_text(" ".join(full_text), encoding="utf-8")

    size_mb = out_path.stat().st_size / 1e6
    print(f"\n✓ Combined output:")
    print(f"  {out_path.name} · {final_dur:.1f}s · {sr_ref}Hz · {size_mb:.1f}MB")
    print(f"  Transcript: {txt_path.name} · {len(' '.join(full_text))} chars")
    print(f"\n→ Dùng file này làm reference cho voice clone:")
    print(f"  {out_path.resolve()}")


if __name__ == "__main__":
    main()
