"""Shared types/dataclasses cho speaker pipeline.

Mọi module dùng các type này → consistent JSON shape, dễ serialize cho FE.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Literal, Optional


# ── Phase 2: VAD output ────────────────────────────────────────
@dataclass
class SpeechRegion:
    start: float
    end: float


# ── Phase 3: Diarization turn ──────────────────────────────────
@dataclass
class DiarizationTurn:
    start: float
    end: float
    speaker: str  # SPEAKER_TEMP_00 → SPEAKER_00 sau reID


# ── Phase 4: Speaker embedding ─────────────────────────────────
@dataclass
class SpeakerEmbedding:
    speaker_id: str           # temp ID từ pyannote
    start: float
    end: float
    vector: "np.ndarray"      # 256/192-d embedding (numpy)
    quality: float = 1.0      # SNR-based quality score, [0, 1]


# ── Phase 5: Overlap region ────────────────────────────────────
@dataclass
class OverlapRegion:
    start: float
    end: float


# ── Phase 6-7: Whisper output ──────────────────────────────────
@dataclass
class TranscribedWord:
    word: str
    start: float
    end: float
    score: float = 1.0


@dataclass
class TranscribedSegment:
    start: float
    end: float
    text: str
    words: list[TranscribedWord] = field(default_factory=list)
    no_speech_prob: float = 0.0
    avg_logprob: float = 0.0


# ── Phase 8: Word-level speaker assignment ─────────────────────
@dataclass
class AssignedWord:
    word: str
    start: float
    end: float
    speaker_id: Optional[str]      # None nếu không match (overlap/silence)
    speaker_confidence: float       # overlap ratio 0-1
    overlap: bool = False          # True nếu word nằm trong overlap region


# ── Phase 9: Sentence ──────────────────────────────────────────
@dataclass
class SpeakerSentence:
    sentence_id: int
    start: float
    end: float
    text: str
    speaker_id: Optional[str]      # majority-duration speaker
    voice_id: Optional[str] = None  # set bởi voice_mapping
    confidence: float = 0.0        # final confidence 0-1
    need_review: bool = False
    overlap: bool = False
    words: list[AssignedWord] = field(default_factory=list)
    # Internal stats — useful cho debug
    speaker_distribution: dict[str, float] = field(default_factory=dict)
    # vd {"SPEAKER_00": 0.7, "SPEAKER_01": 0.3}

    def to_json(self) -> dict:
        d = asdict(self)
        # Convert words to serializable form
        d["words"] = [asdict(w) for w in self.words]
        return d


# ── Phase 11: Pipeline result ──────────────────────────────────
@dataclass
class SpeakerPipelineResult:
    """Output JSON cho FE editor.

    Schema:
      sentences: list[SpeakerSentence]
      speakers: list[str] — danh sách stable speaker IDs (SPEAKER_00, ...)
      overlaps: list[OverlapRegion]
      stats: counters
    """
    sentences: list[SpeakerSentence]
    speakers: list[str]
    overlaps: list[OverlapRegion]
    language: str = "auto"
    stats: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "sentences": [s.to_json() for s in self.sentences],
            "speakers": list(self.speakers),
            "overlaps": [asdict(o) for o in self.overlaps],
            "language": self.language,
            "stats": dict(self.stats),
        }


# ── Confidence ─────────────────────────────────────────────────
ReviewLevel = Literal["ok", "warn", "review"]


@dataclass
class ConfidenceBreakdown:
    diarization: float        # how confident pyannote is per turn (proxied by duration)
    embedding: float          # cosine sim margin in reID clustering
    alignment: float          # word alignment confidence (mean of word scores)
    overlap_penalty: float    # 1.0 - fraction_overlap (less overlap = better)
    final: float
    level: ReviewLevel
