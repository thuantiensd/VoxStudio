"""Unit tests for voice_mapping Phase 8 refactor.

Coverage per spec:
  Mode 1 (1_voice):
    test_mode_1_all_same_voice

  Mode 2 (2_voice):
    test_mode_2_male_female_split
    test_mode_2_unknown_with_fallback
    test_mode_2_unknown_no_fallback_majority_male
    test_mode_2_unknown_no_fallback_majority_female
    test_mode_2_unknown_no_fallback_tie

  Mode 3+ (multi_voice):
    test_mode_multi_top_by_line_count
    test_mode_multi_tie_breaker_duration
    test_mode_multi_tie_breaker_id
    test_mode_multi_unknown_fallback

  MIN-1 (configurable VoiceSlot, no hardcode position):
    test_custom_voice_slots_order

  Integration:
    test_voice_map_warnings_logged
    test_apply_to_profiles_mutates_voice_profile_id
    test_apply_to_profiles_false_dry_run

  Risk mitigation tests (Phase 8 spec warnings):
    test_risk_1_tie_breaker_deterministic (top 3 stable across runs)
    test_risk_2_majority_by_char_count_not_line_count
    test_risk_3_fallback_priority_explicit_over_majority

Chạy: PYTHONPATH=. python tests/test_voice_mapping_phase_8.py
"""
from __future__ import annotations

from app.models.character_schemas import CharacterProfile
from app.services.speaker_pipeline.voice_mapping import (
    DEFAULT_VOICE_SLOTS_2VOICE,
    VoiceSlot,
    build_character_voice_map,
    build_speaker_voice_map,  # legacy wrapper
)


# ── Helpers ──────────────────────────────────────────────────────

def _make_chars(specs: list[tuple[str, str, int, float]]) -> dict[str, CharacterProfile]:
    """specs = [(char_id, gender, line_count, total_duration), ...]"""
    return {
        cid: CharacterProfile(
            character_id=cid,
            source_speakers=[f"SPEAKER_{i:02d}"],
            gender=g,  # type: ignore[arg-type]
            gender_confidence=0.85 if g in ("male", "female") else 0.0,
            line_count=lc,
            total_duration=td,
        )
        for i, (cid, g, lc, td) in enumerate(specs)
    }


def _slots(*entries: tuple[str, str]) -> list[VoiceSlot]:
    """entries = (voice_id, gender)"""
    return [VoiceSlot(voice_id=v, gender=g) for v, g in entries]


# ── Mode 1 (1_voice) ─────────────────────────────────────────────

def test_mode_1_all_same_voice():
    chars = _make_chars([
        ("CHAR_000", "male", 100, 200.0),
        ("CHAR_001", "female", 50, 100.0),
        ("CHAR_002", "unknown", 30, 60.0),
        ("CHAR_003", "male", 20, 40.0),
        ("CHAR_004", "female", 10, 20.0),
    ])
    slots = _slots(("voice_solo", "any"))
    vm, warnings = build_character_voice_map(chars, slots, mode="1_voice")
    assert all(v == "voice_solo" for v in vm.values())
    assert len(vm) == 5
    assert len(warnings) == 0
    print(f"✓ test_mode_1_all_same_voice — 5 chars → 'voice_solo', no warnings")


# ── Mode 2 (2_voice) ─────────────────────────────────────────────

def test_mode_2_male_female_split():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "female", 50, 100.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(chars, slots, mode="2_voice")
    assert vm["CHAR_000"] == "v_male"
    assert vm["CHAR_001"] == "v_female"
    assert len(warnings) == 0
    print("✓ test_mode_2_male_female_split — clean split, 0 warnings")


def test_mode_2_unknown_with_fallback():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "unknown", 30, 60.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(
        chars, slots, mode="2_voice", fallback_voice_id="v_neutral",
    )
    assert vm["CHAR_000"] == "v_male"
    assert vm["CHAR_001"] == "v_neutral"
    unk_warn = [w for w in warnings if w.character_id == "CHAR_001"][0]
    assert unk_warn.issue == "unknown_gender_fallback_applied"
    assert unk_warn.decided_voice == "v_neutral"
    print(f"✓ test_mode_2_unknown_with_fallback — warning issue={unk_warn.issue}")


