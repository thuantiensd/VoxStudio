"""Voice mapping service (Phase 8 refactor — character-aware).

Phase 8 NEW: `build_character_voice_map` — single source of truth là
`CharacterProfile` từ character_registry. Supports 3 explicit modes:

  • "1_voice":     all characters → voice_slots[0].voice_id (gender ignored)
  • "2_voice":     gender-matched (male char → male slot, female → female).
                    Unknown gender → fallback_voice_id || majority gender voice.
  • "multi_voice": top N chars (by line_count desc, total_duration desc,
                    character_id asc tie-break) → 1 slot riêng. Còn lại
                    fallback theo gender như 2_voice rule.

Phase 8 LEGACY: `build_speaker_voice_map` — wrapper deprecated, giữ cho
face-only path (no registry). Sẽ xóa ở Phase 12.

Phase 8 MIN-1 fix: KHÔNG còn hardcode "slot 0 = male, slot 1 = female".
Caller pass `VoiceSlot(voice_id, gender, priority)` explicit. Default
config trong DEFAULT_VOICE_SLOTS_* constants.
"""
from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal, Optional

from app.config import GENDER_VOICE_MATCH_MIN
from app.models.character_schemas import CharacterProfile, VoiceMapWarning

logger = logging.getLogger(__name__)


# ── VoiceSlot dataclass (Phase 8 MIN-1 fix) ───────────────────────

@dataclass
class VoiceSlot:
    """1 voice slot — explicit gender + priority, không hardcode position."""
    voice_id: str
    gender: Literal["male", "female", "any"] = "any"
    priority: int = 0  # higher = preferred for top characters in multi_voice


# Default configs — caller override được khi cần.
DEFAULT_VOICE_SLOTS_2VOICE: list[VoiceSlot] = [
    VoiceSlot(voice_id="vi_male_default", gender="male", priority=10),
    VoiceSlot(voice_id="vi_female_default", gender="female", priority=10),
]


VoiceModeType = Literal["1_voice", "2_voice", "multi_voice"]


# ── Phase 8 main entry: build_character_voice_map ─────────────────

def build_character_voice_map(
    characters: dict[str, CharacterProfile],
    voice_slots: list[VoiceSlot],
    mode: VoiceModeType,
    fallback_voice_id: Optional[str] = None,
    *,
    apply_to_profiles: bool = True,
) -> tuple[dict[str, str], list[VoiceMapWarning]]:
    """Build character_id → voice_id map (Phase 8 character-aware).

    Args:
      characters: dict[CHAR_XXX, CharacterProfile] từ Phase 5 registry.
      voice_slots: list VoiceSlot (gender explicit, không hardcode position).
      mode: "1_voice" / "2_voice" / "multi_voice".
      fallback_voice_id: voice cho unknown gender chars (mode 2/multi).
        None → fallback theo majority gender + log warning.
      apply_to_profiles: True → mutate CharacterProfile.voice_profile_id.
        False → dry-run.

    Returns: (voice_map: char_id → voice_id, warnings list)

    Mode 1 (1_voice):
      Tất cả char → voice_slots[0].voice_id. KHÔNG cần gender.

    Mode 2 (2_voice):
      Mỗi gender → slot tương ứng (theo VoiceSlot.gender):
        male char   → first slot có gender=male
        female char → first slot có gender=female
        unknown     → fallback_voice_id || majority_voice + warning

    Mode multi (multi_voice):
      Sort chars by (line_count desc, total_duration desc, char_id asc).
      Top N chars (N = len(voice_slots)) → 1 voice riêng theo gender match.
      Rank > N → fallback theo gender (như Mode 2 unknown rule).
    """
    if not characters:
        return {}, []
    if not voice_slots:
        logger.warning("build_character_voice_map: no voice_slots provided")
        return {}, []

    voice_map: dict[str, str] = {}
    warnings: list[VoiceMapWarning] = []

    if mode == "1_voice":
        # All chars → first slot voice. Gender ignored.
        primary_voice = voice_slots[0].voice_id
        for char_id in characters:
            voice_map[char_id] = primary_voice
        logger.info(
            "build_character_voice_map mode=1_voice: %d chars → %s (gender ignored)",
            len(characters), primary_voice,
        )

    elif mode == "2_voice":
        majority_g = _compute_majority_gender(characters)
        for char_id, profile in characters.items():
            voice_id, warning = _resolve_voice_for_character(
                char_id=char_id,
                profile=profile,
                voice_slots=voice_slots,
                fallback_voice_id=fallback_voice_id,
                majority_gender=majority_g,
                is_top_priority=False,
                used_slots=None,  # mode 2 không reserve slot
            )
            voice_map[char_id] = voice_id
            if warning:
                warnings.append(warning)
        logger.info(
            "build_character_voice_map mode=2_voice: %d chars, %d warnings, "
            "majority_gender=%s",
            len(characters), len(warnings), majority_g,
        )

    elif mode == "multi_voice":
        # Sort chars by importance: line_count desc, duration desc, id asc.
        # Tie-breaker đảm bảo deterministic (Phase 8 risk #1).
        sorted_chars = sorted(
            characters.items(),
            key=lambda kv: (-kv[1].line_count, -kv[1].total_duration, kv[0]),
        )
        n_slots = len(voice_slots)
        majority_g = _compute_majority_gender(characters)
        used_slot_indices: set[int] = set()

        # Top N: assign từng slot riêng (prefer gender match)
        for rank, (char_id, profile) in enumerate(sorted_chars[:n_slots]):
            voice_id, warning = _resolve_voice_for_character(
                char_id=char_id,
                profile=profile,
                voice_slots=voice_slots,
                fallback_voice_id=fallback_voice_id,
                majority_gender=majority_g,
                is_top_priority=True,
                used_slots=used_slot_indices,
            )
            voice_map[char_id] = voice_id
            if warning:
                warnings.append(warning)

        # Rank > N: fallback (no slot reservation needed)
        for char_id, profile in sorted_chars[n_slots:]:
            voice_id, warning = _resolve_voice_for_character(
                char_id=char_id,
                profile=profile,
                voice_slots=voice_slots,
                fallback_voice_id=fallback_voice_id,
                majority_gender=majority_g,
                is_top_priority=False,
                used_slots=None,
            )
            voice_map[char_id] = voice_id
            if warning:
                warnings.append(warning)

        logger.info(
            "build_character_voice_map mode=multi_voice: %d chars (top %d "
            "gender-matched slots), %d warnings, majority_gender=%s",
            len(characters), n_slots, len(warnings), majority_g,
        )
    else:
        raise ValueError(f"Unknown voice mode: {mode!r}")

    # Mutate CharacterProfile.voice_profile_id
    if apply_to_profiles:
        for char_id, voice_id in voice_map.items():
            if char_id in characters:
                characters[char_id].voice_profile_id = voice_id

    return voice_map, warnings


