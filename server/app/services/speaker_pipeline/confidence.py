"""Phase 10 — Confidence engine.

Compute 4-factor confidence per sentence:

  1. diarization_confidence:
       Proxy = duration của primary speaker turn (longer = more reliable).
       Map duration [0.5, 4.0]s → [0.4, 1.0].

  2. embedding_confidence:
       Đại lượng phản ánh "speaker này KHÁC speakers khác bao nhiêu".
       Sentence càng có speaker_distribution dominant 1 speaker → cao.

  3. alignment_confidence:
       Mean của word-level speaker_confidence (Phase 8).

  4. overlap_penalty:
       1.0 - fraction_of_words_in_overlap. Càng ít overlap → cao.

  final = weighted geometric mean. Nếu < threshold → need_review = True.
"""
from __future__ import annotations

import math

from .types import ConfidenceBreakdown, SpeakerSentence


def _diarization_score(sentence_duration: float) -> float:
    """Map duration → confidence proxy."""
    if sentence_duration <= 0:
        return 0.0
    if sentence_duration >= 4.0:
        return 1.0
    if sentence_duration <= 0.5:
        return 0.4
    return 0.4 + (sentence_duration - 0.5) * (0.6 / 3.5)


def _embedding_score(distribution: dict[str, float]) -> float:
    """Distribution dominant 1 speaker → high score.

    1 speaker = 1.0
    2 speakers 50/50 = 0.5
    Computed as max(distribution.values()).
    """
    if not distribution:
        return 0.5  # neutral
    return float(max(distribution.values()))


def _alignment_score(sentence: SpeakerSentence) -> float:
    """Mean word-level speaker_confidence."""
    if not sentence.words:
        return 0.5
    confs = [w.speaker_confidence for w in sentence.words if w.speaker_id is not None]
    if not confs:
        return 0.0
    return sum(confs) / len(confs)


def _overlap_penalty(sentence: SpeakerSentence) -> float:
    """1.0 - fraction_of_words_in_overlap_region."""
    if not sentence.words:
        return 1.0
    n_overlap = sum(1 for w in sentence.words if w.overlap)
    return 1.0 - (n_overlap / len(sentence.words))


def compute_confidence(
    sentence: SpeakerSentence,
    threshold_review: float = 0.55,
    threshold_warn: float = 0.75,
) -> ConfidenceBreakdown:
    """4-factor weighted geometric mean.

    Weights:
      diarization 0.25, embedding 0.30, alignment 0.30, overlap 0.15
    """
    duration = max(0.0, sentence.end - sentence.start)
    d = _diarization_score(duration)
    e = _embedding_score(sentence.speaker_distribution)
    a = _alignment_score(sentence)
    o = _overlap_penalty(sentence)

    # Weighted geometric mean — 1 factor near 0 sẽ làm final thấp (correct)
    weights = {"d": 0.25, "e": 0.30, "a": 0.30, "o": 0.15}
    eps = 1e-3
    log_sum = (
        weights["d"] * math.log(max(d, eps))
        + weights["e"] * math.log(max(e, eps))
        + weights["a"] * math.log(max(a, eps))
        + weights["o"] * math.log(max(o, eps))
    )
    final = math.exp(log_sum)

    if final < threshold_review:
        level = "review"
    elif final < threshold_warn:
        level = "warn"
    else:
        level = "ok"

    return ConfidenceBreakdown(
        diarization=round(d, 3),
        embedding=round(e, 3),
        alignment=round(a, 3),
        overlap_penalty=round(o, 3),
        final=round(final, 3),
        level=level,
    )


def apply_confidence(
    sentences: list[SpeakerSentence],
    threshold_review: float = 0.55,
) -> list[SpeakerSentence]:
    """Mutate sentences in-place: set .confidence + .need_review."""
    for s in sentences:
        cb = compute_confidence(s, threshold_review=threshold_review)
        s.confidence = cb.final
        s.need_review = cb.level == "review"
    return sentences
