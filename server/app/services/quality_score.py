"""Per-project quality score (0-100) cho dubbing pipeline.

Tổng hợp metric từ mọi phase → 1 điểm 0-100 + breakdown để FE/UI hiển thị.
Production goal: user nhìn 1 con số biết output có usable không, chứ không
phải nghe từ đầu cuối mới biết.

4 tiêu chí (weighted):
  - Transcribe quality (25%): Whisper avg_logprob, no_speech_prob
  - Translate quality (30%): validation pass rate, missing/empty count
  - Speaker quality (20%): diarize confidence, gender confidence avg
  - TTS quality (25%): overflow rate, speed cap violations

Threshold:
  ≥85: excellent (xanh)
  70-84: good (vàng)
  50-69: fair (cam) — flag review
  <50: poor (đỏ) — likely cần re-run
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def compute_quality_score(project: dict) -> dict:
    """Compute 0-100 quality score + breakdown.

    Args:
      project: project meta dict (segments, speaker_analysis, stats, ...)

    Returns: {
        "overall": 0-100,
        "level": "excellent"|"good"|"fair"|"poor",
        "breakdown": {
            "transcribe": 0-100,
            "translate": 0-100,
            "speaker": 0-100,
            "tts": 0-100,
        },
        "issues": ["..."],
    }
    """
    segments = project.get("segments") or []
    sp = project.get("speaker_analysis") or {}
    voice_count = int(project.get("voice_count") or 1)

    issues: list[str] = []

    # ── 1. Transcribe quality ──
    # Whisper segments có avg_logprob (negative, closer to 0 = better)
    # và no_speech_prob (lower = better)
    transcribe_score = _score_transcribe(segments, issues)

    # ── 2. Translate quality ──
    translate_score = _score_translate(segments, issues)

    # ── 3. Speaker quality (chỉ áp dụng multi-voice mode) ──
    if voice_count > 1:
        speaker_score = _score_speaker(sp, segments, issues)
    else:
        speaker_score = 100.0  # N/A → not penalize

    # ── 4. TTS quality ──
    tts_score = _score_tts(segments, issues)

    # Weighted overall
    overall = (
        transcribe_score * 0.25
        + translate_score * 0.30
        + speaker_score * 0.20
        + tts_score * 0.25
    )

    level = _level_for_score(overall)

    return {
        "overall": round(overall, 1),
        "level": level,
        "breakdown": {
            "transcribe": round(transcribe_score, 1),
            "translate": round(translate_score, 1),
            "speaker": round(speaker_score, 1),
            "tts": round(tts_score, 1),
        },
        "issues": issues[:10],  # Limit hiển thị
    }


def _score_transcribe(segments: list[dict], issues: list[str]) -> float:
    """Score Whisper output quality. 100 = clean, 0 = mostly noise."""
    if not segments:
        issues.append("Không có segments — Whisper fail")
        return 0.0

    # Bỏ segments không có metric (segments cũ)
    with_metric = [s for s in segments if "avg_logprob" in s or "no_speech_prob" in s]
    if not with_metric:
        return 75.0  # Không có metric → assume neutral

    # avg_logprob: thường -0.5 to -1.5 cho speech tốt; < -1.5 = unclear
    logprobs = [s.get("avg_logprob", -1.0) for s in with_metric]
    avg_logprob = sum(logprobs) / len(logprobs)
    # Map -0.3 → 100, -2.0 → 0
    logprob_score = max(0, min(100, 100 - (abs(avg_logprob) - 0.3) * 60))

    # no_speech_prob: 0-1, < 0.1 = clean speech
    nsp = [s.get("no_speech_prob", 0) for s in with_metric]
    avg_nsp = sum(nsp) / len(nsp)
    nsp_score = max(0, 100 - avg_nsp * 200)

    score = (logprob_score + nsp_score) / 2
    if score < 60:
        issues.append(f"Transcribe quality thấp (logprob={avg_logprob:.2f}, nsp={avg_nsp:.2f})")
    return score


def _score_translate(segments: list[dict], issues: list[str]) -> float:
    """Score translation completeness + quality."""
    if not segments:
        return 0.0
    total = len(segments)
    has_text = sum(1 for s in segments if (s.get("translated_text") or "").strip())
    completeness = (has_text / total) * 100

    if completeness < 100:
        missing = total - has_text
        issues.append(f"Translation thiếu {missing}/{total} segments")

    # Check budget violations: translated_text > expected (heuristic)
    # nếu trans nhiều hơn 1.5x slot duration → flag overflow potential
    overflow_count = 0
    for s in segments:
        dur = max(0.3, s.get("end", 0) - s.get("start", 0))
        max_chars = int(dur * 11.5 * 1.25)  # 25% slack
        trans = (s.get("translated_text") or "").strip()
        if len(trans) > max_chars:
            overflow_count += 1
    if overflow_count > 0:
        overflow_pct = (overflow_count / total) * 100
        completeness -= overflow_pct * 0.3  # Penalty 30% per % overflow
        if overflow_pct > 20:
            issues.append(f"Translation vượt budget {overflow_pct:.0f}% segments")

    return max(0, min(100, completeness))


def _score_speaker(sp: dict, segments: list[dict], issues: list[str]) -> float:
    """Score speaker diarization quality."""
    if not sp:
        issues.append("Speaker pipeline không chạy")
        return 0.0

    stats = sp.get("stats") or {}
    diarize_conf = stats.get("diarize_confidence", 0.5)
    gender_confs = stats.get("gender_confidences") or {}

    # Diarize confidence 0-1 → 0-100
    diarize_score = diarize_conf * 100

    # Gender confidence avg
    if gender_confs:
        avg_gender = sum(gender_confs.values()) / len(gender_confs)
        gender_score = avg_gender * 100
    else:
        gender_score = 50.0  # No data → neutral

    # Speakers count match expected (voice_count)
    speakers = sp.get("speakers") or []
    n_speakers = len(speakers)
    if n_speakers == 0:
        issues.append("Pipeline không detect speaker nào")
        return 20.0

    # Segments mapped → speaker (vs None)
    mapped = sum(1 for s in segments if s.get("speaker"))
    mapping_rate = (mapped / max(1, len(segments))) * 100

    score = (diarize_score * 0.4 + gender_score * 0.3 + mapping_rate * 0.3)

    if diarize_conf < 0.5:
        issues.append(f"Diarize confidence thấp ({diarize_conf:.2f})")
    if mapping_rate < 70:
        issues.append(f"Chỉ {mapping_rate:.0f}% segments có speaker")
    return max(0, min(100, score))


def _score_tts(segments: list[dict], issues: list[str]) -> float:
    """Score TTS overflow + speed cap violations.

    Note: chỉ chạy khi có TTS metadata trong segments. Nếu chưa render
    TTS → return neutral 75.
    """
    if not segments:
        return 0.0

    # Heuristic: pre-render quality estimated từ ratio text length / duration
    overflow_estimated = 0
    total = len(segments)
    for s in segments:
        dur = max(0.3, s.get("end", 0) - s.get("start", 0))
        trans = (s.get("translated_text") or "").strip()
        if not trans:
            continue
        # 14 chars/s = upper bound natural speed
        # nếu text/dur > 14 × 1.25 → guaranteed overflow
        if len(trans) / dur > 14 * 1.25:
            overflow_estimated += 1

    overflow_rate = overflow_estimated / total if total else 0
    score = 100 - overflow_rate * 200  # 50% overflow → 0 điểm
    if overflow_rate > 0.2:
        issues.append(f"~{overflow_rate*100:.0f}% segments có thể TTS overflow")
    return max(0, min(100, score))


def _level_for_score(score: float) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 50:
        return "fair"
    return "poor"
