"""Voice routing service (Phase 12 STRICT — character_id only).

Pure functions cho voice resolution + consistency validation. Tách khỏi
dubbing_svc (ffmpeg-heavy) để testable trên minimal env.

Public:
  resolve_voice_by_character_id(character_id, project) → (voice_id, fallback_reason)
  log_voice_fallback(project, seg, character_id, voice_id, reason)
  validate_character_voice_consistency(project) → list[conflict_dict]

Rules enforced (Phase 12 spec):
  Rule 1: TTS chỉ dùng character_id → registry → voice_profile_id.
  Rule 2: missing character_id / voice_profile_id null → fallback_voice + log.
  Rule 3: 1 character → 1 voice_profile_id. Validation rewrite + log conflict.

TUYỆT ĐỐI KHÔNG dùng raw_speaker, speaker_gender, batch[0], face_gender.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Optional

logger = logging.getLogger(__name__)


def resolve_voice_by_character_id(
    character_id: Optional[str],
    project: dict,
) -> tuple[Optional[str], Optional[str]]:
    """STRICT character_id voice resolution. NO raw_speaker fallback.

    5-tier resolution:
      Tier 1: voice_map[character_id] direct hit → (voice, None).
      Tier 2: missing character_id → first slot → log "missing_character_id".
      Tier 3: char has profile + gender → gender-matched slot.
              (slot 0=male, slot 1=female convention — hardcoded UI.)
      Tier 4: no gender match → first non-empty slot.
      Tier 5: nothing → (None, "no_voice_available").

    Returns: (voice_id, fallback_reason). fallback_reason=None nếu direct hit.
    """
    voice_map = project.get("speaker_voice_map") or {}
    voice_slots = project.get("voice_slots") or []
    project_voice_id = project.get("voice_id")

    # Tier 1: STRICT character_id direct lookup
    if character_id and character_id in voice_map:
        v = voice_map[character_id]
        if v:
            return (v, None)

    # Tier 2: missing character_id
    if not character_id:
        for slot_v in voice_slots:
            if slot_v:
                return (slot_v, "missing_character_id")
        if project_voice_id:
            return (project_voice_id, "missing_character_id_use_project_default")
        return (None, "missing_character_id_no_fallback")

    # Tier 3: character_id present, voice_map missing → gender fallback
    char_summary = (project.get("character_registry_summary") or {}).get("characters") or []
    profile = next(
        (c for c in char_summary if c.get("character_id") == character_id),
        None,
    )
    if profile:
        gender = profile.get("gender")
        if gender == "male" and len(voice_slots) >= 1 and voice_slots[0]:
            return (voice_slots[0], "voice_profile_null_gender_male_fallback")
        if gender == "female" and len(voice_slots) >= 2 and voice_slots[1]:
            return (voice_slots[1], "voice_profile_null_gender_female_fallback")

    # Tier 4: no gender / no slot match → first non-empty slot
    for slot_v in voice_slots:
        if slot_v:
            return (slot_v, "voice_profile_null_default_slot_fallback")
    if project_voice_id:
        return (project_voice_id, "voice_profile_null_use_project_default")

    return (None, "no_voice_available")


def log_voice_fallback(
    project: dict,
    seg: dict,
    character_id: Optional[str],
    voice_id: Optional[str],
    reason: str,
) -> None:
    """Log voice fallback warning vào project meta cho qa_report."""
    warnings = project.setdefault("voice_warnings", [])
    warnings.append({
        "segment_id": seg.get("index", seg.get("id", "?")),
        "character_id": character_id,
        "issue": reason,
        "fallback_used": voice_id or "(none)",
    })
    if not character_id:
        uncert = project.setdefault("uncertain_segments_no_char", [])
        seg_key = seg.get("index", seg.get("id", "?"))
        if seg_key not in uncert:
            uncert.append(seg_key)
    logger.warning(
        "voice_fallback: seg=%s char=%s reason=%s → voice=%s",
        seg.get("index", "?"), character_id, reason, voice_id,
    )


def validate_character_voice_consistency(project: dict) -> list[dict]:
    """Phase 12 Item 6 — enforce 1 character → 1 voice_profile_id.

    Scan all segments. Per character_id, collect set of voice_ids actually
    used (seg["voice_id"] explicit override hoặc voice_map lookup).

    Nếu cùng character_id có ≥ 2 voice → resolve về expected voice:
      - Expected = voice_map[character_id] (single source of truth)
      - Nếu expected null → first voice in set sorted alphabetically
      - Rewrite seg["voice_id"] = expected cho tất cả segments của char

    Log conflicts vào project["voice_conflicts"].

    Returns: list of conflict dicts (1 per character with conflict).
    Mutates: project["segments"][i]["voice_id"], project["voice_conflicts"].
    """
    voice_map = project.get("speaker_voice_map") or {}
    segments = project.get("segments") or []

    # Per character: collect (segments using this char, voices used)
    actual_voices: dict[str, set] = defaultdict(set)
    char_segments: dict[str, list] = defaultdict(list)
    for s in segments:
        cid = s.get("character_id")
        if not cid:
            continue
        char_segments[cid].append(s)
        # Voice "in use" = explicit seg.voice_id OR registry voice_map
        v = s.get("voice_id") or voice_map.get(cid)
        if v:
            actual_voices[cid].add(v)

    conflicts: list[dict] = []
    for cid, voices in actual_voices.items():
        if len(voices) <= 1:
            continue  # consistent

        # Expected = registry voice_map (single source of truth)
        expected = voice_map.get(cid)
        if not expected:
            # No expected → pick deterministic first alphabetically
            expected = sorted(voices)[0]

        # Auto-fix: rewrite all segments of this char to expected voice
        for s in char_segments[cid]:
            s["voice_id"] = expected

        conflict = {
            "character_id": cid,
            "voices_found": sorted(voices),
            "resolved_to": expected,
            "reason": "same_character_multiple_voices",
        }
        conflicts.append(conflict)
        logger.warning(
            "voice_conflict: char=%s voices_found=%s resolved=%s",
            cid, sorted(voices), expected,
        )

    if conflicts:
        existing = project.setdefault("voice_conflicts", [])
        existing.extend(conflicts)

    return conflicts
