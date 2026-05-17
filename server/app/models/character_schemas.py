"""Character Registry + QA Report schemas (Phase 2 refactor audit).

Hệ schema cho pipeline dubbing AUDIO-FIRST + CHARACTER-BASED. Tách khỏi
`dubbing_schemas.py` (chứa SubtitleStyle, DubbingSegment, ExportOptions...
là API/HTTP schemas) — file này chuyên cho character registry + qa report
nội bộ pipeline (output `character_registry.json`, `qa_report.json`).

Phase 2: CHỈ tạo schema, KHÔNG plug vào pipeline. Phase 5-11 sẽ wire.

Public models:
  CharacterProfile        — 1 nhân vật canonical sau merge raw speakers
  SegmentOwnershipInfo    — quyết định gán segment → character
  CharacterRegistry       — toàn bộ characters của project
  PossibleMerge           — raw speakers nghi cùng nhân vật (chưa merge)
  GenderConflict          — audio/face/LLM xung đột gender
  OwnershipWarning        — segment confidence thấp
  TranslationWarning      — bản dịch mâu thuẫn character profile
  TimingWarning           — TTS overflow/underrun slot
  SystemError             — STT/TTS/LLM API failure
  QASummary               — tổng kết counts
  QAReport                — full qa_report.json schema
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


# ── Type aliases ──────────────────────────────────────────────────
Gender = Literal["male", "female", "unknown"]
ConfidenceTier = Literal["high", "medium", "low"]
SegmentId = Union[str, int]  # int = whisper index, str = uuid


def _utcnow() -> datetime:
    """Timezone-aware UTC timestamp cho serialize JSON consistent."""
    return datetime.now(timezone.utc)


# ── Character & Ownership ─────────────────────────────────────────

class CharacterProfile(BaseModel):
    """1 nhân vật canonical sau khi cluster raw_speakers.

    character_id ổn định (vd "CHAR_001") — dùng cho translation/TTS routing.
    source_speakers liệt kê raw speakers (SPEAKER_00, FACE_01, ...) đã merge.
    Gender + voice quyết định ở cấp CHARACTER (không per segment).

    Field `locked`: nếu True, LLM/face KHÔNG được override gender (vd user
    đã manual confirm hoặc evidence quá mạnh).
    Field `review_required`: mark cho UI hỏi user; trong Auto mode chỉ log
    vào qa_report (không pause pipeline).
    """
    model_config = ConfigDict(extra="forbid")

    character_id: str = Field(..., description='Canonical ID, vd "CHAR_001"')
    source_speakers: list[str] = Field(
        default_factory=list,
        description="Raw speaker IDs gộp lại (SPEAKER_XX, FACE_XX)",
    )
    gender: Gender = "unknown"
    gender_confidence: float = Field(0.0, ge=0.0, le=1.0)
    voice_profile_id: Optional[str] = Field(
        None,
        description="Voice slot key đã gán (vd 'nam_long_vu'). None = chưa assign",
    )
    line_count: int = Field(0, ge=0)
    total_duration: float = Field(0.0, ge=0.0, description="Tổng giây speak")
    locked: bool = False
    review_required: bool = False
    merge_confidence: float = Field(
        1.0, ge=0.0, le=1.0,
        description="1.0 nếu single source_speaker; thấp hơn nếu merge từ "
                    "vùng similarity ambiguous (0.65-0.75)",
    )


class SegmentOwnershipInfo(BaseModel):
    """Quyết định gán 1 segment → 1 character + lý do.

    Decision tree theo spec Phase 6:
      1. Segment < 0.5s hoặc embedding low → giữ + low_confidence
      2. best - assigned > GAP và best >= KEEP → reassign
      3. ownership >= KEEP → giữ (high)
      4. ownership < LOW → giữ + low_confidence (log)
      5. còn lại → giữ (medium)
    """
    model_config = ConfigDict(extra="forbid")

    segment_id: SegmentId
    assigned_character_id: Optional[str] = None
    ownership_confidence: float = Field(0.0, ge=0.0, le=1.0)
    best_candidate_character_id: Optional[str] = None
    best_candidate_similarity: Optional[float] = Field(None, ge=0.0, le=1.0)
    decision_reason: str = Field(
        "",
        description='vd "kept_high_conf", "reassigned_strong", '
                    '"short_segment_keep", "low_conf_keep", "medium_conf_keep"',
    )
    confidence_tier: ConfidenceTier = "low"


class PossibleMerge(BaseModel):
    """Vùng similarity 0.65-0.75 chưa merge (cần ≥2 evidences) — log để user review."""
    model_config = ConfigDict(extra="forbid")

    characters: list[str] = Field(..., min_length=2, max_length=2)
    similarity: float = Field(..., ge=0.0, le=1.0)
    evidences_present: list[str] = Field(
        default_factory=list,
        description='vd ["same_face_track", "same_gender_high_conf", "no_timeline_overlap"]',
    )
    evidences_count: int = Field(0, ge=0)
    reason_not_merged: str = ""


class CharacterRegistry(BaseModel):
    """character_registry.json — output của Phase 5 character_registry_service."""
    model_config = ConfigDict(extra="forbid")

    project_id: str
    characters: dict[str, CharacterProfile] = Field(default_factory=dict)
    possible_merges: list[PossibleMerge] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)


# ── QA Warnings ───────────────────────────────────────────────────

class GenderConflict(BaseModel):
    """Audio gender / face gender / LLM gender không đồng ý — log decision."""
    model_config = ConfigDict(extra="forbid")

    character_id: str
    audio_gender: Optional[Gender] = None
    audio_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    face_gender: Optional[Gender] = None
    face_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    llm_gender: Optional[Gender] = None
    llm_evidence: Optional[str] = None
    decision: Gender = Field(..., description="Final gender chốt")
    decision_reason: str


class OwnershipWarning(BaseModel):
    """Segment có ownership_confidence < OWNERSHIP_LOW hoặc reassign nghi vấn."""
    model_config = ConfigDict(extra="forbid")

    segment_id: SegmentId
    start_time: float = Field(..., ge=0.0)
    end_time: float = Field(..., ge=0.0)
    assigned_character: Optional[str] = None
    best_candidate: Optional[str] = None
    ownership_confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str = Field(
        ...,
        description='vd "below_OWNERSHIP_LOW", "short_segment_kept", '
                    '"reassigned_strong"',
    )


class TranslationWarning(BaseModel):
    """Bản dịch mâu thuẫn profile hoặc neutral-safe forced."""
    model_config = ConfigDict(extra="forbid")

    segment_id: SegmentId
    batch_id: Optional[int] = None
    character_id: Optional[str] = None
    issue: str = Field(
        ...,
        description='enum: "pronoun_inconsistent_with_profile", '
                    '"batch_pronoun_drift", "ambiguous_pronoun", '
                    '"ownership_low_neutral_forced", "gender_unknown_forced_safe", '
                    '"locked_character_gender_violated", '
                    '"invalid_llm_note_fallback_ok"',
    )
    original_translation: Optional[str] = None
    corrected_translation: Optional[str] = None
    auto_fixed: bool = False


# Phase 9 — LLM translation note enum (strict whitelist for parsing).
# LLM may hallucinate any string; parser must validate vs this enum.
TranslationNote = Literal[
    "ok",
    "neutral_safe_due_to_low_gender_confidence",
    "neutral_safe_due_to_low_ownership_confidence",
    "follows_character_profile",
    "ambiguous_pronoun",
]


VALID_TRANSLATION_NOTES: tuple[str, ...] = (
    "ok",
    "neutral_safe_due_to_low_gender_confidence",
    "neutral_safe_due_to_low_ownership_confidence",
    "follows_character_profile",
    "ambiguous_pronoun",
)


class VoiceMapWarning(BaseModel):
    """Phase 8 — voice_map build cảnh báo: unknown gender + no fallback,
    majority rule applied, tie-breaker alphabetical, ..."""
    model_config = ConfigDict(extra="forbid")

    character_id: str
    issue: str = Field(
        ...,
        description='enum: "unknown_gender_no_fallback", '
                    '"unknown_gender_fallback_applied", '
                    '"majority_rule_applied", "tie_breaker_alphabetical", '
                    '"no_matching_gender_slot", "reused_slot_same_gender", '
                    '"voice_slot_count_insufficient"',
    )
    decided_voice: str = Field("", description="voice_id final được gán")
    reason: str = ""


class VoiceWarning(BaseModel):
    """Phase 12 — TTS-time voice resolver fallback warning."""
    model_config = ConfigDict(extra="forbid")

    segment_id: SegmentId
    character_id: Optional[str] = None
    issue: str = Field(
        ...,
        description='enum: "missing_character_id", "missing_voice_profile_id", '
                    '"voice_profile_null_gender_male_fallback", '
                    '"voice_profile_null_gender_female_fallback", '
                    '"voice_profile_null_default_slot_fallback", '
                    '"missing_character_id_seed_fallback"',
    )
    fallback_used: str = Field("", description="voice_id fallback applied")


class VoiceConflict(BaseModel):
    """Phase 12 — cùng character bị gán nhiều voice (rare bug)."""
    model_config = ConfigDict(extra="forbid")

    character_id: str
    voices_found: list[str] = Field(default_factory=list, min_length=2)
    resolved_to: str
    reason: str = "same_character_multiple_voices"


class GenderWarning(BaseModel):
    """Phase 12 — gender invariant violation (gender_conf < GENDER_MEDIUM
    nhưng gender=male/female). Auto-reset → unknown."""
    model_config = ConfigDict(extra="forbid")

    character_id: str
    issue: str = Field(
        ...,
        description='enum: "gender_label_with_zero_confidence", '
                    '"gender_below_medium_threshold", '
                    '"llm_override_without_confidence"',
    )
    old_gender: str = ""
    old_confidence: float = 0.0
    fixed_gender: str = "unknown"


class TimingWarning(BaseModel):
    """TTS overflow/underrun slot — log decision."""
    model_config = ConfigDict(extra="forbid")

    segment_id: SegmentId
    target_duration: float = Field(..., gt=0.0)
    tts_duration: float = Field(..., gt=0.0)
    ratio: float = Field(..., gt=0.0)
    action: str = Field(
        ...,
        description='enum: "speed_up_1.0_1.15", "regenerate_shorter", '
                    '"accept_silence_pad", "accept_overflow", "fallback_short_version"',
    )


class SystemError(BaseModel):
    """Lỗi STT/TTS/LLM/diarization API (retry exhausted hoặc fatal)."""
    model_config = ConfigDict(extra="forbid")

    service: str = Field(..., description='vd "stt", "tts", "llm_translate", "diarization"')
    error_type: str = Field(..., description='vd "TIMEOUT", "API_RATE_LIMIT", "MODEL_FAIL"')
    segment_id: Optional[SegmentId] = None
    message: str
    timestamp: datetime = Field(default_factory=_utcnow)
    retries_attempted: int = Field(0, ge=0)


# ── QA Report ─────────────────────────────────────────────────────

class QASummary(BaseModel):
    """Tổng kết counts — đưa lên đầu qa_report cho user scan nhanh."""
    model_config = ConfigDict(extra="forbid")

    total_segments: int = Field(0, ge=0)
    total_characters: int = Field(0, ge=0)
    low_confidence_segments: int = Field(0, ge=0)
    low_confidence_ratio: float = Field(0.0, ge=0.0, le=1.0)
    unknown_gender_characters: int = Field(0, ge=0)
    critical_errors: int = Field(0, ge=0)


class QAReport(BaseModel):
    """qa_report.json — emit ở Phase 11 export_service.

    Schema theo spec: summary + uncertain lists + per-category warnings +
    system errors. Auto mode: pipeline KHÔNG dừng vì warning, chỉ log.
    """
    model_config = ConfigDict(extra="forbid")

    project_id: str
    generated_at: datetime = Field(default_factory=_utcnow)
    summary: QASummary = Field(default_factory=QASummary)
    uncertain_characters: list[str] = Field(
        default_factory=list,
        description="character_ids có gender unknown hoặc review_required",
    )
    uncertain_segments: list[SegmentId] = Field(
        default_factory=list,
        description="segment_ids có ownership_confidence tier=low",
    )
    possible_merges: list[PossibleMerge] = Field(default_factory=list)
    gender_conflicts: list[GenderConflict] = Field(default_factory=list)
    ownership_warnings: list[OwnershipWarning] = Field(default_factory=list)
    translation_warnings: list[TranslationWarning] = Field(default_factory=list)
    voice_map_warnings: list[VoiceMapWarning] = Field(default_factory=list)
    voice_warnings: list[VoiceWarning] = Field(default_factory=list)
    voice_conflicts: list[VoiceConflict] = Field(default_factory=list)
    gender_warnings: list[GenderWarning] = Field(default_factory=list)
    timing_warnings: list[TimingWarning] = Field(default_factory=list)
    system_errors: list[SystemError] = Field(default_factory=list)