def test_mode_2_unknown_no_fallback_majority_male():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "male", 40, 80.0),
        ("CHAR_002", "male", 30, 60.0),
        ("CHAR_003", "unknown", 20, 40.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(chars, slots, mode="2_voice")
    # 3 male + 1 unknown → majority = male → unknown gets male voice
    assert vm["CHAR_003"] == "v_male"
    unk_warn = [w for w in warnings if w.character_id == "CHAR_003"][0]
    assert unk_warn.issue == "majority_rule_applied"
    assert "male" in unk_warn.reason.lower()
    print(f"✓ test_mode_2_unknown_no_fallback_majority_male — got {vm['CHAR_003']}")


def test_mode_2_unknown_no_fallback_majority_female():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "female", 40, 80.0),
        ("CHAR_002", "female", 30, 60.0),
        ("CHAR_003", "unknown", 20, 40.0),
        ("CHAR_004", "unknown", 10, 20.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(chars, slots, mode="2_voice")
    # 1 male + 2 female + 2 unknown → majority = female (by char count)
    assert vm["CHAR_003"] == "v_female"
    assert vm["CHAR_004"] == "v_female"
    print(f"✓ test_mode_2_unknown_no_fallback_majority_female — "
          f"unknowns → {vm['CHAR_003']}")


def test_mode_2_unknown_no_fallback_tie():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "male", 40, 80.0),
        ("CHAR_002", "female", 30, 60.0),
        ("CHAR_003", "female", 20, 40.0),
        ("CHAR_004", "unknown", 10, 20.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(chars, slots, mode="2_voice")
    # Tie 2-2 → alphabetical: "female" < "male" → female wins
    assert vm["CHAR_004"] == "v_female"
    unk_warn = [w for w in warnings if w.character_id == "CHAR_004"][0]
    assert unk_warn.issue == "majority_rule_applied"
    print(f"✓ test_mode_2_unknown_no_fallback_tie — alphabetical female wins")


# ── Mode multi_voice ─────────────────────────────────────────────

def test_mode_multi_top_by_line_count():
    chars = _make_chars([
        ("CHAR_000", "male", 100, 200.0),
        ("CHAR_001", "female", 80, 160.0),
        ("CHAR_002", "male", 50, 100.0),
        ("CHAR_003", "female", 20, 40.0),  # rank 4 → fallback
    ])
    slots = _slots(
        ("v_male_1", "male"),
        ("v_female_1", "female"),
        ("v_male_2", "male"),
    )
    vm, warnings = build_character_voice_map(chars, slots, mode="multi_voice")
    # Top 3 by line_count: CHAR_000 (M, 100), CHAR_001 (F, 80), CHAR_002 (M, 50)
    assert vm["CHAR_000"] == "v_male_1"      # 1st male slot
    assert vm["CHAR_001"] == "v_female_1"
    assert vm["CHAR_002"] == "v_male_2"      # 2nd male slot (1st reserved)
    # Rank 4 (CHAR_003 female) → fallback non-reserve → v_female_1 reused
    assert vm["CHAR_003"] == "v_female_1"
    print(f"✓ test_mode_multi_top_by_line_count — top 3 individual voice, "
          f"4th reuse: {vm}")


def test_mode_multi_tie_breaker_duration():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "female", 50, 80.0),   # same line_count, lower duration
        ("CHAR_002", "male", 50, 120.0),   # same line_count, HIGHER duration
    ])
    slots = _slots(("v_a", "any"), ("v_b", "any"))
    vm, warnings = build_character_voice_map(chars, slots, mode="multi_voice")
    # Tie-breaker by total_duration desc: CHAR_002 (120) > CHAR_000 (100) > CHAR_001 (80)
    # Top 2: CHAR_002, CHAR_000 → first 2 "any" slots
    # Both chars match "any" → first slot to top (CHAR_002), second to CHAR_000
    assert vm["CHAR_002"] == "v_a"
    assert vm["CHAR_000"] == "v_b"
    # CHAR_001 rank 3 → fallback (any slot, reuse first)
    assert vm["CHAR_001"] in ("v_a", "v_b")
    print(f"✓ test_mode_multi_tie_breaker_duration — sorted by duration: "
          f"CHAR_002 first → {vm}")


