"""CLI test cho translation pipeline 3-pass — chạy nhanh không cần video/TTS.

Iterate prompt cực nhanh: lấy segments có sẵn từ project (hoặc fixture) →
chạy Pass-0 + Pass-1 + Pass-2 → in side-by-side để check style.

Usage:
  cd server
  python scripts/test_translate.py <project_id>           # gemini default
  python scripts/test_translate.py <project_id> --engine openai
  python scripts/test_translate.py --sample               # built-in fixture

  GEMINI_API_KEY=... python scripts/test_translate.py ...
  OPENAI_API_KEY=... python scripts/test_translate.py ... --engine openai
  ANTHROPIC_API_KEY=... python scripts/test_translate.py ... --engine claude

  --limit N    cap số seg để test nhanh hơn

Output:
  • Pass-0 (analyze): speaker map JSON
  • Pass-1 vs Pass-2: bảng side-by-side (original | literal | polished)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path


logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
sys.stdout.reconfigure(line_buffering=True)

THIS = Path(__file__).resolve()
SERVER_DIR = THIS.parent.parent
sys.path.insert(0, str(SERVER_DIR))


SAMPLE_SEGMENTS = [
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
    proj_file = SERVER_DIR / "dubbing_projects" / project_id / "project.json"
    if not proj_file.exists():
        raise FileNotFoundError(f"Không tìm thấy {proj_file}")
    with open(proj_file) as f:
        p = json.load(f)
    segs = p.get("segments") or []
    if not segs:
        raise ValueError(f"Project {project_id} không có segments")
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


def print_pass0(rels: dict):
    print("\n" + "═" * 76)
    print("🔍 PASS-0: Speaker Analysis")
    print("═" * 76)
    if not rels:
        print("  (empty — skipped/failed; chỉ chạy khi ≥2 speakers)")
        return
    if rels.get("scene_context"):
        print(f"Scene:    {rels['scene_context']}")
    if rels.get("register"):
        print(f"Register: {rels['register']}")
    print()
    for spk_id, info in rels.get("speakers", {}).items():
        g = info.get("gender", "?")
        role = info.get("role", "?")
        self_p = info.get("self_pronoun", "?")
        addr = info.get("addresses", {})
        tpl = info.get("third_person_label", "")
        print(f"  {spk_id}: {role} ({g}) — xưng \"{self_p}\"")
        for k, v in addr.items():
            print(f"             (với) {k}→\"{v}\"")
        if tpl:
            print(f"             (ngôi 3) → \"{tpl}\"")
    print()


def print_side_by_side(segments, literal, polished):
    print("═" * 76)
    print("🌐 PASS-1 (Literal) vs PASS-2 (Editor/Polished)")
    print("═" * 76)
    for i, seg in enumerate(segments):
        spk = (seg.get("speaker") or "?")[:12]
        orig = seg["original_text"]
        lit = literal[i].get("translated_text", "") if i < len(literal) else ""
        pol = polished[i].get("translated_text", "") if i < len(polished) else ""
        print(f"\n#{seg['index']+1} [{spk}] gốc:    {orig}")
        print(f"          literal: {lit}")
        print(f"        polished: {pol}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project_id", nargs="?")
    ap.add_argument("--sample", action="store_true")
    ap.add_argument("--engine", default="gemini", choices=["gemini", "openai", "claude"])
    ap.add_argument("--source", default=None)
    ap.add_argument("--target", default="vi")
    ap.add_argument("--limit", type=int, default=0)
    # Visual context (Pass-(-1))
    ap.add_argument("--enable-visual", action="store_true",
                     help="Bật Pass-(-1) visual context analysis")
    ap.add_argument("--visual-engine", default=None,
                     help="Engine VLM: gemini|openai|claude (default = main engine)")
    ap.add_argument("--visual-model", default=None, help="Model VLM override")
    args = ap.parse_args()

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

    speakers = {s.get("speaker") for s in segments if s.get("speaker")}
    print(f"   ↳ {len(speakers)} unique speaker(s): {sorted(speakers) if speakers else '(none)'}")
    if not speakers:
        print("   ⚠️  Không có speaker → Pass-0 skip, dịch không anchor")
    print(f"🌍 {source_lang} → {target_lang} via {args.engine}\n")

    api_key = get_api_key(args.engine)
    if not api_key:
        env_var = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY",
                    "claude": "ANTHROPIC_API_KEY"}[args.engine]
        print(f"❌ Thiếu API key — set {env_var}=...", file=sys.stderr)
        sys.exit(1)
    if args.engine == "gemini":
        os.environ["GEMINI_API_KEY"] = api_key

    from app.services.llm import run_analyze, run_translate, run_edit
    from app.services.llm.prompts import _max_chars

    # Pass-(-1): Visual Context (optional)
    visual_ctx = {}
    if args.enable_visual and args.project_id:
        v_engine = args.visual_engine or args.engine
        v_key = get_api_key(v_engine) or api_key
        if not v_key:
            print(f"⚠️  Visual engine {v_engine} thiếu key — skip visual context")
        else:
            video_path = SERVER_DIR / "dubbing_projects" / args.project_id / "original.mp4"
            if not video_path.exists():
                print(f"⚠️  Không tìm thấy video {video_path} — skip visual context")
            else:
                print(f"⏱️  Running Pass-(-1) Visual Context via {v_engine}/{args.visual_model or '(default)'}...")
                tv = time.time()
                from app.services import visual_context_svc
                visual_ctx = visual_context_svc.analyze_video(
                    video_path=video_path, engine=v_engine,
                    api_key=v_key, model=args.visual_model, source_lang=source_lang,
                )
                print(f"   ↳ Visual done in {time.time()-tv:.1f}s")
                if visual_ctx:
                    print(f"   ↳ Genre: {visual_ctx.get('genre','?')}, Register: {visual_ctx.get('register','?')}")
                    print(f"   ↳ Scene: {visual_ctx.get('scene_summary','')[:80]}")
                    print(f"   ↳ Characters: {len(visual_ctx.get('characters',[]))}")
                    for c in visual_ctx.get("characters", []):
                        print(f"     • {c.get('id')}: {c.get('description')} — {c.get('gender')}, {c.get('likely_role')}")
                else:
                    print("   ↳ (empty — VLM call failed)")
                print()
    elif args.enable_visual:
        print("⚠️  --enable-visual yêu cầu --project_id (cần video thật)")
        print()

    # Pass-0
    print("⏱️  Running Pass-0 (analyze)...")
    t0 = time.time()
    rels = run_analyze(
        engine=args.engine, segments=segments, source_lang=source_lang,
        api_key=api_key, visual_context=visual_ctx or None,
    )
    print(f"   ↳ Pass-0 done in {time.time()-t0:.1f}s")
    print_pass0(rels)

    # Pass-1
    print(f"⏱️  Running Pass-1 (translator, {len(segments)} segs)...")
    t1 = time.time()
    literal = run_translate(
        engine=args.engine, segments=segments,
        target_lang=target_lang, source_lang=source_lang,
        speaker_relationships=rels, api_key=api_key,
    )
    print(f"   ↳ Pass-1 done in {time.time()-t1:.1f}s")

    # Pass-2
    print(f"⏱️  Running Pass-2 (editor)...")
    t2 = time.time()
    items = []
    for i, seg in enumerate(segments):
        items.append({
            "index": seg["index"],
            "speaker": seg.get("speaker"),
            "original": seg["original_text"],
            "literal": literal[i].get("translated_text", "") if i < len(literal) else "",
            "max_chars": _max_chars(seg),
        })
    polished = run_edit(
        engine=args.engine, items=items,
        target_lang=target_lang, source_lang=source_lang,
        speaker_relationships=rels, api_key=api_key,
    )
    print(f"   ↳ Pass-2 done in {time.time()-t2:.1f}s\n")

    print_side_by_side(segments, literal, polished)


if __name__ == "__main__":
    main()
