"""
v3 FAST — dùng HuggingFace dataset viewer API.

Approach NHANH NHẤT cho mạng yếu:
  1. Scan rows qua /rows API (chỉ JSON metadata ~KB/page, không tải audio)
  2. Mỗi row có direct URL tới audio file
  3. Filter speaker — track top-N duration
  4. CUỐI CÙNG mới tải đúng 5 audio file đã chọn

Tổng download:
  - Metadata: ~1-5 MB (vài chục pages × ~50KB)
  - Audio: ~5 file × 5-10 MB = 25-50 MB

Vs streaming v1: 100x ít data hơn vì không tải audio bytes mà mọi row đều có.

Usage:
  python scripts/download_top5_v3_fast.py
  python scripts/download_top5_v3_fast.py --speaker "Ái_Hòa" --n 5 --max-pages 50
"""

import argparse
import heapq
import os
import sys
import time
import urllib.request
import urllib.parse
import json
import io
from pathlib import Path

API_BASE = "https://datasets-server.huggingface.co"
PAGE_SIZE = 100  # max rows per /rows call


def get_token():
    t = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if t:
        return t.strip()
    for p in [Path.home() / ".cache/huggingface/token",
              Path.home() / ".huggingface/token"]:
        if p.exists():
            return p.read_text().strip()
    return None


def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_rows(dataset, split, offset, length, token):
    qs = urllib.parse.urlencode({
        "dataset": dataset,
        "config": "default",
        "split": split,
        "offset": offset,
        "length": length,
    })
    url = f"{API_BASE}/rows?{qs}"
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return json.loads(http_get(url, headers=headers))