def _compute_majority_gender(
    characters: dict[str, CharacterProfile],
) -> Optional[str]:
    """Compute majority gender by CHARACTER COUNT (not line_count).

    Tie → first alphabetical (female < male). Returns None nếu không có
    male/female char nào.

    Phase 8 risk #2 mitigation: count chars, KHÔNG count theo line_count
    (line_count weighting có thể skew majority về 1 char nói nhiều).
    """
    gender_counter = Counter(
        p.gender for p in characters.values()
        if p.gender in ("male", "female")
    )
    if not gender_counter:
        return None
    max_count = max(gender_counter.values())
    candidates = sorted([g for g, c in gender_counter.items() if c == max_count])
    return candidates[0]


def _candidate_slots_for(
    voice_slots: list[VoiceSlot],
    prefer_gender: str,
    used_slots: Optional[set[int]],
) -> list[int]:
    """Returns slot indices that can serve `prefer_gender`, sorted by preference.

    Tier ordering:
      Tier 0: exact gender match (slot.gender == prefer_gender)
      Tier 1: "any" gender slot
      Tier 2: (excluded — slot có gender khác → KHÔNG match)

    Within tier: priority desc → original index asc.

    Nếu used_slots not None → exclude already-used.
    """
    if not voice_slots:
        return []
    candidates: list[tuple[int, int, int]] = []  # (tier, -priority, original_idx)
    for idx, slot in enumerate(voice_slots):
        if used_slots is not None and idx in used_slots:
            continue
        if slot.gender == prefer_gender:
            tier = 0
        elif slot.gender == "any":
            tier = 1
        else:
            continue
        candidates.append((tier, -slot.priority, idx))
    candidates.sort()
    return [c[2] for c in candidates]


