"""Phase 5 — Overlap speech detection.

Detect khi 2+ người nói chồng nhau. Pyannote
`pyannote/overlapped-speech-detection` is the SOTA approach.

Falls back tới heuristic dựa trên diarization turns intersection nếu
pyannote model không available.
"""
from __future__ import annotations

import logging
import os
import threading

from .types import DiarizationTurn, OverlapRegion

logger = logging.getLogger(__name__)


_pipeline_lock = threading.Lock()
_pipeline: object | None = None


def _load_pipeline() -> object | None:
    """Pyannote overlap pipeline — SKIP trong pyannote 4.x vì API broken.

    Pyannote/overlapped-speech-detection model thường có API change qua
    versions → để dành Phase 5 dùng heuristic (đủ tốt cho production).
    """
    # Skip pyannote overlap — heuristic đủ tốt + tránh hang
    logger.info("Skip pyannote overlap (4.x API broken) — use heuristic")
    return None


def detect_overlaps_pyannote(audio_path: str) -> list[OverlapRegion]:
    """Run pyannote overlap detection. Returns regions or [] on failure."""
    pipeline = _load_pipeline()
    if pipeline is None:
        return []
    try:
        result = pipeline(audio_path)
        regions: list[OverlapRegion] = []
        for segment in result.get_timeline().support():
            regions.append(OverlapRegion(start=float(segment.start), end=float(segment.end)))
        logger.info("Pyannote overlap detection: %d regions", len(regions))
        return regions
    except Exception as e:
        logger.warning("Pyannote overlap detection failed: %s", e)
        return []


def detect_overlaps_heuristic(
    turns: list[DiarizationTurn],
) -> list[OverlapRegion]:
    """Fallback: detect overlap khi 2+ turns của speakers KHÁC NHAU
    cùng có timestamp giao nhau.

    Pyannote diarize-3.1 đôi khi đã model overlap (1 region được gán cho
    2 speakers song song qua nhiều turns) → intersect detect được.
    """
    regions: list[OverlapRegion] = []
    n = len(turns)
    for i in range(n):
        for j in range(i + 1, n):
            ti, tj = turns[i], turns[j]
            if ti.speaker == tj.speaker:
                continue
            ov_start = max(ti.start, tj.start)
            ov_end = min(ti.end, tj.end)
            if ov_end - ov_start > 0.1:  # ≥ 100ms overlap
                regions.append(OverlapRegion(start=ov_start, end=ov_end))
    # Merge overlapping regions
    regions.sort(key=lambda r: r.start)
    merged: list[OverlapRegion] = []
    for r in regions:
        if merged and r.start <= merged[-1].end + 0.05:
            merged[-1] = OverlapRegion(
                start=merged[-1].start,
                end=max(merged[-1].end, r.end),
            )
        else:
            merged.append(r)
    logger.info("Heuristic overlap: %d regions (from %d turns)",
                len(merged), n)
    return merged


def detect_overlaps(
    audio_path: str,
    turns: list[DiarizationTurn],
) -> list[OverlapRegion]:
    """Primary: pyannote, fallback: heuristic."""
    regions = detect_overlaps_pyannote(audio_path)
    if regions:
        return regions
    return detect_overlaps_heuristic(turns)


def is_word_overlapping(
    word_start: float,
    word_end: float,
    overlaps: list[OverlapRegion],
    min_ratio: float = 0.5,
) -> bool:
    """Check if a word's timespan overlaps an overlap region by ≥ min_ratio.

    Used in Phase 8 to mark words during overlap regions — those KHÔNG được
    force assign tới 1 speaker (caller xử lý: mark overlap=True, leave
    speaker_id=None hoặc primary speaker).
    """
    word_dur = max(1e-6, word_end - word_start)
    for ov in overlaps:
        ov_start = max(word_start, ov.start)
        ov_end = min(word_end, ov.end)
        if (ov_end - ov_start) / word_dur >= min_ratio:
            return True
    return False
