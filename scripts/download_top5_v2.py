"""
v2: Tải 5 voice dài nhất của giọng "Ái_Hòa" — TỐI ƯU CHO MẠNG YẾU.

Approach:
  1. List parquet files trong dataset (1 API call nhỏ)
  2. Tải TỪNG parquet file (~20-50MB), scan tại chỗ
  3. Khi tìm đủ 5 candidate ≥ min-duration → STOP, không tải tiếp
  4. Decode 5 audio + save .wav

So với v1 streaming row-by-row, v2 tốt hơn cho mạng yếu vì:
  - Mỗi parquet là 1 lần HTTP request (không phải N lần như stream)
  - Pyarrow read column-only (không decode audio bytes)
  - sf.info() đọc header, không decode waveform

Usage:
  python scripts/download_top5_v2.py
  python scripts/download_top5_v2.py --speaker "Ái_Hòa" --n 5 --min-duration 20
  python scripts/download_top5_v2.py --max-files 5   # chỉ thử 5 parquet đầu
"""

import argparse
import heapq
import io
import sys
import time
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download
import pyarrow.parquet as pq
import soundfile as sf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./voices_aihoa")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--speaker", default="Ái_Hòa")
    ap.add_argument("--dataset", default="thivux/phoaudiobook")
    ap.add_argument("--min-duration", type=float, default=20.0,
                    help="Skip audio ngắn hơn N giây")
    ap.add_argument("--max-files", type=int, default=20,
                    help="Tối đa thử N parquet files (mặc định 20). Mỗi file ~20-50MB")
    ap.add_argument("--list-files", action="store_true",
                    help="Chỉ liệt kê parquet files có sẵn rồi thoát")
    args = ap.parse_args()

    # Auth check
    try:
        who = HfApi().whoami()
        print(f"✓ HF auth: {who.get('name', '?')}")
    except Exception as e:
        print(f"✗ Cần đăng nhập HF: {e}", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. List parquet files
    print(f"Listing parquet files trong {args.dataset}...")
    api = HfApi()
    files = api.list_repo_files(args.dataset, repo_type="dataset")
    parquet_files = sorted([f for f in files if f.endswith(".parquet")])
    print(f"  → {len(parquet_files)} parquet files")
    if not parquet_files:
        print("✗ Không tìm thấy parquet file.")
        sys.exit(1)

    if args.list_files:
        for f in parquet_files[:50]:
            print(f"  {f}")
        if len(parquet_files) > 50:
            print(f"  ... và {len(parquet_files) - 50} file nữa")
        return

    # Heap top-N
    heap = []  # (dur, file_idx, row_idx, text, audio_bytes)
    files_scanned = 0
    matched_total = 0
    speakers_seen = {}
    t0 = time.time()

    for fi, parquet_path in enumerate(parquet_files):
        if files_scanned >= args.max_files:
            break
        files_scanned += 1
        elapsed = time.time() - t0
        print(f"\n[{fi + 1}/{min(args.max_files, len(parquet_files))}] Tải {parquet_path}...")
        try:
            local = hf_hub_download(
                args.dataset,
                parquet_path,
                repo_type="dataset",
            )
        except Exception as e:
            print(f"  ✗ Tải fail: {e}")
            continue

        size_mb = Path(local).stat().st_size / 1e6
        print(f"  ✓ Local: {Path(local).name} · {size_mb:.1f} MB · cumulative {elapsed:.0f}s")

        # Open parquet
        try:
            pf = pq.ParquetFile(local)
        except Exception as e:
            print(f"  ✗ Open parquet fail: {e}")
            continue

        rows_in_file = pf.metadata.num_rows
        print(f"  Rows trong file: {rows_in_file}")

        # Scan column speaker first (cheap: chỉ load 1 col)
        try:
            speaker_table = pf.read(columns=["speaker"])
            speakers = speaker_table["speaker"].to_pylist()
        except Exception as e:
            print(f"  ✗ Read speaker col fail: {e}")
            continue

        for sp in speakers:
            speakers_seen[str(sp)] = speakers_seen.get(str(sp), 0) + 1

        # Indices match speaker
        match_indices = [i for i, sp in enumerate(speakers) if str(sp) == args.speaker]
        print(f"  Speaker '{args.speaker}': {len(match_indices)} rows trong file này")
        if not match_indices:
            continue

        matched_total += len(match_indices)
        # Read full row chỉ cho match_indices (audio + text)
        try:
            full = pf.read(columns=["audio", "text"])
            audios = full["audio"].to_pylist()
            texts = full["text"].to_pylist()
        except Exception as e:
            print(f"  ✗ Read audio/text fail: {e}")
            continue

        for idx in match_indices:
            audio = audios[idx]
            # audio dict: {"bytes": ..., "path": ...}
            audio_bytes = audio.get("bytes") if isinstance(audio, dict) else None
            if not audio_bytes:
                continue
            try:
                info = sf.info(io.BytesIO(audio_bytes))
                dur = info.duration
            except Exception:
                continue
            if dur < args.min_duration:
                continue
            item = (dur, fi, idx, texts[idx] or "", audio_bytes)
            if len(heap) < args.n:
                heapq.heappush(heap, item)
            elif dur > heap[0][0]:
                heapq.heappushpop(heap, item)

        print(f"  Top heap hiện có {len(heap)}/{args.n} candidates "
              f"(min={heap[0][0]:.1f}s, max={max(h[0] for h in heap):.1f}s)" if heap else f"  Top heap còn trống")

        # Early stop khi đã đủ + có buffer (chắc chắn top 5 stable)
        if len(heap) >= args.n:
            # Check: nếu next file scan likely không vượt qua min của heap
            # Vì heap đã đủ args.n và min-duration thấp → assume đủ rồi
            print(f"\n  ✓ Đã đủ {args.n} candidates. Kiểm tra parquet kế tiếp để chắc top 5...")
            # Scan thêm 1-2 file nữa nếu còn budget
            if files_scanned >= 3 and len(heap) >= args.n:
                print(f"  ✓ Stop early sau {files_scanned} files.")
                break

    elapsed = time.time() - t0
    print(f"\n\n=== Kết quả ===")
    print(f"Files tải: {files_scanned} · Total time: {elapsed:.0f}s")
    print(f"Match speaker '{args.speaker}': {matched_total} rows")
    print(f"Đủ duration ≥ {args.min_duration}s: {len(heap)}")

    if not heap:
        print(f"\n✗ Không có audio nào match speaker + duration.")
        print(f"\nTop speakers gặp được trong {files_scanned} files:")
        for sp, cnt in sorted(speakers_seen.items(), key=lambda x: -x[1])[:10]:
            print(f"  {cnt:>5}  {sp!r}")
        print(f"\n→ Thử lại với --speaker đúng tên hoặc --min-duration thấp hơn.")
        sys.exit(1)

    # Save top N
    top = sorted(heap, reverse=True)
    print(f"\nĐang save top {len(top)}:\n")
    speaker_safe = args.speaker.replace("/", "_").replace(" ", "_")
    for rank, (dur, fi, idx, text, audio_bytes) in enumerate(top, 1):
        # Decode + save .wav
        try:
            arr, sr = sf.read(io.BytesIO(audio_bytes))
        except Exception as e:
            print(f"  #{rank}: decode fail: {e}")
            continue
        wav_path = out_dir / f"{speaker_safe}_{rank:02d}_{dur:.1f}s.wav"
        txt_path = out_dir / f"{speaker_safe}_{rank:02d}_{dur:.1f}s.txt"
        sf.write(str(wav_path), arr, sr)
        txt_path.write_text(text, encoding="utf-8")

        text_preview = (text[:80] + "…") if len(text) > 80 else text
        print(f"  #{rank}: {dur:.2f}s · {sr} Hz · file{fi:03d}/idx{idx}")
        print(f"     text: {text_preview!r}")
        print(f"     → {wav_path.name}")

    print(f"\n✓ Done. Saved to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
