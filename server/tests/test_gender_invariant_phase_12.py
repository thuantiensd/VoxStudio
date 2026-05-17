"""Phase 12 — Gender invariant tests.

Spec rule: gender_confidence < GENDER_MEDIUM (0.60) → gender phải "unknown".
KHÔNG được set gender="male"/"female" với confidence=0.00.

4 spec tests:
  1. test_gender_conflict_unknown_applied_to_registry
  2. test_zero_confidence_cannot_be_male_or_female
  3. test_unknown_voice_fallback_does_not_mutate_gender
  4. test_two_voice_unknown_uses_default_but_gender_stays_unknown

Plus support:
  - test_high_confidence_male_kept_as_male
  - test_medium_threshold_boundary
  - test_gender_warnings_logged_to_project
  - test_cascade_reset_segment_speaker_gender

Chạy: PYTHONPATH=. python tests/test_gender_invariant_phase_12.py
"""
from __future__ import annotations

from app.services.voice_routing_svc import (
    enforce_gender_invariant,
    resolve_voice_by_character_id,
)


# ── Spec 1: gender_conflict decision=unknown applied to registry ─

def test_gender_conflict_unknown_applied_to_registry():
    """User's actual bug: CHAR_000 gender=male conf=0.00 dù
    gender_conflict.decision='unknown'. Invariant phải reset → unknown."""
    project = {
        "character_registry_summary": {
            "characters": [
                # Bug scenario: gender=male nhưng conf=0.00
                {"character_id": "CHAR_000", "gender": "male",
                 "gender_confidence": 0.00, "voice_profile_id": "nam_long_vu"},
                {"character_id": "CHAR_001", "gender": "unknown",
                 "gender_confidence": 0.00, "voice_profile_id": "nu_co_ba"},
            ],
        },
        "segments": [
            {"index": 0, "character_id": "CHAR_000", "speaker_gender": "male"},
            {"index": 1, "character_id": "CHAR_000", "speaker_gender": "male"},
        ],
    }
    warnings = enforce_gender_invariant(project)
    assert len(warnings) == 1
    assert warnings[0]["character_id"] == "CHAR_000"
    assert warnings[0]["issue"] == "gender_label_with_zero_confidence"
    assert warnings[0]["old_gender"] == "male"
    assert warnings[0]["fixed_gender"] == "unknown"
    # Registry summary updated
    char_000 = project["character_registry_summary"]["characters"][0]
    assert char_000["gender"] == "unknown"
    # Cascade: segments speaker_gender reset to None
    for s in project["segments"]:
        if s["character_id"] == "CHAR_000":
            assert s["speaker_gender"] is None
    # gender_warnings logged
    assert len(project.get("gender_warnings") or []) == 1
    print(f"✓ test_gender_conflict_unknown_applied_to_registry — "
          f"CHAR_000 reset, {len(warnings)} warning")


# ── Spec 2: zero confidence → cannot be male/female ──────────────

def test_zero_confidence_cannot_be_male_or_female():
    project = {
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_A", "gender": "male", "gender_confidence": 0.0},
                {"character_id": "CHAR_B", "gender": "female", "gender_confidence": 0.0},
                {"character_id": "CHAR_C", "gender": "unknown", "gender_confidence": 0.0},
            ],
        },
        "segments": [],
    }
    warnings = enforce_gender_invariant(project)
    assert len(warnings) == 2  # CHAR_A + CHAR_B reset, CHAR_C đã unknown OK
    chars = project["character_registry_summary"]["characters"]
    assert chars[0]["gender"] == "unknown"  # was male
    assert chars[1]["gender"] == "unknown"  # was female
    assert chars[2]["gender"] == "unknown"  # untouched
    print(f"✓ test_zero_confidence_cannot_be_male_or_female — 2 resets")


# ── Spec 3: unknown voice fallback không mutate gender ───────────

def test_unknown_voice_fallback_does_not_mutate_gender():
    """resolve_voice_by_character_id cho unknown gender char → fallback voice,
    nhưng KHÔNG được mutate registry char.gender."""
    project = {
        "voice_slots": ["nam_voice", "nu_voice"],
        "speaker_voice_map": {},
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_X", "gender": "unknown",
                 "gender_confidence": 0.0, "voice_profile_id": None},
            ],
        },
    }
    voice, reason = resolve_voice_by_character_id("CHAR_X", project)
    # Tier 4 default_slot_fallback → first slot (nam_voice)
    assert voice == "nam_voice"
    # CHAR_X gender PHẢI VẪN là "unknown" — voice resolve KHÔNG được mutate gender
    chars = project["character_registry_summary"]["characters"]
    assert chars[0]["gender"] == "unknown", \
        f"Voice resolve mutated gender! got {chars[0]['gender']}"
    assert chars[0]["gender_confidence"] == 0.0
    print(f"✓ test_unknown_voice_fallback_does_not_mutate_gender — "
          f"voice={voice}, gender preserved unknown")


