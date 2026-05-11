"""Dump prompts LLM thực sự nhận — để debug/review.

Usage:
  cd server
  python scripts/dump_prompts.py        # in ra stdout
  python scripts/dump_prompts.py > /tmp/prompts.txt   # lưu file
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.llm.prompts import (
    build_speaker_analysis_prompt,
    build_translation_prompt,
)

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
]

SAMPLE_RELATIONSHIPS = {
    "scene_context": "Vợ chồng + con trai. Vợ trách chồng tăng ca nhiều.",
    "register": "family/modern",
    "speakers": {
        "SPEAKER_00": {"gender": "female", "role": "vợ", "self_pronoun": "em",
                        "addresses": {"SPEAKER_01": "anh", "SPEAKER_02": "con"},
                        "third_person_label": "cô ấy", "evidence": "..."},
        "SPEAKER_01": {"gender": "male", "role": "chồng", "self_pronoun": "anh",
                        "addresses": {"SPEAKER_00": "em", "SPEAKER_02": "con"},
                        "third_person_label": "anh ấy", "evidence": "..."},
        "SPEAKER_02": {"gender": "male", "role": "con trai", "self_pronoun": "con",
                        "addresses": {"SPEAKER_00": "mẹ", "SPEAKER_01": "ba"},
                        "third_person_label": "con", "evidence": "..."},
    },
}


def main():
    print("=" * 72)
    print(" PASS-1: SPEAKER ANALYSIS PROMPT")
    print("=" * 72)
    p1 = build_speaker_analysis_prompt(segments=SAMPLE_SEGMENTS, source_lang="zh")
    print("\n[SYSTEM]")
    print(p1["system"])
    print("\n[USER]")
    print(p1["user"])

    print("\n\n")
    print("=" * 72)
    print(" PASS-2: TRANSLATION PROMPT (với speaker_relationships từ Pass-1)")
    print("=" * 72)
    p2 = build_translation_prompt(
        segments=SAMPLE_SEGMENTS,
        target_lang="vi",
        source_lang="zh",
        speaker_relationships=SAMPLE_RELATIONSHIPS,
    )
    print("\n[SYSTEM]")
    print(p2["system"])
    print("\n[USER]")
    print(p2["user"])


if __name__ == "__main__":
    main()
