"""Segment post-processing functions cho speech output.

Port từ dubbing_svc.py các helper:
  - dedup_repeated_text  : drop seg trùng text (anti-hallucinate)
  - snap_to_words        : tighten boundary từ word timestamps
  - silero_vad_refine    : refine với Silero VAD (chính xác ~20ms)
  - split_long_segments  : cắt seg dài > max_duration
  - trim_sparse_segments : drop seg có speech rate thấp (noise/music)
  - merge_short_segments : gộp seg ngắn liền nhau (sentence-aware)

Mỗi function pure (không side effect), nhận list[dict], trả list[dict].
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


# Sentence-terminator (đa ngôn ngữ)
_SENTENCE_END_CHARS = set(".!?。！？…؟।")
_MID_CLAUSE_CHARS = set(",，、;；:：")
_ZH_END_PARTICLES = set("啊呢吗吧了嘛呀啦哦哈嘿喂")
_ZH_CONTINUE_CHARS = set("的和与而但所以因为如果虽然但是")


def ends_complete_sentence(text: str) -> bool:
    """Đoạn text kết thúc 1 câu hoàn chỉnh?

    True: dấu chấm/than/hỏi/ellipsis HOẶC particle Chinese cuối câu.
    False: comma/colon, connector Chinese, hoặc không có gì (Whisper Chinese).
    """
    if not text:
        return False
    s = text.rstrip()
    if not s:
        return False
    while s and s[-1] in '")]}\'’”':
        s = s[:-1]
    if not s:
        return False
    last = s[-1]
    if last in _SENTENCE_END_CHARS:
        return True
    if last in _ZH_END_PARTICLES:
        return True
    if last in _ZH_CONTINUE_CHARS:
        return False
    if last in _MID_CLAUSE_CHARS:
        return False
    return False


# ── Dedup repeated text ──────────────────────────────────────

def dedup_repeated_text(segs: list[dict]) -> list[dict]:
    """Drop segments có normalized text trùng segment liền trước.

    Whisper Chinese drama hay "stuck repeat": cùng audio chunk → output
    cùng text vì context loop. Sau anti-halluc params, đây là safety net.
    """
    if not segs:
        return segs
    out: list[dict] = []
    last_norm: Optional[str] = None
    dropped = 0
    for s in segs:
        norm = "".join((s.get("text") or "").split()).lower()
        if norm and norm == last_norm:
            dropped += 1
            continue
        out.append(s)
        last_norm = norm or last_norm
    if dropped:
        logger.info("Dedup: dropped %d repeated-text seg(s)", dropped)
    return out


# ── Filter music/singing ─────────────────────────────────────

def filter_music_segments(
    segs: list[dict],
    audio_path: str,
    no_speech_threshold: float = 0.55,
    avg_logprob_threshold: float = -1.0,
) -> list[dict]:
    """Drop seg có no_speech_prob cao hoặc avg_logprob âm sâu (likely music)."""
    if not segs:
        return segs
    out = []
    dropped = 0
    for s in segs:
        nsp = float(s.get("no_speech_prob") or 0.0)
        logp = float(s.get("avg_logprob") or 0.0)
        if nsp > no_speech_threshold or logp < avg_logprob_threshold:
            dropped += 1
            continue
        out.append(s)
    if dropped:
        logger.info("Music filter: dropped %d seg(s) likely music/noise", dropped)
    return out


# ── Snap to words ────────────────────────────────────────────

def snap_to_words(segs: list[dict], keep_padding: float = 0.08) -> list[dict]:
    """Tighten segment boundary với word timestamps (~10ms accuracy).

    Whisper VAD pads 200-400ms. Word timestamps cho boundary chính xác.
    """
    out = []
    saved = 0.0
    for seg in segs:
        words = seg.get("words") or []
        if not words:
            out.append(dict(seg))
            continue
        snapped = dict(seg)
        word_start = float(words[0].get("start") or seg["start"])
        word_end = float(words[-1].get("end") or seg["end"])
        if word_start - seg["start"] > 0.2:
            snapped["start"] = round(max(seg["start"], word_start - keep_padding), 2)
        if seg["end"] - word_end > 0.2:
            snapped["end"] = round(min(seg["end"], word_end + keep_padding), 2)
        saved += (seg["end"] - seg["start"]) - (snapped["end"] - snapped["start"])
        out.append(snapped)
    if saved > 0:
        logger.info("Snap to words: tightened %.1fs of silent edges", saved)
    return out


# ── Split long segments ──────────────────────────────────────

def split_long_segments(segs: list[dict], max_duration: float = 12.0) -> list[dict]:
    """Cắt segment > max_duration tại silence gap (word-level) hoặc punctuation."""
    out = []
    for seg in segs:
        if seg["end"] - seg["start"] <= max_duration:
            out.append(dict(seg))
            continue
        out.extend(_split_one(seg, max_duration))
    return out


def _split_one(seg: dict, max_duration: float) -> list[dict]:
    duration = seg["end"] - seg["start"]
    if duration <= max_duration:
        return [dict(seg)]
    words = seg.get("words") or []
    text = (seg.get("text") or "").strip()

    # Path A: word-level split tại silence gap lớn nhất
    if len(words) >= 4:
        gaps = []
        for i in range(1, len(words)):
            gap = float(words[i].get("start", 0)) - float(words[i - 1].get("end", 0))
            gaps.append((gap, i))
        mid_time = seg["start"] + duration / 2
        gaps.sort(key=lambda g: (-g[0], abs(float(words[g[1]].get("start", 0)) - mid_time)))
        if gaps and gaps[0][0] >= 0.05:
            split_idx = gaps[0][1]
            left = words[:split_idx]
            right = words[split_idx:]
            l_text = "".join(w.get("word", "") for w in left).strip()
            r_text = "".join(w.get("word", "") for w in right).strip()
            if l_text and r_text:
                left_seg = {
                    "start": seg["start"],
                    "end": float(left[-1].get("end", seg["end"])),
                    "text": l_text,
                    "words": left,
                    "speaker": seg.get("speaker"),
                }
                right_seg = {
                    "start": float(right[0].get("start", seg["start"])),
                    "end": seg["end"],
                    "text": r_text,
                    "words": right,
                    "speaker": seg.get("speaker"),
                }
                return _split_one(left_seg, max_duration) + _split_one(right_seg, max_duration)

    # Path B: punctuation fallback
    parts = re.split(r"(?<=[.!?。！？])\s+", text)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) < 2:
        parts = re.split(r"(?<=[,;，；])\s+", text)
        parts = [p.strip() for p in parts if p.strip()]
    if len(parts) < 2:
        # Force split half
        word_list = text.split()
        mid = len(word_list) // 2
        if mid == 0:
            return [dict(seg)]
        parts = [" ".join(word_list[:mid]), " ".join(word_list[mid:])]

    total_chars = sum(len(p) for p in parts) or 1
    subs = []
    cursor = seg["start"]
    for i, p in enumerate(parts):
        frac = len(p) / total_chars
        sub_end = seg["end"] if i == len(parts) - 1 else cursor + duration * frac
        subs.append({
            "start": round(cursor, 2),
            "end": round(sub_end, 2),
            "text": p,
            "speaker": seg.get("speaker"),
        })
        cursor = sub_end

    out = []
    for s in subs:
        if s["end"] - s["start"] > max_duration:
            out.extend(_split_one(s, max_duration))
        else:
            out.append(s)
    return out


# ── Trim sparse ──────────────────────────────────────────────

SPEECH_RATE_BY_LANG = {
    "vietnamese": 14.0, "vi": 14.0,
    "english": 15.0, "en": 15.0,
    "chinese": 6.0, "zh": 6.0,
    "japanese": 8.0, "ja": 8.0,
    "korean": 11.0, "ko": 11.0,
    "thai": 10.0, "th": 10.0,
}


def speech_rate_for(lang: Optional[str]) -> float:
    if not lang:
        return 14.0
    return SPEECH_RATE_BY_LANG.get(lang.lower().strip(), 14.0)


def trim_sparse_segments(
    segs: list[dict],
    max_speech_per_sec: float = 14.0,
) -> list[dict]:
    """Drop seg có text quá ngắn so với duration (likely false detection)."""
    out = []
    dropped = 0
    for s in segs:
        dur = s["end"] - s["start"]
        text = (s.get("text") or "").strip()
        if dur > 0.5 and text:
            rate = len(text) / dur
            if rate < max_speech_per_sec * 0.1:  # < 10% expected → too sparse
                dropped += 1
                continue
        out.append(s)
    if dropped:
        logger.info("Trim sparse: dropped %d seg(s) too short text/duration", dropped)
    return out


# ── Merge short segments ─────────────────────────────────────

def merge_short_segments(
    segs: list[dict],
    min_duration: float = 4.0,
    max_gap: float = 1.8,
    max_combined: float = 14.0,
) -> list[dict]:
    """Gộp seg ngắn liền nhau (sentence-aware).

    Rules:
      1. Sentence completion: prev chưa kết thúc câu → merge nếu gap < max_gap
      2. Short duration: prev/cur < min_duration → merge
      3. Speaker change → KHÔNG merge (giữ riêng cho voice mapping)
    """
    if not segs:
        return segs
    merged = [dict(segs[0])]
    merged[-1].setdefault("internal_pauses", [])

    for seg in segs[1:]:
        prev = merged[-1]
        prev_dur = prev["end"] - prev["start"]
        cur_dur = seg["end"] - seg["start"]
        gap = seg["start"] - prev["end"]
        combined = seg["end"] - prev["start"]

        prev_spk = prev.get("speaker")
        cur_spk = seg.get("speaker")
        same_speaker = prev_spk == cur_spk or prev_spk is None or cur_spk is None

        prev_text = (prev.get("text") or "").strip()
        prev_complete = ends_complete_sentence(prev_text)

        sentence_continues = (
            same_speaker
            and not prev_complete
            and gap < max_gap
            and combined <= max_combined + 2.0
        )
        short_merge = (
            same_speaker
            and (prev_dur < min_duration or cur_dur < min_duration)
            and gap < max_gap
            and combined <= max_combined
        )

        if sentence_continues or short_merge:
            if gap >= 0.3:
                pause_offset = prev["end"] - prev["start"]
                prev["internal_pauses"].append({
                    "offset": round(pause_offset, 3),
                    "duration": round(gap, 3),
                })
            prev["end"] = seg["end"]
            prev["text"] = (prev["text"] + " " + seg["text"]).strip()
            # Merge words list nếu có
            if seg.get("words"):
                prev_words = prev.get("words") or []
                prev["words"] = prev_words + seg["words"]
        else:
            new_seg = dict(seg)
            new_seg.setdefault("internal_pauses", [])
            merged.append(new_seg)

    logger.info("Merge short: %d → %d segments", len(segs), len(merged))
    return merged


# ── Silero VAD refine (optional) ─────────────────────────────

def silero_vad_refine(segs: list[dict], audio_path: str) -> list[dict]:
    """Refine boundary với Silero VAD (chính xác ~20ms vs Whisper ~200ms).

    Optional — skip nếu silero không cài.
    """
    try:
        from silero_vad import load_silero_vad, get_speech_timestamps
        import torch
        import soundfile as sf
        import librosa
    except ImportError:
        return segs

    try:
        audio, sr = sf.read(str(audio_path))
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 16000:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
            sr = 16000
        audio_t = torch.from_numpy(audio).float()
        model = load_silero_vad()
        speech_ts = get_speech_timestamps(
            audio_t, model,
            sampling_rate=16000,
            threshold=0.4,
            min_speech_duration_ms=200,
            min_silence_duration_ms=200,
            return_seconds=True,
        )
        speech_regions = [(t["start"], t["end"]) for t in speech_ts]
    except Exception as e:
        logger.warning("Silero VAD load fail (%s) — skip refine", e)
        return segs

    out = []
    refined = 0
    for seg in segs:
        s_start, s_end = seg["start"], seg["end"]
        # Find Silero region nearest overlapping
        best_overlap = 0.0
        best_region = None
        for r_start, r_end in speech_regions:
            ov = max(0.0, min(s_end, r_end) - max(s_start, r_start))
            if ov > best_overlap:
                best_overlap = ov
                best_region = (r_start, r_end)
        if best_region:
            new_start = max(s_start, best_region[0] - 0.05)
            new_end = min(s_end, best_region[1] + 0.05)
            if new_start < new_end:
                snapped = dict(seg)
                snapped["start"] = round(new_start, 2)
                snapped["end"] = round(new_end, 2)
                out.append(snapped)
                if abs(new_start - s_start) > 0.05 or abs(new_end - s_end) > 0.05:
                    refined += 1
                continue
        out.append(dict(seg))
    if refined:
        logger.info("Silero VAD refine: tightened %d boundaries", refined)
    return out