def test_mode_multi_tie_breaker_id():
    chars = _make_chars([
        ("CHAR_002", "male", 50, 100.0),
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "male", 50, 100.0),
    ])
    slots = _slots(("v_a", "male"), ("v_b", "male"), ("v_c", "male"))
    vm, warnings = build_character_voice_map(chars, slots, mode="multi_voice")
    # Same line_count + same duration → alphabetical:
    # CHAR_000 → v_a, CHAR_001 → v_b, CHAR_002 → v_c
    assert vm["CHAR_000"] == "v_a"
    assert vm["CHAR_001"] == "v_b"
    assert vm["CHAR_002"] == "v_c"
    print(f"✓ test_mode_multi_tie_breaker_id — alphabetical: {vm}")


def test_mode_multi_unknown_fallback():
    chars = _make_chars([
        ("CHAR_000", "unknown", 100, 200.0),  # top by line_count, unknown
        ("CHAR_001", "male", 50, 100.0),
        ("CHAR_002", "female", 30, 60.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(
        chars, slots, mode="multi_voice", fallback_voice_id="v_neutral",
    )
    # CHAR_000 unknown → fallback applied
    assert vm["CHAR_000"] == "v_neutral"
    assert vm["CHAR_001"] == "v_male"
    assert vm["CHAR_002"] == "v_female"
    unk_warn = [w for w in warnings if w.character_id == "CHAR_000"][0]
    assert unk_warn.issue == "unknown_gender_fallback_applied"
    print(f"✓ test_mode_multi_unknown_fallback — CHAR_000 → fallback "
          f"despite being top")


# ── MIN-1: VoiceSlot configurable ────────────────────────────────

def test_custom_voice_slots_order():
    """User config 3 slots theo thứ tự [female, male, any] — KHÔNG hardcode
    'slot 0 = male'."""
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "female", 40, 80.0),
        ("CHAR_002", "unknown", 30, 60.0),
    ])
    slots = _slots(
        ("v_first", "female"),    # vị trí 0 LÀ FEMALE, không phải male
        ("v_second", "male"),
        ("v_third", "any"),
    )
    vm, warnings = build_character_voice_map(chars, slots, mode="multi_voice")
    # CHAR_000 male → v_second (slot index 1, NOT index 0)
    # CHAR_001 female → v_first (slot index 0 — correctly matched by gender)
    assert vm["CHAR_000"] == "v_second"
    assert vm["CHAR_001"] == "v_first"
    # CHAR_002 unknown → no fallback, no majority (tie 1-1) → first "any" = v_third
    assert vm["CHAR_002"] == "v_third"
    print(f"✓ test_custom_voice_slots_order — NO hardcode, logic uses "
          f"VoiceSlot.gender: {vm}")


# ── Integration ──────────────────────────────────────────────────