# ── Spec 4: 2-voice unknown uses default but gender stays unknown ─

def test_two_voice_unknown_uses_default_but_gender_stays_unknown():
    project = {
        "voice_count": 2,
        "voice_slots": ["nam_long_vu", "nu_co_ba"],
        "voice_id": None,  # no fallback voice
        "speaker_voice_map": {"CHAR_001": "nu_co_ba"},  # only one mapped
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_001", "gender": "unknown",
                 "gender_confidence": 0.0},
            ],
        },
    }
    voice, reason = resolve_voice_by_character_id("CHAR_001", project)
    # Tier 1 hit since voice_map has CHAR_001
    assert voice == "nu_co_ba"
    # Registry CHAR_001.gender vẫn unknown
    chars = project["character_registry_summary"]["characters"]
    assert chars[0]["gender"] == "unknown"
    assert chars[0]["gender_confidence"] == 0.0
    print(f"✓ test_two_voice_unknown_uses_default_but_gender_stays_unknown — "
          f"voice={voice}, gender preserved")


# ── Support: high conf male kept ─────────────────────────────────

def test_high_confidence_male_kept_as_male():
    project = {
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_X", "gender": "male", "gender_confidence": 0.85},
            ],
        },
        "segments": [],
    }
    warnings = enforce_gender_invariant(project)
    assert len(warnings) == 0
    assert project["character_registry_summary"]["characters"][0]["gender"] == "male"
    print("✓ test_high_confidence_male_kept_as_male")


# ── Support: medium boundary ─────────────────────────────────────

def test_medium_threshold_boundary():
    """conf = 0.60 exactly → PASS (>=). conf = 0.59 → FAIL."""
    project = {
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_A", "gender": "male", "gender_confidence": 0.60},
                {"character_id": "CHAR_B", "gender": "male", "gender_confidence": 0.59},
            ],
        },
        "segments": [],
    }
    warnings = enforce_gender_invariant(project)
    assert len(warnings) == 1
    assert warnings[0]["character_id"] == "CHAR_B"
    assert project["character_registry_summary"]["characters"][0]["gender"] == "male"   # 0.60 OK
    assert project["character_registry_summary"]["characters"][1]["gender"] == "unknown"  # 0.59 reset
    print("✓ test_medium_threshold_boundary — 0.60 pass, 0.59 reset")


# ── Support: gender_warnings logged ──────────────────────────────

def test_gender_warnings_logged_to_project():
    project = {
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_X", "gender": "male", "gender_confidence": 0.0},
            ],
        },
        "segments": [],
    }
    enforce_gender_invariant(project)
    assert "gender_warnings" in project
    assert len(project["gender_warnings"]) == 1
    w = project["gender_warnings"][0]
    assert w["character_id"] == "CHAR_X"
    assert w["old_gender"] == "male"
    assert w["fixed_gender"] == "unknown"
    print("✓ test_gender_warnings_logged_to_project")


# ── Support: cascade segment speaker_gender reset ────────────────

def test_cascade_reset_segment_speaker_gender():
    project = {
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_X", "gender": "female", "gender_confidence": 0.0},
                {"character_id": "CHAR_Y", "gender": "male", "gender_confidence": 0.95},
            ],
        },
        "segments": [
            {"index": 0, "character_id": "CHAR_X", "speaker_gender": "female"},
            {"index": 1, "character_id": "CHAR_Y", "speaker_gender": "male"},
            {"index": 2, "character_id": "CHAR_X", "speaker_gender": "female"},
        ],
    }
    enforce_gender_invariant(project)
    # CHAR_X reset → seg 0 + 2 speaker_gender → None
    assert project["segments"][0]["speaker_gender"] is None
    assert project["segments"][2]["speaker_gender"] is None
    # CHAR_Y unchanged (high conf) → seg 1 untouched
    assert project["segments"][1]["speaker_gender"] == "male"
    print("✓ test_cascade_reset_segment_speaker_gender")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_gender_conflict_unknown_applied_to_registry,
        test_zero_confidence_cannot_be_male_or_female,
        test_unknown_voice_fallback_does_not_mutate_gender,
        test_two_voice_unknown_uses_default_but_gender_stays_unknown,
        test_high_confidence_male_kept_as_male,
        test_medium_threshold_boundary,
        test_gender_warnings_logged_to_project,
        test_cascade_reset_segment_speaker_gender,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except AssertionError as e:
            failed += 1
            print(f"✗ {t.__name__} FAILED: {e}")
        except Exception as e:
            failed += 1
            print(f"✗ {t.__name__} ERROR: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
    print()
    print(f"═══ {passed}/{len(tests)} passed, {failed} failed ═══")
    return failed == 0


if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)
