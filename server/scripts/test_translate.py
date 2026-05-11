"""CLI test cho translation pipeline — chạy nhanh không cần video/TTS.

Mục đích: iterate prompt translate (2-pass) cực nhanh. Lấy segments có sẵn
từ project đã transcribe → chạy Pass-1 + Pass-2 → in side-by-side.

Usage:
  cd server
  python scripts/test_translate.py <project_id>        # gemini default
  python scripts/test_translate.py <project_id> --engine openai
  python scripts/test_translate.py --sample            # built-in fixture

  # API key qua env (cùng env file backend dùng) hoặc inline:
  GEMINI_API_KEY=... python scripts/test_translate.py c8b18b98...
  OPENAI_API_KEY=... python scripts/test_translate.py c8b18b98... --engine openai
  ANTHROPIC_API_KEY=... python scripts/test_translate.py c8b18b98... --engine claude

Output:
  • Pass-1 result: speaker map JSON (relationships, register, scene)
  • Pass-2 side-by-side: # | speaker | original | translated
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

# Enable INFO logging → thấy progress Gemini retry/timeout
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

# Force unbuffered stdout — khi pipe qua `tee` print bị block-buffer,
# user thấy "đứng im" trong khi thực ra đang chạy.
sys.stdout.reconfigure(line_buffering=True)


# Inject server/ vào path để import app.services
THIS = Path(__file__).resolve()
SERVER_DIR = THIS.parent.parent
sys.path.insert(0, str(SERVER_DIR))


SAMPLE_SEGMENTS = [
    # Fixture: vợ chồng cãi nhau (zh)
    {"index": 0, "start": 0.0, "end": 2.0, "speaker": "SPEAKER_00",
     "original_text": "你今天又加班吗 老公"},
    {"index": 1, "start": 2.0, "end": 4.0, "speaker": "SPEAKER_01",
     "original_text": "对啊 老婆 公司最近事情多"},
    {"index": 2, "start": 4.0, "end": 6.5, "speaker": "SPEAKER_00",
     "original_text": "你都不管儿子了 他想你"},
    {"index": 3, "start": 6.5, "end": 9.0, "speaker": "SPEAKER_01",
     "original_text": "我也想小宝 这周末带他去公园"},
    {"index": 4, "start": 9.0, "end": 11.0, "speaker": "SPEAKER_02",
     "original_text": "爸爸 你回来了"},
    {"index": 5, "start": 11.0, "end": 13.0, "speaker": "SPEAKER_01",
     "original_text": "小宝 爸爸抱抱"},
    {"index": 6, "start": 13.0, "end": 15.5, "speaker": "SPEAKER_02",
     "original_text": "爸爸 我想跟你玩游戏"},
    {"index": 7, "start": 15.5, "end": 17.5, "speaker": "SPEAKER_00",
     "original_text": "宝贝 先吃饭好不好"},
]


def load_project_segments(project_id: str) -> tuple[list[dict], str, str]:
    """Load segments từ project.json. Return (segments, source_lang, target_lang)."""
    proj_dir = SERVER_DIR / "dubbing_projects" / project_id
    proj_file = proj_dir / "project.json"
    if not proj_file.exists():
        raise FileNotFoundError(f"Không tìm thấy {proj_file}")
    with open(proj_file) as f:
        p = json.load(f)
    segs = p.get("segments") or []
    if not segs:
        raise ValueError(f"Project {project_id} không có segments")
    # Chuẩn hoá: chỉ giữ field cần thiết cho translate
    clean = []
    for s in segs:
        clean.append({
            "index": s["index"],
            "start": s["start"],
            "end": s["end"],
            "speaker": s.get("speaker"),
            "original_text": s.get("original_text", "").strip(),
        })
    return clean, p.get("source_language", "auto"), p.get("target_language", "vi")


def get_api_key(engine: str) -> str | None:
    env_map = {
        "gemini": "GEMINI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "claude": "ANTHROPIC_API_KEY",
    }
    return os.environ.get(env_map.get(engine, ""))


def print_pass1(rels: dict):
    print("\n" + "═" * 70)
    print("🔍 PASS-1: Speaker Relationship Analysis")
    print("═" * 70)
    if not rels:
        print("  (empty — Pass-1 skipped or failed)")
        return
    if rels.get("scene_context"):
        print(f"Scene:    {rels['scene_context']}")
    if rels.get("register"):
        print(f"Register: {rels['register']}")
    print()
    speakers = rels.get("speakers", {})
    for spk_id, info in speakers.items():
        g = info.get("gender", "?")
        role = info.get("role", "?")
        self_p = info.get("self_pronoun", "?")
        addr = info.get("addresses", {})
        ev = info.get("evidence", "")[:80]
        print(f"  {spk_id}: {role} ({g}) — tự xưng \"{self_p}\"")
        for k, v in addr.items():
            print(f"             gọi {k} là \"{v}\"")
        if ev:
            print(f"             evidence: {ev}")
    print()


def print_pass2_table(segments: list[dict], translated: list[dict] | list[str]):
    print("═" * 70)
    print("🌐 PASS-2: Translation Results")
    print("═" * 70)
    print(f"{'#':<4}{'speaker':<14}{'original':<40}{'→':<3}{'translated'}")
    print("─" * 70)
    for i, seg in enumerate(segments):
        spk = (seg.get("speaker") or "?")[:12]
        orig = seg["original_text"][:38]
        if i < len(translated) and isinstance(translated[i], dict):
            tr = translated[i].get("translated_text", "") or "(empty)"
            tr = tr[:60]
        elif i < len(translated):
            tr = str(translated[i])[:60]
        else:
            tr = "(missing)"
        print(f"{seg['index']+1:<4}{spk:<14}{orig:<40} → {tr}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project_id", nargs="?", help="project ID trong dubbing_projects/")
    ap.add_argument("--sample", action="store_true", help="dùng fixture sample")
    ap.add_argument("--engine", default="gemini", choices=["gemini", "openai", "claude"])
    ap.add_argument("--source", default=None, help="override source lang")
    ap.add_argument("--target", default="vi")
    ap.add_argument("--limit", type=int, default=0, help="cap số seg (test nhanh)")
    args = ap.parse_args()

    # Load segments
    if args.sample or not args.project_id:
        segments = SAMPLE_SEGMENTS
        source_lang = args.source or "zh"
        target_lang = args.target
        print(f"📂 Source: built-in sample ({len(segments)} segs)")
    else:
        segments, src, tgt = load_project_segments(args.project_id)
        source_lang = args.source or src
        target_lang = args.target or tgt
        print(f"📂 Source: dubbing_projects/{args.project_id} ({len(segments)} segs)")

    if args.limit and args.limit > 0:
        segments = segments[: args.limit]
        print(f"   ↳ limited to first {len(segments)}")

    # Inspector: report segment structure
    speakers = {s.get("speaker") for s in segments if s.get("speaker")}
    print(f"   ↳ {len(speakers)} unique speaker(s): {sorted(speakers) if speakers else '(none — no diarization)'}")
    if not speakers:
        print("   ⚠️  Project chưa có diarization → Pass-1 sẽ SKIP (cần ≥2 speakers)")
        print("   ⚠️  Translation sẽ chạy KHÔNG có speaker anchor → xưng hô có thể sai")

    print(f"🌍 {source_lang} → {target_lang} via {args.engine}")

    # Get API key
    api_key = get_api_key(args.engine)
    if not api_key:
        env_var = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY",
                    "claude": "ANTHROPIC_API_KEY"}[args.engine]
        print(f"\n❌ Thiếu API key — set {env_var}=...", file=sys.stderr)
        sys.exit(1)

    # Set env cho GEMINI nếu chưa
    if args.engine == "gemini":
        os.environ["GEMINI_API_KEY"] = api_key

    # ── Run Pass-1 trực tiếp để in result ──
    print("\n⏱️  Running Pass-1 (speaker analysis)...")
    t0 = time.time()
    from app.services.llm import analyze_speakers
    rels = analyze_speakers(
        engine=args.engine,
        segments=segments,
        source_lang=source_lang,
        api_key=api_key,
        film_genre=None,
    )
    print(f"   ↳ Pass-1 done in {time.time()-t0:.1f}s")
    print_pass1(rels)

    # ── Run Pass-2 ──
    print(f"⏱️  Running Pass-2 (translation, {len(segments)} segs)...")
    t1 = time.time()
    if args.engine == "gemini":
        from app.services.gemini_translate_svc import translate_segments
        results = translate_segments(
            segments=segments,
            target_language=target_lang,
            source_language=source_lang,
            speaker_genders=None,
            film_genre=None,
        )
    else:
        from app.services.cloud_translate_svc import translate_texts
        texts = [s["original_text"] for s in segments]
        results = translate_texts(
            texts=texts,
            target=target_lang,
            source=source_lang,
            engine=args.engine,
            api_key=api_key,
            segments_meta=segments,
            speaker_genders=None,
            film_genre=None,
        )
    print(f"   ↳ Pass-2 done in {time.time()-t1:.1f}s")

    print_pass2_table(segments, results)


if __name__ == "__main__":
    main()