def get_audio_url_from_row(row_data):
    """Extract audio URL từ row payload (cấu trúc viewer API)."""
    audio = row_data.get("audio")
    if isinstance(audio, list) and audio:
        # Format: [{"src": "https://...", "type": "audio/..."}]
        return audio[0].get("src")
    if isinstance(audio, dict):
        return audio.get("src") or audio.get("url")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./voices_aihoa")
    ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--speaker", default="Ái_Hòa")
    ap.add_argument("--dataset", default="thivux/phoaudiobook")
    ap.add_argument("--split", default="train")
    ap.add_argument("--max-pages", type=int, default=50,
                    help="Tối đa N pages × 100 rows = N×100 rows. Default 50 = 5000 rows")
    ap.add_argument("--start-page", type=int, default=0)
    args = ap.parse_args()

    token = get_token()
    if not token:
        print("✗ Cần HF token. Chạy: hf auth login", file=sys.stderr)
        sys.exit(1)
    print(f"✓ HF token loaded ({len(token)} chars)")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Probe first page để xem schema
    print(f"\nProbe API /rows endpoint...")
    try:
        data = fetch_rows(args.dataset, args.split, 0, 1, token)
    except Exception as e:
        print(f"✗ API error: {e}")
        print("  Có thể do dataset gated — kiểm tra token có quyền truy cập không.")
        sys.exit(1)

    total_rows = data.get("num_rows_total") or data.get("num_total_rows")
    features = data.get("features", [])
    print(f"  Total rows: {total_rows}")
    print(f"  Features: {[f.get('name') for f in features]}")
    if data.get("rows"):
        sample = data["rows"][0].get("row", {})
        print(f"  Sample audio field: {str(sample.get('audio'))[:200]}")

    # 2. Scan pages, collect top-N
    heap = []  # (duration, page, idx_in_page, text, audio_url)
    speakers_seen = {}
    matched = 0
    seen = 0
    t0 = time.time()

    for page_idx in range(args.start_page, args.start_page + args.max_pages):
        offset = page_idx * PAGE_SIZE
        if total_rows and offset >= total_rows:
            print(f"\n  Hết dataset ở offset {offset}.")
            break
        try:
            data = fetch_rows(args.dataset, args.split, offset, PAGE_SIZE, token)
        except Exception as e:
            print(f"\n  Page {page_idx} fail: {e}")
            time.sleep(1)
            continue
        rows = data.get("rows", [])
        if not rows:
            break
        for ri, item in enumerate(rows):
            row = item.get("row", {})
            sp = str(row.get("speaker", ""))
            speakers_seen[sp] = speakers_seen.get(sp, 0) + 1
            seen += 1
            if sp != args.speaker:
                continue
            matched += 1
            # Get duration: try metadata or audio array
            audio = row.get("audio")
            audio_url = get_audio_url_from_row(row)
            # Estimate duration from text length (proxy) hoặc fetch HEAD?
            # Viewer API sometimes returns "duration" as separate field.
            dur = row.get("duration")
            if dur is None:
                # Proxy: count words trong text — không phải duration thực, nhưng
                # text dài thường = audio dài. Sẽ refine top-N bằng tải audio thực sau.
                text = str(row.get("text", ""))
                dur = len(text.split())  # word count as proxy ranking
            else:
                dur = float(dur)
            text = row.get("text", "")
            item_h = (dur, page_idx, ri, text, audio_url)
            if len(heap) < args.n * 3:  # giữ rộng hơn để re-rank sau
                heapq.heappush(heap, item_h)
            elif dur > heap[0][0]:
                heapq.heappushpop(heap, item_h)

        elapsed = time.time() - t0
        print(f"  page {page_idx + 1}/{args.start_page + args.max_pages} · seen {seen} · matched {matched} · candidates {len(heap)} · {elapsed:.0f}s", end="\r", flush=True)

    elapsed = time.time() - t0
    print(f"\n\n=== Scan xong ===")
    print(f"Pages: {page_idx - args.start_page + 1} · Seen: {seen} rows · Match '{args.speaker}': {matched}")
    print(f"Time: {elapsed:.0f}s\n")

    if not heap:
        print(f"✗ Không match speaker '{args.speaker}'.")
        print(f"\nSpeakers gặp được:")
        for sp, cnt in sorted(speakers_seen.items(), key=lambda x: -x[1])[:10]:
            print(f"  {cnt:>5}  {sp!r}")
        print(f"\n→ Thử lại với speaker đúng + --max-pages cao hơn.")
        sys.exit(1)

    # 3. Re-rank candidates bằng download header → duration thực
    print(f"Có {len(heap)} candidates. Đang đo duration thực qua audio header...")
    import soundfile as sf
    refined = []
    for dur_proxy, page, idx, text, url in heap:
        if not url:
            continue
        try:
            # Download chỉ first 1MB để get header
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req, timeout=20) as r:
                # Đọc 256KB đầu (đủ cho WAV/FLAC header)
                buf = r.read(256 * 1024)
            try:
                info = sf.info(io.BytesIO(buf))
                real_dur = info.duration
            except Exception:
                # Header chưa đủ → tải full
                req2 = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
                with urllib.request.urlopen(req2, timeout=60) as r:
                    buf = r.read()
                info = sf.info(io.BytesIO(buf))
                real_dur = info.duration
            refined.append((real_dur, page, idx, text, url, buf))
            print(f"  page{page} idx{idx}: real_dur={real_dur:.1f}s · text={text[:50]!r}")
        except Exception as e:
            print(f"  page{page} idx{idx}: header fetch fail: {e}")

    if not refined:
        print("✗ Không lấy được duration thực.")
        sys.exit(1)

    refined.sort(reverse=True)
    top = refined[:args.n]

    # 4. Tải full audio cho top-N + save
    print(f"\nĐang tải full audio + save top {len(top)}:\n")
    speaker_safe = args.speaker.replace("/", "_").replace(" ", "_")
    for rank, (dur, page, idx, text, url, partial_buf) in enumerate(top, 1):
        # Tải full
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                full_bytes = r.read()
            arr, sr = sf.read(io.BytesIO(full_bytes))
        except Exception as e:
            print(f"  #{rank}: download fail: {e}")
            continue
        wav_path = out_dir / f"{speaker_safe}_{rank:02d}_{dur:.1f}s.wav"
        txt_path = out_dir / f"{speaker_safe}_{rank:02d}_{dur:.1f}s.txt"
        sf.write(str(wav_path), arr, sr)
        txt_path.write_text(text, encoding="utf-8")
        size_mb = wav_path.stat().st_size / 1e6
        print(f"  #{rank}: {dur:.1f}s · {sr} Hz · {size_mb:.1f} MB")
        print(f"     → {wav_path.name}")

    print(f"\n✓ Done. Saved to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
