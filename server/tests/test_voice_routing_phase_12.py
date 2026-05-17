"""Phase 12 — STRICT character_id voice routing tests.

5 spec tests:
  1. test_same_character_same_voice
  2. test_tts_does_not_use_segment_gender
  3. test_missing_character_id_uses_fallback_and_logs
  4. test_missing_voice_profile_uses_fallback_and_logs
  5. test_voice_conflict_auto_resolved

Plus support tests:
  - test_resolve_tier_1_direct_hit
  - test_resolve_tier_2_missing_char
  - test_resolve_tier_3_gender_fallback_male/female
  - test_resolve_tier_4_default_slot
  - test_resolve_tier_5_no_voice
  - test_log_voice_fallback_writes_meta
  - test_validation_no_conflict_when_single_voice

Chạy: PYTHONPATH=. python tests/test_voice_routing_phase_12.py
"""
from __future__ import annotations

from app.services.voice_routing_svc import (
    log_voice_fallback,
    resolve_voice_by_character_id,
    validate_character_voice_consistency,
)


# ── Spec test 1: same character → same voice ─────────────────────

def test_same_character_same_voice():
    """CHAR_001 gồm SPEAKER_00 + SPEAKER_03. Segments từ cả hai raw speaker
    → tất cả phải dùng cùng voice_profile_id của CHAR_001."""
    project = {
        "voice_count": 2,
        "voice_slots": ["nam_voice", "nu_voice"],
        "speaker_voice_map": {
            "CHAR_001": "nu_voice",
        },
        "character_registry_summary": {
            "characters": [{
                "character_id": "CHAR_001",
                "source_speakers": ["SPEAKER_00", "SPEAKER_03"],
                "gender": "female",
                "voice_profile_id": "nu_voice",
            }],
        },
    }
    # Segments từ cả 2 raw speaker, cùng character_id
    segments = [
        {"index": 0, "character_id": "CHAR_001", "speaker": "SPEAKER_00",
         "speaker_gender": "male"},  # ← gender WRONG cho test 2
        {"index": 1, "character_id": "CHAR_001", "speaker": "SPEAKER_03",
         "speaker_gender": "unknown"},
        {"index": 2, "character_id": "CHAR_001", "speaker": "SPEAKER_00",
         "speaker_gender": "female"},
    ]
    voices = []
    for s in segments:
        v, _ = resolve_voice_by_character_id(s.get("character_id"), project)
        voices.append(v)

    assert all(v == "nu_voice" for v in voices), \
        f"Expected all 'nu_voice', got {voices}"
    assert len(set(voices)) == 1, "Same character must use single voice"
    print(f"✓ test_same_character_same_voice — all 3 segs → {voices[0]}")


# ── Spec test 2: TTS ignore segment.speaker_gender ───────────────

def test_tts_does_not_use_segment_gender():
    """segment.speaker_gender = male nhưng registry.CHAR_001.gender = female.
    TTS phải dùng female_voice_01."""
    project = {
        "voice_slots": ["nam_voice", "female_voice_01"],
        "speaker_voice_map": {"CHAR_001": "female_voice_01"},
        "character_registry_summary": {
            "characters": [{
                "character_id": "CHAR_001",
                "gender": "female",
                "voice_profile_id": "female_voice_01",
            }],
        },
    }
    seg = {
        "index": 0,
        "character_id": "CHAR_001",
        "speaker_gender": "male",  # ← wrong/stale per-segment
    }
    v, fallback_reason = resolve_voice_by_character_id(seg["character_id"], project)
    assert v == "female_voice_01", \
        f"Expected female_voice_01 (registry source), got {v}"
    assert fallback_reason is None  # direct hit, no fallback
    print(f"✓ test_tts_does_not_use_segment_gender — {v}")


# ── Spec test 3: missing character_id → fallback + log ───────────

def test_missing_character_id_uses_fallback_and_logs():
    """Segment thiếu character_id → fallback voice + log uncertain."""
    project = {
        "voice_slots": ["nam_voice", "nu_voice"],
        "speaker_voice_map": {},
        "character_registry_summary": {"characters": []},
    }
    seg = {"index": 5, "character_id": None, "speaker": "SPEAKER_XX"}

    v, fallback_reason = resolve_voice_by_character_id(seg.get("character_id"), project)
    assert v == "nam_voice"  # first non-empty slot
    assert fallback_reason == "missing_character_id"

    log_voice_fallback(project, seg, None, v, fallback_reason)
    warnings = project.get("voice_warnings") or []
    uncert = project.get("uncertain_segments_no_char") or []
    assert len(warnings) == 1
    assert warnings[0]["segment_id"] == 5
    assert warnings[0]["issue"] == "missing_character_id"
    assert 5 in uncert
    print(f"✓ test_missing_character_id_uses_fallback_and_logs — "
          f"voice={v} warnings={len(warnings)}")


