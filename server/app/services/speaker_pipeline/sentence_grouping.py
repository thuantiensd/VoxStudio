"""Phase 9 — Sentence grouping.

Group AssignedWords thành sentences:
  Boundary triggers:
    1. Sentence-end punctuation (. ! ? 。！？…)
    2. Pause > pause_threshold (default 0.6s)
    3. Speaker change (speaker switch trong dialog)
    4. Combined duration > max_duration (force split nếu quá dài)

Per sentence speaker = MAJORITY DURATION speaker (tổng word duration của
mỗi speaker trong sentence → pick speaker có tổng cao nhất).

Logic này (per spec) tốt hơn first-word hoặc last-word vì:
  - Robust với 1 word lệch (vd word đầu là "Anh" của speaker A nhưng cả
    câu sau là speaker B → vẫn assign B đúng)
  - Phản ánh thực tế ai đang nói chính
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Optional

from .types import AssignedWord, SpeakerSentence

logger = logging.getLogger(__name__)


_SENT_END = re.compile(r"[.!?。！？…؟।]")
_MID_PUNCT = re.compile(r"[,，;；:：]")


def _ends_sentence(word: str) -> bool:
    """Word kết thúc câu (có sentence terminator)."""
    if not word:
        return False
    s = word.rstrip("\"')]}'”")
    if not s:
        return False
    return bool(_SENT_END.search(s[-1]))


def _majority_speaker(
    words: list[AssignedWord],
) -> tuple[Optional[str], dict[str, float]]:
    """Speaker với tổng word duration cao nhất.

    Returns (speaker_id, distribution).
      distribution: {speaker_id: fraction_of_total_duration}
    """
    durations: dict[str, float] = defaultdict(float)
    total = 0.0
    for w in words:
        if w.speaker_id is None:
            continue
        d = max(0.0, w.end - w.start)
        durations[w.speaker_id] += d
        total += d
    if not durations or total <= 0:
        return None, {}
    sorted_spk = sorted(durations.items(), key=lambda kv: -kv[1])
    top_spk, top_dur = sorted_spk[0]
    distribution = {spk: round(d / total, 3) for spk, d in durations.items()}
    return top_spk, distribution


def group_words_into_sentences(
    words: list[AssignedWord],
    pause_threshold: float = 0.6,
    max_duration: float = 12.0,
    min_chars: int = 8,
) -> list[SpeakerSentence]:
    """Group AssignedWords thành SpeakerSentence list.

    Args:
      words: Phase 8 output
      pause_threshold: gap > X giây giữa 2 word → sentence boundary
      max_duration: sentence dài hơn → force split
      min_chars: tránh sentence quá ngắn (gộp với next nếu < min_chars)
    """
    if not words:
        return []

    sentences: list[SpeakerSentence] = []
    current: list[AssignedWord] = []

    def _flush():
        nonlocal current
        if not current:
            return
        speaker_id, distribution = _majority_speaker(current)
        text = " ".join(w.word for w in current).strip()
        # Cleanup: collapse multi-spaces, fix punctuation spacing
        text = re.sub(r"\s+([.,!?;:。！？，；])", r"\1", text)
        text = re.sub(r"\s+", " ", text).strip()
        any_overlap = any(w.overlap for w in current)
        sentences.append(SpeakerSentence(
            sentence_id=len(sentences) + 1,
            start=current[0].start,
            end=current[-1].end,
            text=text,
            speaker_id=speaker_id,
            words=list(current),
            overlap=any_overlap,
            speaker_distribution=distribution,
        ))
        current = []

    for i, w in enumerate(words):
        prev = words[i - 1] if i > 0 else None
        gap = (w.start - prev.end) if prev else 0.0
        speaker_changed = (
            prev is not None
            and prev.speaker_id is not None
            and w.speaker_id is not None
            and prev.speaker_id != w.speaker_id
        )

        # Check trigger boundary (BEFORE adding current word)
        if current and prev is not None:
            text_so_far = " ".join(x.word for x in current)
            current_dur = current[-1].end - current[0].start
            should_break = False
            if gap >= pause_threshold:
                should_break = True
            elif current_dur >= max_duration:
                should_break = True
            elif speaker_changed and len(text_so_far) >= min_chars:
                should_break = True
            elif _ends_sentence(prev.word) and len(text_so_far) >= min_chars:
                should_break = True
            if should_break:
                _flush()

        current.append(w)

    _flush()

    # Post-process: merge consecutive sentences that share same speaker
    # AND có short combined duration AND không có pause lớn — fix quá fragment
    merged: list[SpeakerSentence] = []
    for s in sentences:
        if (
            merged
            and merged[-1].speaker_id == s.speaker_id
            and merged[-1].speaker_id is not None
            and (s.start - merged[-1].end) < 0.4
            and (s.end - merged[-1].start) <= max_duration
            and not _ends_sentence(merged[-1].words[-1].word) if merged[-1].words else False
        ):
            # Merge into prev
            prev = merged[-1]
            prev.end = s.end
            prev.text = (prev.text + " " + s.text).strip()
            prev.text = re.sub(r"\s+([.,!?;:。！？，；])", r"\1", prev.text)
            prev.words.extend(s.words)
            prev.overlap = prev.overlap or s.overlap
            spk, dist = _majority_speaker(prev.words)
            prev.speaker_id = spk
            prev.speaker_distribution = dist
        else:
            merged.append(s)

    # Renumber sentence_id
    for i, s in enumerate(merged):
        s.sentence_id = i + 1

    logger.info(
        "Sentence grouping: %d words → %d sentences (after merge from %d)",
        len(words), len(merged), len(sentences),
    )
    return merged