def _resolve_voice_for_character(
    char_id: str,
    profile: CharacterProfile,
    voice_slots: list[VoiceSlot],
    fallback_voice_id: Optional[str],
    majority_gender: Optional[str],
    *,
    is_top_priority: bool,
    used_slots: Optional[set[int]],
) -> tuple[str, Optional[VoiceMapWarning]]:
    """Resolve voice_id cho 1 character — gender match → fallback → majority.

    Returns: (voice_id, warning_or_None).
    Mutates used_slots set nếu is_top_priority + slot assignable.

    Priority order (known gender):
      1a. Unused slot matching gender exactly OR "any" — preferred for is_top.
      1b. Reuse: same-gender slot (allow used) — warning reused_slot_same_gender.
      1c. Reuse: any slot — warning no_matching_gender_slot.
      1d. Fallback path (rare — no slots at all).

    Priority order (unknown gender):
      2a. fallback_voice_id explicit (Phase 8 risk #3 — highest).
      2b. is_top + unused "any" slot — natural fit for top-priority unknown.
      2c. Majority gender voice.
      2d. Any "any" slot.
      2e. voice_slots[0] last resort.
    """
    g = profile.gender

    # Case 1: known gender (male/female)
    if g in ("male", "female"):
        # 1a. Unused slot matching gender or "any"
        unused = _candidate_slots_for(voice_slots, g, used_slots)
        if unused:
            idx = unused[0]
            if is_top_priority and used_slots is not None:
                used_slots.add(idx)
            return (voice_slots[idx].voice_id, None)

        # 1b. Reuse: same-gender slot (top priority exhausted, non-top fallback)
        reuse_same = _candidate_slots_for(voice_slots, g, used_slots=None)
        if reuse_same:
            idx = reuse_same[0]
            slot = voice_slots[idx]
            issue = (
                "reused_slot_same_gender" if slot.gender == g
                else "no_matching_gender_slot"
            )
            return (
                slot.voice_id,
                VoiceMapWarning(
                    character_id=char_id,
                    issue=issue,
                    decided_voice=slot.voice_id,
                    reason=f"char gender={g}, slot reused (top priority exhausted)",
                ),
            )

        # 1d. No slot at all (rare) → fallback / first
        return _fallback_resolve(
            char_id=char_id,
            char_gender=g,
            voice_slots=voice_slots,
            fallback_voice_id=fallback_voice_id,
            majority_gender=majority_gender,
            is_top_priority=is_top_priority,
            used_slots=used_slots,
            reason_prefix=f"no_matching_gender_slot (char gender={g})",
        )

    # Case 2: unknown gender — Phase 8 risk #3 explicit priority
    return _fallback_resolve(
        char_id=char_id,
        char_gender="unknown",
        voice_slots=voice_slots,
        fallback_voice_id=fallback_voice_id,
        majority_gender=majority_gender,
        is_top_priority=is_top_priority,
        used_slots=used_slots,
        reason_prefix="unknown_gender",
    )


