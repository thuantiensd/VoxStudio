"""
v4 — Tải N segment ngắn của 1 speaker rồi concat thành 1 file dài.

Workflow tối ưu cho mạng yếu + dataset segment ngắn:
  1. Scan metadata API (rất nhẹ)
  2. Tải N audio match speaker (đủ ngắn, ~5-10MB tổng)
  3. Tự động concat thành 1 file reference dài 1-2 phút
  4. Save transcript gộp

Usage:
  python scripts/download_v4_concat.py --speaker "Ái_Hòa" --start-page 10395 --n 15
"""

import argparse
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.parse
from pathlib import Path

import numpy as np
import soundfile as sf

API = "https://datasets-server.huggingface.co/rows"
PAGE_SIZE = 100


def get_token():
    t = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if t: return t.strip()
    for p in [Path.home() / ".cache/huggingface/token", Path.home() / ".huggingface/token"]:
        if p.exists():
            return p.read_text().strip()
    return None


def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def safe_name(s):
    nfkd = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9_-]", "_", nfkd) or "voice"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", required=True, help='Tên speaker, vd "Ái_Hòa"')
    ap.add_argument("--out", default="./voices_aihoa")
    ap.add_argument("--n", type=int, default=15, help="Số segment cần tải")
    ap.add_argument("--dataset", default="thivux/phoaudiobook")
    ap.add_argument("--split", default="train")
    ap.add_argument("--start-page", type=int, default=10395)
    ap.add_argument("--max-pages", type=int, default=20)
    ap.add_argument("--silence", type=float, default=0.3, help="Silence giữa segment (giây)")
    ap.add_argument("--no-concat", action="store_true", help="Skip bước concat cuối")
    args = ap.parse_args()

    token = get_token()
    if not token:
        print("✗ Cần HF token. Run: hf auth login", file=sys.stderr); sys.exit(1)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    speaker_safe = safe_name(args.speaker)

    print(f"Tải {args.n} segment của '{args.speaker}' từ page {args.start_page} (max {args.max_pages} pages)\n")

    # Phase 1: Scan + collect URLs
    candidates = []  # (page, idx, audio_url, text)
    seen = matched = 0
    speakers_seen = {}
    t0 = time.time()
    headers = {"Authorization": f"Bearer {token}"}

    for page_idx in range(args.start_page, args.start_page + args.max_pages):
        if len(candidates) >= args.n:
            break
        offset = page_idx * PAGE_SIZE
        qs = urllib.parse.urlencode({
            "dataset": args.dataset, "config": "default", "split": args.split,
            "offset": offset, "length": PAGE_SIZE,
        })
        try:
            data = json.loads(http_get(f"{API}?{qs}", headers=headers))
        except Exception as e:
            print(f"  page {page_idx}: API fail: {e}")
            continue
        for ri, item in enumerate(data.get("rows", [])):
            row = item.get("row", {})
            sp = str(row.get("speaker", ""))
            speakers_seen[sp] = speakers_seen.get(sp, 0) + 1
            seen += 1
            if sp != args.speaker:
                continue
            matched += 1
            audio = row.get("audio")
            url = None
            if isinstance(audio, list) and audio:
                url = audio[0].get("src")
            elif isinstance(audio, dict):
                url = audio.get("src") or audio.get("url")
            if not url:
                continue
            candidates.append((page_idx, ri, url, row.get("text", "")))
            if len(candidates) >= args.n:
                break
        elapsed = time.time() - t0
        rate = seen / elapsed if elapsed else 0
        print(f"  page {page_idx} · seen {seen} · matched {matched} · candidates {len(candidates)}/{args.n} · {rate:.0f} rows/s", end="\r", flush=True)

    elapsed = time.time() - t0
    print(f"\n\nScan xong. Time: {elapsed:.0f}s · Match: {matched} · Tải: {len(candidates)} segments\n")

    if not candidates:
        print(f"✗ Không match '{args.speaker}'.")
        print(f"\nTop speakers gặp được:")
        for sp, cnt in sorted(speakers_seen.items(), key=lambda x: -x[1])[:10]:
            print(f"  {cnt:>5}  {sp!r}")
        sys.exit(1)

    # Phase 2: Download + save audio + transcript
    print(f"Đang tải {len(candidates)} audio file...\n")
    saved_audios = []  # (np_array, sr, text, filename)
    sr_ref = None
    for i, (page, idx, url, text) in enumerate(candidates, 1):
        try:
            buf = http_get(url, headers=headers, timeout=60)
            arr, sr = sf.read(io.BytesIO(buf))
        except Exception as e:
            print(f"  #{i}: tải fail: {e}")
            continue
        if arr.ndim == 2:
            arr = arr.mean(axis=1)
        if sr_ref is None:
            sr_ref = sr
        elif sr != sr_ref:
            # Resample (simple linear) hoặc skip
            print(f"  #{i}: sr={sr} ≠ {sr_ref}, skip")
            continue
        dur = len(arr) / sr
        wav_name = f"{speaker_safe}_{i:02d}_{dur:.1f}s.wav"
        txt_name = f"{speaker_safe}_{i:02d}_{dur:.1f}s.txt"
        sf.write(str(out_dir / wav_name), arr, sr)
        (out_dir / txt_name).write_text(text, encoding="utf-8")
        saved_audios.append((arr, sr, text, wav_name))
        print(f"  ✓ #{i}: {dur:.1f}s · {wav_name}")

    if not saved_audios:
        print("\n✗ Không tải được audio nào.")
        sys.exit(1)

    if args.no_concat:
        print(f"\n✓ Done — {len(saved_audios)} segment saved to: {out_dir.resolve()}")
        return

    # Phase 3: Concat thành 1 file dài
    print(f"\nĐang gộp {len(saved_audios)} segment với {args.silence}s silence...")
    silence = np.zeros(int(args.silence * sr_ref), dtype=saved_audios[0][0].dtype)
    parts = []
    full_text = []
    for j, (arr, _sr, text, _name) in enumerate(saved_audios):
        if j > 0:
            parts.append(silence)
        parts.append(arr)
        full_text.append(text.strip())
    combined = np.concatenate(parts)
    combined_dur = len(combined) / sr_ref

    out_wav = out_dir / f"{speaker_safe}_combined_{combined_dur:.0f}s.wav"
    out_txt = out_dir / f"{speaker_safe}_combined_{combined_dur:.0f}s.txt"
    sf.write(str(out_wav), combined, sr_ref)
    out_txt.write_text(" ".join(full_text), encoding="utf-8")

    size_mb = out_wav.stat().st_size / 1e6
    print(f"\n✓ COMBINED: {out_wav.name}")
    print(f"  Duration: {combined_dur:.1f}s · {sr_ref}Hz · {size_mb:.1f}MB")
    print(f"  Transcript: {out_txt.name} · {len(' '.join(full_text))} chars")
    print(f"\n→ Dùng file này làm reference voice clone:")
    print(f"  {out_wav.resolve()}")


if __name__ == "__main__":
    main()