# ── Spec test 4: voice_profile_id null → gender fallback + log ───

def test_missing_voice_profile_uses_fallback_and_logs():
    """Character có gender nhưng voice_profile_id null (voice_map missing
    entry) → gender-aware fallback + log warning."""
    project = {
        "voice_slots": ["nam_voice", "nu_voice"],
        "speaker_voice_map": {},  # ← CHAR_001 KHÔNG có trong map
        "character_registry_summary": {
            "characters": [{
                "character_id": "CHAR_001",
                "gender": "female",
                "voice_profile_id": None,
            }],
        },
    }
    seg = {"index": 10, "character_id": "CHAR_001"}

    v, fallback_reason = resolve_voice_by_character_id(seg["character_id"], project)
    assert v == "nu_voice", \
        f"Expected gender-match nu_voice for female char, got {v}"
    assert fallback_reason == "voice_profile_null_gender_female_fallback"

    log_voice_fallback(project, seg, seg["character_id"], v, fallback_reason)
    warnings = project.get("voice_warnings") or []
    assert len(warnings) == 1
    assert warnings[0]["character_id"] == "CHAR_001"
    assert "gender_female" in warnings[0]["issue"]
    print(f"✓ test_missing_voice_profile_uses_fallback_and_logs — "
          f"voice={v} reason={fallback_reason}")


# ── Spec test 5: voice conflict auto-resolved ────────────────────

def test_voice_conflict_auto_resolved():
    """CHAR_001 bị gán 2 voice trước validation. Validation phải resolve
    về expected voice (từ voice_map) + log voice_conflicts."""
    project = {
        "voice_slots": ["nam_voice", "nu_voice"],
        "speaker_voice_map": {"CHAR_001": "nu_voice"},  # expected
        "character_registry_summary": {
            "characters": [{
                "character_id": "CHAR_001",
                "gender": "female",
                "voice_profile_id": "nu_voice",
            }],
        },
        "segments": [
            {"index": 0, "character_id": "CHAR_001",
             "voice_id": "nu_voice"},
            {"index": 1, "character_id": "CHAR_001",
             "voice_id": "nam_voice"},  # ← WRONG voice (user override sai)
            {"index": 2, "character_id": "CHAR_001",
             "voice_id": "nu_voice"},
        ],
    }
    conflicts = validate_character_voice_consistency(project)
    assert len(conflicts) == 1
    c = conflicts[0]
    assert c["character_id"] == "CHAR_001"
    assert set(c["voices_found"]) == {"nu_voice", "nam_voice"}
    assert c["resolved_to"] == "nu_voice"  # expected from registry

    # All segments rewritten to expected
    for s in project["segments"]:
        assert s["voice_id"] == "nu_voice", \
            f"seg[{s['index']}] voice_id={s['voice_id']} not resolved"

    # Conflict logged into project meta
    assert len(project["voice_conflicts"]) == 1
    print(f"✓ test_voice_conflict_auto_resolved — "
          f"resolved {len(conflicts)} char to {c['resolved_to']}")


# ── Support: resolver tiers ──────────────────────────────────────

def test_resolve_tier_1_direct_hit():
    project = {"speaker_voice_map": {"CHAR_000": "v_a"}}
    v, fb = resolve_voice_by_character_id("CHAR_000", project)
    assert v == "v_a" and fb is None
    print("✓ test_resolve_tier_1_direct_hit")


def test_resolve_tier_2_missing_char():
    project = {"voice_slots": ["v_a", "v_b"], "speaker_voice_map": {}}
    v, fb = resolve_voice_by_character_id(None, project)
    assert v == "v_a" and fb == "missing_character_id"
    print("✓ test_resolve_tier_2_missing_char")


