"""Gender Detection Service (Phase 7a audit refactor).

Quyết định gender per CHARACTER (không per-segment) bằng cách fuse 3 signal:

  1. Audio gender (F0 + formant + spectral từ speaker_pipeline.gender)
     — primary, vì F0/formant đo trực tiếp đặc tính giọng nói.
  2. Face gender (insightface CNN từ face_speaker_svc)
     — supporting, chỉ tính khi face_track stable map với character.
  3. Self-reference text (Vietnamese pattern match từ original transcript)
     — boost only, chỉ count strong self-ref patterns.

Tại sao per-CHARACTER (CRIT-3):
  Trước Phase 7: seg["speaker_gender"] gán per segment → cùng 1 character
  nhưng segment khác nhau có thể có gender khác nhau (do face detection
  noisy frame-by-frame, hoặc audio cluster gộp ambiguous).
  Sau Phase 7: gender fix ở CharacterProfile → tất cả segments của char đó
  đều inherit gender chính thức (TTS chọn voice đúng).

Fusion formula (theo spec Phase 7):

  • Chỉ audio (no face): gender = audio_gender, conf = audio_conf.
  • Audio + face AGREE: gender = audio_gender,
                        conf = min(max(audio, face) + 0.05, 0.95).
  • Audio + face DISAGREE:
      - audio_conf ≥ GENDER_AUDIO_STRONG (0.70):
          → gender = audio, conf = max(audio - 0.10, 0.0), log conflict.
      - audio_conf < 0.70:
          → gender = "unknown", conf = 0.0, log conflict (cả 2 đều yếu).
  • Self-reference text khớp gender đã chọn:
      → conf = min(conf + 0.10, 0.95) (KHÔNG override gender đã chắc).
  • Self-reference text MÂU THUẪN gender đã chọn (rare edge):
      → KHÔNG override (audio + face đã agree là tin cậy hơn text).
        Log như potential issue.

Rule cuối (tier):
  conf ≥ GENDER_HIGH (0.80) → high → dùng full character profile cho TTS.
  GENDER_MEDIUM (0.60) ≤ conf < HIGH → medium → neutral-safe pronouns.
  conf < GENDER_MEDIUM → unknown → fallback voice (any).

Public API:
  detect_character_gender(character_profile, audio_gender, audio_conf,
                          face_gender, face_conf, self_ref_text,
                          face_track_stable=True) → GenderDecision
  detect_all_character_genders(registry, audio_genders, face_mapping, ...)
                              → tuple[dict[char_id, GenderDecision],
                                       list[GenderConflict]]
  detect_self_reference_gender(text) → Optional[str]  # "male"|"female"|None
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from app.config import (
    GENDER_AGREEMENT_BOOST,
    GENDER_AGREEMENT_CAP,
    GENDER_AUDIO_STRONG,
    GENDER_CONFLICT_PENALTY,
    GENDER_HIGH,
    GENDER_MEDIUM,
    GENDER_SELFREF_BOOST,
    GENDER_SELFREF_CAP,
)
from app.models.character_schemas import CharacterRegistry, GenderConflict

logger = logging.getLogger(__name__)


# ── Decision reasons ─────────────────────────────────────────────
REASON_AUDIO_ONLY = "audio_only"
REASON_AUDIO_FACE_AGREE = "audio_face_agree"
REASON_AUDIO_WINS_CONFLICT = "audio_wins_conflict_strong"
REASON_UNKNOWN_BOTH_WEAK = "unknown_both_weak"
REASON_FACE_ONLY = "face_only_no_audio"
REASON_NO_SIGNAL = "no_signal"
REASON_SELFREF_BOOSTED = "selfref_boosted"


@dataclass
class GenderDecision:
    """Per-character gender fusion decision."""
    character_id: str
    final_gender: str  # "male" / "female" / "unknown"
    final_confidence: float
    tier: str  # "high" / "medium" / "unknown"
    decision_reason: str
    audio_input: Optional[tuple[str, float]] = None  # (gender, conf)
    face_input: Optional[tuple[str, float]] = None
    self_ref_input: Optional[str] = None  # "male"/"female" nếu pattern match
    self_ref_boost_applied: bool = False
    sources_considered: list[str] = field(default_factory=list)


# ── Self-reference patterns (Vietnamese) ──────────────────────────
# Mỗi pattern: regex matching trên text dịch (hoặc original tiếng Việt).
# Strict match — chỉ count khi speaker rõ ràng tự nhận. Tránh false-positive
# (vd "Cô ấy là mẹ" — speaker nói VỀ người khác, không phải self).
#
# Quy tắc:
#   - Chỉ count khi có "Tôi" (1st person) + role/kinship.
#   - Hoặc verb "làm" + kinship role ("làm cha", "làm mẹ").
#   - Hoặc kinship word đứng đầu câu + verb tự nhận ("Mẹ đây", "Cha về rồi").
#
# KHÔNG count:
#   - "Anh đứng đó" (referring addressee — could be anyone)
#   - "Cô ấy đang đợi" (3rd person)
#   - "Em xin lỗi" (em ambiguous — vợ-chồng-anh-em-thầy-trò...)

_MALE_SELF_REF_PATTERNS = [
    # "Tôi là cha/bố/ba/ông/anh/chú/cậu/chàng trai/đàn ông/con trai"
    re.compile(
        r"\btôi\s+(?:là|làm|đã\s+làm)\s+(?:cha|bố|ba|ông|chú|cậu|"
        r"chàng\s+trai|đàn\s+ông|con\s+trai|nam\s+nhân|trai|"
        r"phụ\s+thân|gia\s+chủ|chồng|đấng\s+nam\s+nhi)\b",
        re.IGNORECASE,
    ),
    # "Tôi là một (người) đàn ông/con trai/cha"
    re.compile(
        r"\btôi\s+là\s+(?:một\s+)?(?:người\s+)?(?:đàn\s+ông|con\s+trai|"
        r"nam\s+(?:giới|nhân)|cha|bố)\b",
        re.IGNORECASE,
    ),
    # "Cha/Ba/Bố đây/về/đến" (self-announce as father)
    re.compile(
        r"^\s*(?:cha|bố|ba|phụ\s+thân|tía)\s+(?:đây|về|đến|đã\s+về|"
        r"không|chưa|sẽ|đang)\b",
        re.IGNORECASE,
    ),
    # "Anh là chồng/cha em" (clear marker)
    re.compile(
        r"\banh\s+(?:là|làm)\s+(?:chồng|cha|bố|ba|ông)\b",
        re.IGNORECASE,
    ),
]

_FEMALE_SELF_REF_PATTERNS = [
    # "Tôi là mẹ/má/bà/chị/cô/dì/thiếm/nương/phụ nữ/con gái/đàn bà"
    re.compile(
        r"\btôi\s+(?:là|làm|đã\s+làm)\s+(?:mẹ|má|bà|cô|dì|thiếm|nương|"
        r"phụ\s+nữ|con\s+gái|nữ\s+nhân|đàn\s+bà|gái|"
        r"mẫu\s+thân|vợ|tiểu\s+thư|cô\s+nương|nương\s+nương)\b",
        re.IGNORECASE,
    ),
    # "Tôi là một (người) phụ nữ/con gái/mẹ"
    re.compile(
        r"\btôi\s+là\s+(?:một\s+)?(?:người\s+)?(?:phụ\s+nữ|con\s+gái|"
        r"nữ\s+(?:giới|nhân)|mẹ|má|đàn\s+bà)\b",
        re.IGNORECASE,
    ),
    # "Mẹ/Má/Bà đây/về/đến"
    re.compile(
        r"^\s*(?:mẹ|má|bà|mẫu\s+thân|u)\s+(?:đây|về|đến|đã\s+về|"
        r"không|chưa|sẽ|đang)\b",
        re.IGNORECASE,
    ),
    # "Em là vợ/mẹ/chị anh" (clear marker)
    re.compile(
        r"\bem\s+(?:là|làm)\s+(?:vợ|mẹ|má|chị|cô)\b",
        re.IGNORECASE,
    ),
]


def detect_self_reference_gender(text: Optional[str]) -> Optional[str]:
    """Pattern-match self-reference gender từ text. Returns "male"/"female"/None.

    Chỉ count strong self-ref. Ambiguous patterns ("anh đứng đó", "em xin lỗi")
    KHÔNG count để tránh false positive (xem _MALE_/_FEMALE_SELF_REF_PATTERNS
    docstring).

    Conflict resolution: nếu cả male VÀ female pattern khớp (rare edge) →
    return None (ambiguous, không boost).
    """
    if not text or not isinstance(text, str):
        return None
    male_match = any(p.search(text) for p in _MALE_SELF_REF_PATTERNS)
    female_match = any(p.search(text) for p in _FEMALE_SELF_REF_PATTERNS)
    if male_match and female_match:
        logger.debug("self-ref ambiguous (both M+F patterns): %r", text[:50])
        return None
    if male_match:
        return "male"
    if female_match:
        return "female"
    return None


# ── Core fusion: detect_character_gender ──────────────────────────

def detect_character_gender(
    character_id: str,
    audio_gender: Optional[str] = None,
    audio_confidence: float = 0.0,
    face_gender: Optional[str] = None,
    face_confidence: float = 0.0,
    self_ref_gender: Optional[str] = None,
    face_track_stable: bool = True,
    *,
    audio_strong_threshold: float = GENDER_AUDIO_STRONG,
    agreement_boost: float = GENDER_AGREEMENT_BOOST,
    agreement_cap: float = GENDER_AGREEMENT_CAP,
    conflict_penalty: float = GENDER_CONFLICT_PENALTY,
    selfref_boost: float = GENDER_SELFREF_BOOST,
    selfref_cap: float = GENDER_SELFREF_CAP,
    high_threshold: float = GENDER_HIGH,
    medium_threshold: float = GENDER_MEDIUM,
) -> GenderDecision:
    """Fuse audio + face + self-ref → GenderDecision per character.

    Args:
      character_id: CHAR_XXX from registry.
      audio_gender: "male"/"female"/"unknown"/None.
      audio_confidence: 0-1 from F0 + formant + spectral classifier.
      face_gender: "male"/"female"/"unknown"/None từ insightface CNN.
      face_confidence: 0-1 từ CNN.
      self_ref_gender: "male"/"female"/None nếu text pattern match.
      face_track_stable: True nếu face_track đã map ổn định với character
        (cooccurrence ≥ AUDIO_FACE_COOCCURRENCE_MIN). False → bỏ qua face
        signal vì có thể từ frame ngẫu nhiên.

    Returns: GenderDecision với final gender + tier + reasoning.
    """
    audio_g_norm = audio_gender if audio_gender in ("male", "female") else None
    face_g_norm = face_gender if face_gender in ("male", "female") else None

    # Face chỉ tính khi face_track stable
    if not face_track_stable:
        face_g_norm = None
        face_confidence = 0.0

    sources: list[str] = []
    if audio_g_norm:
        sources.append("audio")
    if face_g_norm:
        sources.append("face")
    if self_ref_gender in ("male", "female"):
        sources.append("self_ref")

    # ── Case: no audio AND no face ──
    if audio_g_norm is None and face_g_norm is None:
        # Self-ref only → vẫn count nhưng cap conf medium
        if self_ref_gender in ("male", "female"):
            return GenderDecision(
                character_id=character_id,
                final_gender=self_ref_gender,
                final_confidence=round(selfref_boost * 2, 3),  # 0.20 tier=unknown
                tier="unknown",  # selfref alone → low conf, neutral safe
                decision_reason=REASON_SELFREF_BOOSTED,
                audio_input=None,
                face_input=None,
                self_ref_input=self_ref_gender,
                self_ref_boost_applied=True,
                sources_considered=sources,
            )
        return GenderDecision(
            character_id=character_id,
            final_gender="unknown",
            final_confidence=0.0,
            tier="unknown",
            decision_reason=REASON_NO_SIGNAL,
            sources_considered=sources,
        )

    # ── Case: face only (no audio) ──
    if audio_g_norm is None and face_g_norm is not None:
        final_g = face_g_norm
        final_c = float(face_confidence)
        if self_ref_gender == final_g:
            final_c = min(final_c + selfref_boost, selfref_cap)
        return GenderDecision(
            character_id=character_id,
            final_gender=final_g,
            final_confidence=round(final_c, 3),
            tier=_tier_from_conf(final_c, high_threshold, medium_threshold),
            decision_reason=REASON_FACE_ONLY,
            audio_input=None,
            face_input=(face_g_norm, face_confidence),
            self_ref_input=self_ref_gender,
            self_ref_boost_applied=(self_ref_gender == final_g),
            sources_considered=sources,
        )

    # ── Case: audio only (no face) ──
    if face_g_norm is None and audio_g_norm is not None:
        final_g = audio_g_norm
        final_c = float(audio_confidence)
        if self_ref_gender == final_g:
            final_c = min(final_c + selfref_boost, selfref_cap)
        return GenderDecision(
            character_id=character_id,
            final_gender=final_g,
            final_confidence=round(final_c, 3),
            tier=_tier_from_conf(final_c, high_threshold, medium_threshold),
            decision_reason=REASON_AUDIO_ONLY,
            audio_input=(audio_g_norm, audio_confidence),
            face_input=None,
            self_ref_input=self_ref_gender,
            self_ref_boost_applied=(self_ref_gender == final_g),
            sources_considered=sources,
        )

    # ── Case: both audio + face ──
    if audio_g_norm == face_g_norm:
        # AGREE
        final_g = audio_g_norm
        final_c = min(
            max(audio_confidence, face_confidence) + agreement_boost,
            agreement_cap,
        )
        if self_ref_gender == final_g:
            final_c = min(final_c + selfref_boost, selfref_cap)
        return GenderDecision(
            character_id=character_id,
            final_gender=final_g,
            final_confidence=round(final_c, 3),
            tier=_tier_from_conf(final_c, high_threshold, medium_threshold),
            decision_reason=REASON_AUDIO_FACE_AGREE,
            audio_input=(audio_g_norm, audio_confidence),
            face_input=(face_g_norm, face_confidence),
            self_ref_input=self_ref_gender,
            self_ref_boost_applied=(self_ref_gender == final_g),
            sources_considered=sources,
        )

    # DISAGREE
    if audio_confidence >= audio_strong_threshold:
        # Audio thắng
        final_g = audio_g_norm
        final_c = max(audio_confidence - conflict_penalty, 0.0)
        if self_ref_gender == final_g:
            final_c = min(final_c + selfref_boost, selfref_cap)
        return GenderDecision(
            character_id=character_id,
            final_gender=final_g,
            final_confidence=round(final_c, 3),
            tier=_tier_from_conf(final_c, high_threshold, medium_threshold),
            decision_reason=REASON_AUDIO_WINS_CONFLICT,
            audio_input=(audio_g_norm, audio_confidence),
            face_input=(face_g_norm, face_confidence),
            self_ref_input=self_ref_gender,
            self_ref_boost_applied=(self_ref_gender == final_g),
            sources_considered=sources,
        )
    # Cả 2 yếu → unknown
    return GenderDecision(
        character_id=character_id,
        final_gender="unknown",
        final_confidence=0.0,
        tier="unknown",
        decision_reason=REASON_UNKNOWN_BOTH_WEAK,
        audio_input=(audio_g_norm, audio_confidence),
        face_input=(face_g_norm, face_confidence),
        self_ref_input=self_ref_gender,
        sources_considered=sources,
    )


def _tier_from_conf(conf: float, high: float, medium: float) -> str:
    if conf >= high:
        return "high"
    if conf >= medium:
        return "medium"
    return "unknown"


# ── Batch entry: detect_all_character_genders ─────────────────────

def detect_all_character_genders(
    registry: CharacterRegistry,
    audio_speaker_genders: dict[str, str],
    audio_speaker_gender_confs: dict[str, float],
    face_track_to_speaker: Optional[dict[int, str]] = None,
    face_genders: Optional[dict[int, str]] = None,
    face_gender_confs: Optional[dict[int, float]] = None,
    character_texts: Optional[dict[str, list[str]]] = None,
    *,
    apply_to_profiles: bool = True,
    **fusion_kwargs,
) -> tuple[dict[str, GenderDecision], list[GenderConflict]]:
    """Compute fused gender for ALL characters in registry.

    Args:
      registry: CharacterRegistry from Phase 5.
      audio_speaker_genders: {SPEAKER_XX: gender} per raw audio speaker.
      audio_speaker_gender_confs: {SPEAKER_XX: 0-1} confidence.
      face_track_to_speaker: {face_id: SPEAKER_XX} mapping (E1 evidence
        wire). Face_track_to_character built bằng inverse + registry source.
      face_genders / face_gender_confs: per face_id.
      character_texts: {char_id: list[str]} — original-language transcripts
        per character (cho self-ref pattern match). None → skip text signal.
      apply_to_profiles: True → mutate CharacterProfile.gender + .gender_confidence
        + .review_required directly trong registry. False → dry-run.

    Returns: (decisions, conflicts) where:
      - decisions: {char_id: GenderDecision}
      - conflicts: list GenderConflict cho audit (audio vs face disagree).
    """
    face_track_to_speaker = face_track_to_speaker or {}
    face_genders = face_genders or {}
    face_gender_confs = face_gender_confs or {}
    character_texts = character_texts or {}

    # Build per-character: aggregate audio + face per source_speakers
    decisions: dict[str, GenderDecision] = {}
    conflicts: list[GenderConflict] = []

    # Reverse map: SPEAKER_XX → face_id (chỉ những face_track stable)
    speaker_to_face: dict[str, list[int]] = {}
    for face_id, spk in face_track_to_speaker.items():
        speaker_to_face.setdefault(spk, []).append(face_id)

    for char_id, profile in registry.characters.items():
        # ── Aggregate audio gender per character ──
        audio_g, audio_c = _vote_gender_weighted(
            [
                (audio_speaker_genders.get(spk), audio_speaker_gender_confs.get(spk, 0.0))
                for spk in profile.source_speakers
            ]
        )

        # ── Aggregate face gender per character ──
        # Face_track stable = char có ≥ 1 source_speaker → face_id mapping
        face_ids_for_char: list[int] = []
        for spk in profile.source_speakers:
            face_ids_for_char.extend(speaker_to_face.get(spk, []))
        face_track_stable = bool(face_ids_for_char)
        face_g, face_c = _vote_gender_weighted(
            [
                (face_genders.get(fid), face_gender_confs.get(fid, 0.0))
                for fid in face_ids_for_char
            ]
        )

        # ── Self-ref text vote ──
        self_ref = None
        if char_id in character_texts:
            self_ref_votes = [
                detect_self_reference_gender(t)
                for t in character_texts[char_id]
            ]
            self_ref_votes = [v for v in self_ref_votes if v in ("male", "female")]
            if self_ref_votes:
                # Majority
                from collections import Counter
                top = Counter(self_ref_votes).most_common(1)[0][0]
                self_ref = top

        decision = detect_character_gender(
            character_id=char_id,
            audio_gender=audio_g,
            audio_confidence=audio_c,
            face_gender=face_g,
            face_confidence=face_c,
            self_ref_gender=self_ref,
            face_track_stable=face_track_stable,
            **fusion_kwargs,
        )
        decisions[char_id] = decision

        # Log conflict (audio + face đều có nhưng disagree)
        if (
            audio_g in ("male", "female")
            and face_g in ("male", "female")
            and audio_g != face_g
        ):
            conflicts.append(GenderConflict(
                character_id=char_id,
                audio_gender=audio_g,
                audio_confidence=round(audio_c, 3),
                face_gender=face_g,
                face_confidence=round(face_c, 3),
                llm_gender=None,
                llm_evidence=None,
                decision=decision.final_gender,
                decision_reason=decision.decision_reason,
            ))

        if apply_to_profiles:
            profile.gender = decision.final_gender  # type: ignore[assignment]
            profile.gender_confidence = decision.final_confidence
            profile.review_required = (
                decision.tier == "unknown" or decision.final_gender == "unknown"
            )

    logger.info(
        "gender_detection: %d characters · %d conflicts (audio vs face)",
        len(decisions), len(conflicts),
    )
    from collections import Counter
    tier_counts = Counter(d.tier for d in decisions.values())
    reason_counts = Counter(d.decision_reason for d in decisions.values())
    logger.info(
        "gender_detection tiers: %s · reasons: %s",
        dict(tier_counts), dict(reason_counts),
    )

    return decisions, conflicts


def _vote_gender_weighted(
    votes: list[tuple[Optional[str], float]],
) -> tuple[Optional[str], float]:
    """Weighted vote: gộp (gender, conf) list → final (gender, conf).

    Algorithm:
      - Sum conf per gender ("male", "female"). Bỏ unknown/None.
      - Winner = gender với max sum_conf.
      - Conf = sum_conf[winner] / total_voters_count (avg conf of winner side).
      - Tie hoặc empty → (None, 0.0).
    """
    weights: dict[str, list[float]] = {}
    for g, c in votes:
        if g not in ("male", "female"):
            continue
        weights.setdefault(g, []).append(float(c))
    if not weights:
        return (None, 0.0)
    sums = {g: sum(confs) for g, confs in weights.items()}
    if len(sums) == 2 and abs(sums["male"] - sums["female"]) < 1e-6:
        return (None, 0.0)  # exact tie
    winner = max(sums, key=lambda g: sums[g])
    winner_confs = weights[winner]
    return (winner, sum(winner_confs) / len(winner_confs))