def _fallback_resolve(
    char_id: str,
    char_gender: str,
    voice_slots: list[VoiceSlot],
    fallback_voice_id: Optional[str],
    majority_gender: Optional[str],
    is_top_priority: bool,
    used_slots: Optional[set[int]],
    reason_prefix: str,
) -> tuple[str, VoiceMapWarning]:
    """Phase 8 risk #3 mitigation: explicit priority order.

    Order:
      1. fallback_voice_id (caller-provided explicit) ← highest
      2. (unknown + is_top only) unused "any" slot — natural top-priority fit
      3. majority_gender voice (allow reuse)
      4. first "any" gender slot (allow reuse)
      5. voice_slots[0].voice_id (last resort)
    """
    # 1. Explicit fallback (caller's call wins absolute)
    if fallback_voice_id:
        return (
            fallback_voice_id,
            VoiceMapWarning(
                character_id=char_id,
                issue="unknown_gender_fallback_applied"
                      if char_gender == "unknown"
                      else "no_matching_gender_slot",
                decided_voice=fallback_voice_id,
                reason=f"{reason_prefix} → fallback_voice_id provided",
            ),
        )

    # 2. Unknown + is_top: prefer ANY unused slot for distinct voice (Phase 12 fix).
    # Multi_voice intent = top N chars get N distinct voices. Khi user pick N
    # gendered slots không có "any", thà dùng slot wrong-gender còn hơn collapse
    # 2 chars vào cùng 1 slot. Order:
    #   2a. unused "any" slot (best fit)
    #   2b. unused ANY-gender slot (distinct voice > correct gender for unknown)
    if char_gender == "unknown" and is_top_priority and used_slots is not None:
        # 2a. Try unused "any" slot first
        for idx, slot in enumerate(voice_slots):
            if slot.gender == "any" and idx not in used_slots:
                used_slots.add(idx)
                return (
                    slot.voice_id,
                    VoiceMapWarning(
                        character_id=char_id,
                        issue="unknown_gender_no_fallback",
                        decided_voice=slot.voice_id,
                        reason=f"{reason_prefix}, no fallback → unused 'any' "
                               f"slot (top-priority)",
                    ),
                )
        # 2b. No unused "any" → try ANY unused slot (any gender) for distinct voice.
        for idx, slot in enumerate(voice_slots):
            if idx not in used_slots:
                used_slots.add(idx)
                return (
                    slot.voice_id,
                    VoiceMapWarning(
                        character_id=char_id,
                        issue="unknown_gender_no_fallback",
                        decided_voice=slot.voice_id,
                        reason=f"{reason_prefix}, no fallback, no 'any' slot → "
                               f"unused gendered slot for distinct voice "
                               f"(top-priority, slot.gender={slot.gender})",
                    ),
                )

    # 3. Majority gender voice (allow reuse since usually exhausted)
    if majority_gender:
        cands = _candidate_slots_for(voice_slots, majority_gender, used_slots=None)
        if cands:
            idx = cands[0]
            return (
                voice_slots[idx].voice_id,
                VoiceMapWarning(
                    character_id=char_id,
                    issue="majority_rule_applied",
                    decided_voice=voice_slots[idx].voice_id,
                    reason=f"{reason_prefix}, no fallback → majority gender "
                           f"{majority_gender} voice",
                ),
            )

    # 4. First "any" slot (allow reuse)
    for i, s in enumerate(voice_slots):
        if s.gender == "any":
            return (
                s.voice_id,
                VoiceMapWarning(
                    character_id=char_id,
                    issue="tie_breaker_alphabetical"
                          if majority_gender is None
                          else "no_matching_gender_slot",
                    decided_voice=s.voice_id,
                    reason=f"{reason_prefix}, no fallback, no majority → "
                           f"first any-gender slot",
                ),
            )

    # 5. Last resort
    return (
        voice_slots[0].voice_id,
        VoiceMapWarning(
            character_id=char_id,
            issue="voice_slot_count_insufficient",
            decided_voice=voice_slots[0].voice_id,
            reason=f"{reason_prefix}, no fallback, no majority, no any-slot → "
                   f"voice_slots[0] last resort",
        ),
    )


# ── LEGACY: build_speaker_voice_map (deprecated wrapper) ──────────


