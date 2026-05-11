"""
Tải 5 voice dài nhất của giọng "Ái_Hòa" từ dataset thivux/phoaudiobook.

Usage:
  python scripts/download_top5_aihoa.py [--out ./voices_aihoa] [--n 5] [--speaker Ái_Hòa]

Yêu cầu:
  pip install datasets soundfile huggingface_hub
  hf auth login   (hoặc export HF_TOKEN=...)

Tương thích cả datasets v3 (dict {array, sampling_rate}) và v4 (AudioDecoder).
"""

import argparse
import heapq
import sys
import time
from pathlib import Path

from datasets import load_dataset
from huggingface_hub import HfApi


def get_duration_fast(audio):
    """Lấy duration mà không decode full audio (qua metadata)."""
    # v4 AudioDecoder
    if hasattr(audio, "metadata"):
        meta = audio.metadata
        for attr in ("duration_seconds", "duration"):
            v = getattr(meta, attr, None)
            if v is not None:
                return float(v)
    # v3 dict
    if isinstance(audio, dict):
        arr = audio.get("array")
        sr = audio.get("sampling_rate")
        if arr is not None and sr:
            return len(arr) / float(sr)
    return None


def get_array_sr(audio):
    """Decode audio thành (numpy_array, sample_rate)."""
    # v4 AudioDecoder
    if hasattr(audio, "get_all_samples"):
        samples = audio.get_all_samples()
        # samples.data: torch tensor (channels, frames) hoặc (frames,)
        arr = samples.data
        if hasattr(arr, "numpy"):
            arr = arr.numpy()
        # Squeeze nếu mono channel dim
        try:
            import numpy as np
            arr = np.asarray(arr)
            if arr.ndim == 2 and arr.shape[0] == 1:
                arr = arr.squeeze(0)
        except Exception:
            pass
        return arr, int(samples.sample_rate)
    # v3 dict
    if isinstance(audio, dict):
        return audio["array"], int(audio["sampling_rate"])
    raise TypeError(f"Unsupported audio type: {type(audio)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./voices_aihoa")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--speaker", default="Ái_Hòa")
    ap.add_argument("--dataset", default="thivux/phoaudiobook")
    ap.add_argument("--split", default="train")
    ap.add_argument("--list-speakers", action="store_true",
                    help="Chỉ liệt kê speakers (mặc định scan tối đa --scan-rows)")
    ap.add_argument("--scan-rows", type=int, default=10000,
                    help="Số rows tối đa để scan (0 = full dataset). Default 10000 ~ 1-3 phút")
    ap.add_argument("--min-duration", type=float, default=20.0,
                    help="Skip audio ngắn hơn N giây (early skip — nhanh hơn)")
    ap.add_argument("--early-stop", type=int, default=0,
                    help="Dừng sau khi tìm đủ N candidates qua --min-duration (0 = không stop)")
    args = ap.parse_args()

    try:
        who = HfApi().whoami()
        print(f"✓ HF auth: {who.get('name', '?')}")
    except Exception as e:
        print(f"✗ Cần đăng nhập HF: {e}", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Streaming dataset {args.dataset} split={args.split}...")

    # ── Chế độ list speakers ───────────────────────────────────────────
    if args.list_speakers:
        from collections import Counter
        counts = Counter()
        ds = load_dataset(args.dataset, split=args.split, streaming=True)
        t0 = time.time()
        limit = args.scan_rows if args.scan_rows > 0 else 0
        for i, row in enumerate(ds):
            sp = str(row.get("speaker", ""))
            counts[sp] += 1
            if (i + 1) % 200 == 0:
                rate = (i + 1) / (time.time() - t0)
                if limit:
                    eta = (limit - i - 1) / rate if rate else 0
                    print(f"  scanned {i + 1}/{limit} · distinct {len(counts)} · {rate:.0f} rows/s · ETA {eta:.0f}s", end="\r", flush=True)
                else:
                    print(f"  scanned {i + 1} · distinct {len(counts)} · {rate:.0f} rows/s", end="\r", flush=True)
            if limit and (i + 1) >= limit:
                break
        elapsed = time.time() - t0
        print(f"\n\nQuét {sum(counts.values())} rows trong {elapsed:.0f}s. {len(counts)} speakers distinct:\n")
        for sp, cnt in counts.most_common():
            print(f"  {cnt:>5}  {sp!r}")
        return

    ds = load_dataset(args.dataset, split=args.split, streaming=True)

    # Inspect first row
    first = next(iter(ds))
    print(f"\nColumns: {list(first.keys())}")
    audio0 = first.get("audio")
    print(f"Audio type: {type(audio0).__name__}")
    if hasattr(audio0, "metadata"):
        meta = audio0.metadata
        print(f"  metadata: sample_rate={getattr(meta, 'sample_rate', '?')} duration={getattr(meta, 'duration_seconds', '?')}s")
    print(f"Sample text: {str(first.get('text', ''))[:100]!r}")
    print(f"Sample speaker: {first.get('speaker')!r}")

    # Heap top-N (min-heap)
    heap = []  # (duration, index, text, audio_obj)
    seen = matched = 0
    speakers_seen = {}  # name → count, để debug nếu 0 match
    t0 = time.time()

    # Re-iterate (first đã consume)
    ds = load_dataset(args.dataset, split=args.split, streaming=True)
    limit = args.scan_rows if args.scan_rows > 0 else 0
    print(f"Scan {'tối đa ' + str(limit) + ' rows' if limit else 'FULL dataset'} · "
          f"min-duration={args.min_duration}s · target speaker={args.speaker!r}\n")
    for i, row in enumerate(ds):
        seen += 1
        if seen % 200 == 0:
            elapsed = time.time() - t0
            rate = seen / elapsed if elapsed else 0
            if limit:
                eta = (limit - seen) / rate if rate else 0
                print(f"  scanned {seen}/{limit} · matched {matched} · top {len(heap)} · {rate:.0f} rows/s · ETA {eta:.0f}s", end="\r", flush=True)
            else:
                print(f"  scanned {seen} · matched {matched} · top {len(heap)} · {rate:.0f} rows/s", end="\r", flush=True)
        sp = str(row.get("speaker"))
        speakers_seen[sp] = speakers_seen.get(sp, 0) + 1
        if sp != args.speaker:
            if limit and seen >= limit:
                break
            continue
        matched += 1
        dur = get_duration_fast(row["audio"])
        if dur is None or dur < args.min_duration:
            if limit and seen >= limit:
                break
            continue
        item = (dur, i, row.get("text", ""), row["audio"])
        if len(heap) < args.n:
            heapq.heappush(heap, item)
        elif dur > heap[0][0]:
            heapq.heappushpop(heap, item)
        # Early stop nếu đã có đủ N candidates qua min-duration
        if args.early_stop and len(heap) >= args.n and matched >= args.early_stop:
            print(f"\n  → Early stop: đã có {len(heap)} candidates ≥ {args.min_duration}s")
            break
        if limit and seen >= limit:
            break

    elapsed = time.time() - t0
    print(f"\n\nĐã quét {seen} rows trong {elapsed:.0f}s · match '{args.speaker}': {matched}")
    if not heap:
        print(f"✗ Không có row nào match speaker '{args.speaker}'.")
        # Show top speakers gặp được — user pick đúng tên
        if speakers_seen:
            print(f"\n10 speakers phổ biến nhất gặp được trong scan:")
            for sp, cnt in sorted(speakers_seen.items(), key=lambda x: -x[1])[:10]:
                print(f"  {cnt:>5}  {sp!r}")
            print(f"\n→ Chạy lại với --speaker đúng tên (copy chính xác từ trên, kèm dấu ngoặc nếu có space).")
            print(f"  Hoặc: python {sys.argv[0]} --list-speakers  (để xem hết)")
        sys.exit(1)

    # Sort top desc
    top = sorted(heap, reverse=True)
    print(f"\nTop {len(top)} dài nhất — đang decode + save...\n")

    import soundfile as sf
    for rank, (dur, idx, text, audio) in enumerate(top, 1):
        text_preview = (text[:80] + "…") if len(text) > 80 else text
        print(f"  #{rank}: {dur:.2f}s · idx={idx}")
        print(f"     text: {text_preview!r}")
        try:
            arr, sr = get_array_sr(audio)
        except Exception as e:
            print(f"     ✗ decode failed: {e}")
            continue
        # Filename safe
        speaker_safe = args.speaker.replace("/", "_").replace(" ", "_")
        wav_path = out_dir / f"{speaker_safe}_{rank:02d}_{dur:.1f}s.wav"
        txt_path = out_dir / f"{speaker_safe}_{rank:02d}_{dur:.1f}s.txt"
        sf.write(str(wav_path), arr, sr)
        txt_path.write_text(text, encoding="utf-8")
        size_kb = wav_path.stat().st_size / 1024
        print(f"     → {wav_path.name} · {size_kb:.0f} KB · {sr} Hz")

    print(f"\n✓ Done. Files saved to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