def test_resolve_tier_3_gender_male():
    project = {
        "voice_slots": ["nam_v", "nu_v"],
        "speaker_voice_map": {},
        "character_registry_summary": {
            "characters": [{"character_id": "CHAR_X", "gender": "male"}],
        },
    }
    v, fb = resolve_voice_by_character_id("CHAR_X", project)
    assert v == "nam_v" and "male" in fb
    print(f"✓ test_resolve_tier_3_gender_male — {v}")


def test_resolve_tier_3_gender_female():
    project = {
        "voice_slots": ["nam_v", "nu_v"],
        "speaker_voice_map": {},
        "character_registry_summary": {
            "characters": [{"character_id": "CHAR_X", "gender": "female"}],
        },
    }
    v, fb = resolve_voice_by_character_id("CHAR_X", project)
    assert v == "nu_v" and "female" in fb
    print(f"✓ test_resolve_tier_3_gender_female — {v}")


def test_resolve_tier_4_default_slot():
    """character có gender unknown → tier 4 fallback first slot."""
    project = {
        "voice_slots": ["only_v"],
        "speaker_voice_map": {},
        "character_registry_summary": {
            "characters": [{"character_id": "CHAR_X", "gender": "unknown"}],
        },
    }
    v, fb = resolve_voice_by_character_id("CHAR_X", project)
    assert v == "only_v" and "default_slot" in fb
    print(f"✓ test_resolve_tier_4_default_slot — {v}")


def test_resolve_tier_5_no_voice():
    project = {"voice_slots": [], "speaker_voice_map": {}}
    v, fb = resolve_voice_by_character_id("CHAR_X", project)
    assert v is None and "no_voice" in fb
    print("✓ test_resolve_tier_5_no_voice")


def test_log_voice_fallback_writes_meta():
    project: dict = {}
    seg = {"index": 7, "id": "abc123"}
    log_voice_fallback(project, seg, "CHAR_009", "fallback_v", "test_reason")
    assert "voice_warnings" in project
    assert project["voice_warnings"][0]["segment_id"] == 7
    assert project["voice_warnings"][0]["character_id"] == "CHAR_009"
    assert project["voice_warnings"][0]["fallback_used"] == "fallback_v"
    # Char_id set → KHÔNG add vào uncertain_segments
    assert "uncertain_segments_no_char" not in project
    print("✓ test_log_voice_fallback_writes_meta")


def test_validation_no_conflict_when_single_voice():
    project = {
        "voice_slots": ["nam_v", "nu_v"],
        "speaker_voice_map": {"CHAR_X": "nu_v"},
        "character_registry_summary": {"characters": []},
        "segments": [
            {"index": 0, "character_id": "CHAR_X", "voice_id": "nu_v"},
            {"index": 1, "character_id": "CHAR_X", "voice_id": "nu_v"},
        ],
    }
    conflicts = validate_character_voice_consistency(project)
    assert len(conflicts) == 0
    print("✓ test_validation_no_conflict_when_single_voice")


def test_validation_no_expected_uses_alphabetical():
    """Nếu voice_map không có expected → fallback alphabetical first."""
    project = {
        "voice_slots": ["x", "y"],
        "speaker_voice_map": {},  # no expected for CHAR_X
        "character_registry_summary": {"characters": []},
        "segments": [
            {"index": 0, "character_id": "CHAR_X", "voice_id": "z_voice"},
            {"index": 1, "character_id": "CHAR_X", "voice_id": "a_voice"},
        ],
    }
    conflicts = validate_character_voice_consistency(project)
    assert len(conflicts) == 1
    assert conflicts[0]["resolved_to"] == "a_voice"  # alphabetical
    # All segs rewritten
    for s in project["segments"]:
        assert s["voice_id"] == "a_voice"
    print("✓ test_validation_no_expected_uses_alphabetical")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        # 5 spec tests
        test_same_character_same_voice,
        test_tts_does_not_use_segment_gender,
        test_missing_character_id_uses_fallback_and_logs,
        test_missing_voice_profile_uses_fallback_and_logs,
        test_voice_conflict_auto_resolved,
        # Resolver tier coverage
        test_resolve_tier_1_direct_hit,
        test_resolve_tier_2_missing_char,
        test_resolve_tier_3_gender_male,
        test_resolve_tier_3_gender_female,
        test_resolve_tier_4_default_slot,
        test_resolve_tier_5_no_voice,
        # Log helper + validation edge
        test_log_voice_fallback_writes_meta,
        test_validation_no_conflict_when_single_voice,
        test_validation_no_expected_uses_alphabetical,
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