def build_speaker_voice_map(
    speakers: list[str],
    voice_slots: list[str],
    user_overrides: Optional[dict[str, str]] = None,
    default_voice: Optional[str] = None,
    speaker_genders: Optional[dict[str, str]] = None,
    gender_confidences: Optional[dict[str, float]] = None,
    confidence_threshold: float = GENDER_VOICE_MATCH_MIN,
) -> dict[str, str]:
    """DEPRECATED Phase 8 — wrapper cho legacy raw-speaker path (face-only).

    Phase 8 NEW: dùng `build_character_voice_map` cho character-aware path
    (CHAR_XXX namespace, single source of truth = CharacterProfile). Function
    này giữ làm backward-compat cho:
      - Face-only path (no pyannote registry) — voice_map keyed bằng FACE_XX
      - Audio-only legacy path (no character_registry build) — SPEAKER_XX

    Phase 12 sẽ xóa hoàn toàn + force tất cả callers dùng character_voice_map
    (kể cả face-only — build pseudo-registry từ face IDs).

    Logic giữ nguyên Phase 1-7b (xem git history pre-Phase 8 cho doc cũ).

    Convention hardcoded slot 0=male, slot 1=female được giữ — không sửa
    legacy path vì caller (dubbing_svc fallback block) vẫn pass raw list[str]
    voice_slots, không phải VoiceSlot.
    """
    overrides = user_overrides or {}
    genders = speaker_genders or {}
    confs = gender_confidences or {}
    n_slots = len(voice_slots)

    result: dict[str, str] = {}
    used_slots: set[int] = set()

    # Slot gender convention: slot 0 = nam, slot 1 = nữ, slot 2+ = any.
    # Khai báo ngoài Pass 2 để Pass 3 access được (cho gender match reuse).
    slot_genders: list[str] = []
    for i in range(n_slots):
        if i == 0:
            slot_genders.append("male")
        elif i == 1:
            slot_genders.append("female")
        else:
            slot_genders.append("any")

    # Pass 1: explicit user overrides
    for spk in speakers:
        if spk in overrides and overrides[spk]:
            result[spk] = overrides[spk]

    # Pass 2: gender-aware match (slot 0=nam, slot 1=nữ) — CHỈ khi confidence
    # ≥ threshold. Confidence thấp → skip pass này, để Pass 3 cycle slot
    # (an toàn hơn guess sai).
    if genders:
        for spk in speakers:
            if spk in result:
                continue
            g = genders.get(spk, "unknown")
            if g not in ("male", "female"):
                continue
            # Confidence cao → strict match. Confidence thấp → SOFT match
            # (vẫn ưu tiên slot match gender, KHÔNG cycle về slot 0 mặc định —
            # vì cycle hay làm female speaker đọc bằng giọng nam).
            spk_conf = confs.get(spk, 1.0)
            is_low_conf = spk_conf < confidence_threshold

            matched = False
            for i, sg in enumerate(slot_genders):
                if i in used_slots or sg != g:
                    continue
                if i < n_slots and voice_slots[i]:
                    result[spk] = voice_slots[i]
                    used_slots.add(i)
                    matched = True
                    if is_low_conf:
                        logger.info(
                            "Speaker %s gender=%s conf=%.2f < %.2f LOW conf — vẫn dùng "
                            "slot gender-match %d (avoid male voice for female speaker)",
                            spk, g, spk_conf, confidence_threshold, i,
                        )
                    break
            if not matched and is_low_conf:
                logger.info(
                    "Speaker %s gender=%s conf=%.2f thấp + không có slot match → cycle",
                    spk, g, spk_conf,
                )

    # Pass 3: speaker còn sót — ƯU TIÊN GENDER MATCH ngay cả khi slot đã
    # dùng. Nguyên tắc: thà 2 char cùng gender share voice slot, còn hơn
    # đẩy char vào slot SAI gender.
    #
    # Thứ tự ưu tiên:
    #   3a. Unused slot matching gender (rare — Pass 2 đã ăn hết)
    #   3b. **Used slot matching gender (REUSE)** ← MỚI: tránh wrong gender
    #   3c. Unused slot any gender
    #   3d. Cycle qua tất cả slot (last resort)
    for i, spk in enumerate(speakers):
        if spk in result:
            continue
        g = genders.get(spk, "unknown")

        # 3a. Unused slot match gender
        assigned = False
        if g in ("male", "female"):
            for j, sg in enumerate(slot_genders):
                if j in used_slots or sg != g:
                    continue
                if j < n_slots and voice_slots[j]:
                    result[spk] = voice_slots[j]
                    used_slots.add(j)
                    assigned = True
                    break
        if assigned:
            continue

        # 3b. USED slot match gender (REUSE) — quan trọng để tránh wrong gender.
        # Vd: 3 chars [female, male, female] + 2 slots [nam, nữ] → char_02
        # female sẽ reuse slot 1 (nữ) thay vì rơi sang slot 0 (nam).
        if g in ("male", "female"):
            for j, sg in enumerate(slot_genders):
                if sg != g:
                    continue
                if j < n_slots and voice_slots[j]:
                    result[spk] = voice_slots[j]
                    assigned = True
                    logger.info(
                        "Speaker %s (gender=%s) reuse slot %d (cùng gender) "
                        "thay vì cycle wrong gender",
                        spk, g, j,
                    )
                    break
        if assigned:
            continue

        # 3c. Unused slot bất kỳ (gender không match, nhưng còn slot trống)
        for j in range(n_slots):
            if j in used_slots:
                continue
            if voice_slots[j]:
                result[spk] = voice_slots[j]
                used_slots.add(j)
                assigned = True
                logger.warning(
                    "Speaker %s gender=%s không có slot match → dùng slot %d "
                    "(wrong gender — voice slots có thể thiếu)",
                    spk, g, j,
                )
                break
        if assigned:
            continue

        # 3d. Last resort — cycle qua tất cả slot non-empty
        non_empty = [v for v in voice_slots if v]
        if non_empty:
            result[spk] = non_empty[i % len(non_empty)]
            continue
        if default_voice:
            result[spk] = default_voice
        else:
            result[spk] = ""

    logger.info("Voice mapping (genders=%s): %s", genders, result)
    return result


def get_voice_for_sentence(
    speaker_id: Optional[str],
    voice_map: dict[str, str],
    default_voice: Optional[str] = None,
) -> Optional[str]:
    """Resolve voice cho sentence's speaker.

    None speaker → default. Speaker không trong map → default.
    """
    if speaker_id and speaker_id in voice_map and voice_map[speaker_id]:
        return voice_map[speaker_id]
    return default_voice