def test_voice_map_warnings_logged():
    chars = _make_chars([
        ("CHAR_000", "unknown", 50, 100.0),
        ("CHAR_001", "male", 40, 80.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(chars, slots, mode="2_voice")
    assert len(warnings) >= 1
    w = warnings[0]
    assert w.character_id == "CHAR_000"
    assert w.decided_voice in ("v_male", "v_female")
    assert w.reason
    # Verify JSON serialization
    js = w.model_dump_json()
    assert "character_id" in js
    print(f"✓ test_voice_map_warnings_logged — schema valid, JSON: {js[:80]}...")


def test_apply_to_profiles_mutates_voice_profile_id():
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "female", 40, 80.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, _ = build_character_voice_map(
        chars, slots, mode="2_voice", apply_to_profiles=True,
    )
    assert chars["CHAR_000"].voice_profile_id == "v_male"
    assert chars["CHAR_001"].voice_profile_id == "v_female"
    print("✓ test_apply_to_profiles_mutates_voice_profile_id")


def test_apply_to_profiles_false_dry_run():
    chars = _make_chars([("CHAR_000", "male", 50, 100.0)])
    slots = _slots(("v_male", "male"))
    vm, _ = build_character_voice_map(
        chars, slots, mode="2_voice", apply_to_profiles=False,
    )
    assert vm["CHAR_000"] == "v_male"
    assert chars["CHAR_000"].voice_profile_id is None  # NOT mutated
    print("✓ test_apply_to_profiles_false_dry_run")


# ── Risk mitigation tests ────────────────────────────────────────

def test_risk_1_tie_breaker_deterministic():
    """Phase 8 risk #1: tie-breaker phải deterministic. Run 5 lần, top 3
    phải luôn cùng order — không random."""
    chars = _make_chars([
        ("CHAR_A", "male", 50, 100.0),
        ("CHAR_B", "male", 50, 100.0),  # tie với A trên line + duration
        ("CHAR_C", "male", 50, 100.0),  # tie với A, B
        ("CHAR_D", "male", 30, 60.0),
    ])
    slots = _slots(("v_1", "male"), ("v_2", "male"), ("v_3", "male"))

    results = []
    for _ in range(5):
        # Re-make chars each run (avoid mutation carryover)
        chars_run = _make_chars([
            ("CHAR_A", "male", 50, 100.0),
            ("CHAR_B", "male", 50, 100.0),
            ("CHAR_C", "male", 50, 100.0),
            ("CHAR_D", "male", 30, 60.0),
        ])
        vm, _ = build_character_voice_map(chars_run, slots, mode="multi_voice")
        results.append(tuple(sorted(vm.items())))

    # All 5 runs must produce identical output
    assert all(r == results[0] for r in results), \
        f"Non-deterministic! {results}"
    # Verify alphabetical tie-breaker: CHAR_A → v_1, CHAR_B → v_2, CHAR_C → v_3
    final = dict(results[0])
    assert final["CHAR_A"] == "v_1"
    assert final["CHAR_B"] == "v_2"
    assert final["CHAR_C"] == "v_3"
    print("✓ test_risk_1_tie_breaker_deterministic — 5 runs identical")


def test_risk_2_majority_by_char_count_not_line_count():
    """Phase 8 risk #2: majority counted by CHARACTER count, không line_count.
    Case: 1 char male nói siêu nhiều (1000 lines) + 3 char female nói ít
    (5 lines mỗi).
    Char count: 3 female > 1 male → majority = female.
    Line count: 1 male = 1000 > 3 female * 5 = 15 → nếu sai sẽ là male.
    """
    chars = _make_chars([
        ("CHAR_000", "male", 1000, 2000.0),  # nói cực nhiều
        ("CHAR_001", "female", 5, 10.0),
        ("CHAR_002", "female", 5, 10.0),
        ("CHAR_003", "female", 5, 10.0),
        ("CHAR_004", "unknown", 50, 100.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, _ = build_character_voice_map(chars, slots, mode="2_voice")
    # If counted by char: majority = female (3 vs 1) → unknown gets female voice
    # If counted by line_count BUG: majority = male (1000 > 15) → unknown gets male
    assert vm["CHAR_004"] == "v_female", \
        f"BUG: majority should be female by char count, got {vm['CHAR_004']}"
    print(f"✓ test_risk_2_majority_by_char_count_not_line_count — "
          f"female wins (3 chars > 1)")


def test_phase_12_multi_voice_2_unknown_chars_distinct_voices():
    """Phase 12 fix: voice_count=2 + 2 chars unknown gender + 2 slots gendered.
    Expected: 2 chars → 2 distinct voices (NOT collapse vào cùng slot[0])."""
    chars = _make_chars([
        ("CHAR_000", "unknown", 50, 100.0),
        ("CHAR_001", "unknown", 40, 80.0),
    ])
    slots = _slots(("nam_long_vu", "male"), ("nu_co_ba", "female"))
    vm, warnings = build_character_voice_map(
        chars, slots, mode="multi_voice",  # voice_count=2 → multi_voice
    )
    # Both chars should get DIFFERENT voices (slot reservation)
    voices_assigned = set(vm.values())
    assert len(voices_assigned) == 2, \
        f"Phase 12 fix: 2 chars phải có 2 voices, got {vm}"
    assert vm["CHAR_000"] != vm["CHAR_001"]
    print(f"✓ test_phase_12_multi_voice_2_unknown_chars_distinct_voices — {vm}")


def test_risk_3_fallback_priority_explicit_over_majority():
    """Phase 8 risk #3: fallback_voice_id PHẢI ƯU TIÊN CAO HƠN majority.
    Case: provide fallback + majority cũng có → fallback thắng."""
    chars = _make_chars([
        ("CHAR_000", "male", 50, 100.0),
        ("CHAR_001", "male", 50, 100.0),
        ("CHAR_002", "unknown", 30, 60.0),
    ])
    slots = _slots(("v_male", "male"), ("v_female", "female"))
    vm, warnings = build_character_voice_map(
        chars, slots, mode="2_voice",
        fallback_voice_id="v_explicit_fallback",  # MUST WIN over majority male
    )
    assert vm["CHAR_002"] == "v_explicit_fallback", \
        f"BUG: fallback should win over majority, got {vm['CHAR_002']}"
    unk_warn = [w for w in warnings if w.character_id == "CHAR_002"][0]
    assert unk_warn.issue == "unknown_gender_fallback_applied"
    print(f"✓ test_risk_3_fallback_priority_explicit_over_majority — "
          f"v_explicit_fallback wins")


# ── Legacy wrapper compat ────────────────────────────────────────

def test_legacy_build_speaker_voice_map_still_works():
    """build_speaker_voice_map legacy (string voice_slots, raw speaker IDs)
    must still work for face-only path Phase 7b backward compat."""
    vm = build_speaker_voice_map(
        speakers=["SPEAKER_00", "SPEAKER_01"],
        voice_slots=["v_male", "v_female"],
        speaker_genders={"SPEAKER_00": "male", "SPEAKER_01": "female"},
        gender_confidences={"SPEAKER_00": 0.85, "SPEAKER_01": 0.85},
    )
    assert vm["SPEAKER_00"] == "v_male"
    assert vm["SPEAKER_01"] == "v_female"
    print("✓ test_legacy_build_speaker_voice_map_still_works — wrapper OK")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_mode_1_all_same_voice,
        test_mode_2_male_female_split,
        test_mode_2_unknown_with_fallback,
        test_mode_2_unknown_no_fallback_majority_male,
        test_mode_2_unknown_no_fallback_majority_female,
        test_mode_2_unknown_no_fallback_tie,
        test_mode_multi_top_by_line_count,
        test_mode_multi_tie_breaker_duration,
        test_mode_multi_tie_breaker_id,
        test_mode_multi_unknown_fallback,
        test_custom_voice_slots_order,
        test_voice_map_warnings_logged,
        test_apply_to_profiles_mutates_voice_profile_id,
        test_apply_to_profiles_false_dry_run,
        test_risk_1_tie_breaker_deterministic,
        test_risk_2_majority_by_char_count_not_line_count,
        test_risk_3_fallback_priority_explicit_over_majority,
        test_phase_12_multi_voice_2_unknown_chars_distinct_voices,
        test_legacy_build_speaker_voice_map_still_works,
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
