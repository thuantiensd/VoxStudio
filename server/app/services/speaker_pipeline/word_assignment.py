"""Phase 8 — Word-level speaker assignment.

Mỗi word từ Whisper → speaker từ diarization timeline:

  speaker = speaker với max time overlap với word's timespan.

Nếu word không match turn nào → fallback nearest speaker by time gap.
Nếu word nằm trong overlap region → mark overlap=True, vẫn assign primary
speaker (max overlap) — caller có thể override.
"""
from __future__ import annotations

import logging
from typing import Optional

from .types import (
    AssignedWord,
    DiarizationTurn,
    OverlapRegion,
    TranscribedSegment,
    TranscribedWord,
)
from .overlap import is_word_overlapping

logger = logging.getLogger(__name__)


def _word_overlap_with_turn(
    word: TranscribedWord, turn: DiarizationTurn,
) -> float:
    """Overlap duration (seconds) giữa word và turn. ≥ 0."""
    s = max(word.start, turn.start)
    e = min(word.end, turn.end)
    return max(0.0, e - s)


def _nearest_turn_speaker(
    word: TranscribedWord,
    turns: list[DiarizationTurn],
    max_gap: float = 1.5,
) -> tuple[Optional[str], float]:
    """Find nearest turn (by time gap) when word doesn't overlap any turn.

    Returns (speaker_id, gap_seconds). If gap > max_gap → (None, gap).
    """
    word_mid = (word.start + word.end) / 2
    best_speaker: Optional[str] = None
    best_gap = float("inf")
    for turn in turns:
        if turn.start <= word_mid <= turn.end:
            return turn.speaker, 0.0
        gap = min(abs(word_mid - turn.start), abs(word_mid - turn.end))
        if gap < best_gap:
            best_gap = gap
            best_speaker = turn.speaker
    if best_gap > max_gap:
        return None, best_gap
    return best_speaker, best_gap


def assign_speakers_to_words(
    segments: list[TranscribedSegment],
    turns: list[DiarizationTurn],
    overlaps: list[OverlapRegion],
) -> list[AssignedWord]:
    """Build AssignedWord list từ Whisper words + diarization timeline.

    Algorithm per word:
      1. Tính overlap duration với mỗi turn → pick speaker max overlap
      2. Nếu không có overlap nào > 0 → nearest speaker by gap (max 1.5s)
      3. Confidence = (max_overlap_dur) / (word_dur). 1.0 = full match.
      4. Mark overlap=True nếu word nằm trong overlap region ≥ 50%.
    """
    out: list[AssignedWord] = []
    n_assigned = 0
    n_nearest = 0
    n_unmatched = 0
    n_overlap = 0

    for seg in segments:
        for w in seg.words or []:
            if not w.word.strip():
                continue
            word_dur = max(1e-6, w.end - w.start)
            best_turn: Optional[DiarizationTurn] = None
            best_overlap = 0.0
            for turn in turns:
                ov = _word_overlap_with_turn(w, turn)
                if ov > best_overlap:
                    best_overlap = ov
                    best_turn = turn

            in_overlap = is_word_overlapping(w.start, w.end, overlaps)
            if in_overlap:
                n_overlap += 1

            if best_turn is not None and best_overlap > 0:
                speaker_id = best_turn.speaker
                conf = min(1.0, best_overlap / word_dur)
                n_assigned += 1
            else:
                speaker_id, gap = _nearest_turn_speaker(w, turns)
                if speaker_id is None:
                    n_unmatched += 1
                    conf = 0.0
                else:
                    n_nearest += 1
                    # Confidence decays với gap
                    conf = max(0.1, 1.0 - gap / 2.0)

            out.append(AssignedWord(
                word=w.word.strip(),
                start=w.start,
                end=w.end,
                speaker_id=speaker_id,
                speaker_confidence=round(float(conf), 3),
                overlap=bool(in_overlap),
            ))
    logger.info(
        "Word assignment: %d total | %d direct, %d nearest, %d unmatched, %d in overlap",
        len(out), n_assigned, n_nearest, n_unmatched, n_overlap,
    )
    return out
