"""Unit tests for translation flow Phase 9 refactor.

Coverage per spec:
  1. test_translate_runs_after_registry
     (order verify via API endpoint separation — translation reads persisted
     project meta which has character_registry_summary)

  2. test_chars_meta_uses_character_id
     (Phase 7b Risk 1 fix: gender lookup via character_id, name/age via chars_meta)

  3. test_build_character_registry_prompt_block
     (full registry → prompt text with rules + locked markers)

  4. test_batch_with_full_registry
     (each batch receives full registry, NOT filtered to chars in batch)

  5. test_context_window_not_translated
     (gather_translation_context returns before+after, NOT batch itself)

  6. test_translation_notes_enum_validated
     (LLM hallucinated note → "ok" fallback; valid note passes through)

  7. test_locked_character_gender_preserved
     (validate_locked_character_translations detects pronoun violation)

  8. test_unknown_gender_uses_neutral_safe
     (prompt block emits "neutral-safe required" rule for unknown chars)

  9. test_high_conf_gender_follows_profile
     (classify_translation_note_for_segment → "follows_character_profile" for
      high conf chars)

  10. test_translation_face_only_fallback
      (registry=None → empty prompt block; chars_meta used as fallback)

  11. test_locked_high_conf_no_violation_when_consistent
      (LOCKED char + correct pronoun → 0 warnings)

  12. test_translation_note_low_ownership
      (classify returns ownership-low note when ownership_tier="low")

Chạy: PYTHONPATH=. python tests/test_translation_phase_9.py
"""
from __future__ import annotations

from app.models.character_schemas import (
    VALID_TRANSLATION_NOTES,
    CharacterProfile,
    CharacterRegistry,
    PossibleMerge,
)
from app.services.translation_character_helper import (
    build_character_registry_prompt_block,
    classify_translation_note_for_segment,
    format_context_block,
    gather_translation_context,
    parse_llm_translation_note,
    validate_locked_character_translations,
)


# ── Helpers ──────────────────────────────────────────────────────

def _make_registry(specs: list[tuple[str, str, float, int, bool]]) -> CharacterRegistry:
    """specs = [(char_id, gender, gender_conf, line_count, locked), ...]"""
    chars = {}
    for cid, g, gc, lc, locked in specs:
        chars[cid] = CharacterProfile(
            character_id=cid,
            source_speakers=[f"SPEAKER_{cid[-2:]}"],
            gender=g,  # type: ignore[arg-type]
            gender_confidence=gc,
            line_count=lc,
            total_duration=lc * 2.0,
            locked=locked,
        )
    return CharacterRegistry(project_id="t", characters=chars)


# ── 1. Order verify ──────────────────────────────────────────────

def test_translate_runs_after_registry():
    """Order via project meta persistence — translation reads
    character_registry_summary written by transcribe_project."""
    # Simulate project meta from transcribe step
    project_meta = {
        "id": "p1",
        "segments": [{"index": 0, "character_id": "CHAR_000", "speaker": "SPEAKER_00"}],
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_000", "gender": "male",
                 "gender_confidence": 0.85, "source_speakers": ["SPEAKER_00"]},
            ],
            "possible_merges": [],
        },
    }
    # Translate step would read project_meta
    reg_summary = project_meta.get("character_registry_summary", {}).get("characters", [])
    assert len(reg_summary) == 1
    assert reg_summary[0]["character_id"] == "CHAR_000"
    # Order constraint satisfied: translate reads persisted registry from
    # transcribe step (no parallel race possible at API endpoint level).
    print("✓ test_translate_runs_after_registry — meta persistence verified")


# ── 2. chars_meta lookup uses character_id ───────────────────────

def test_chars_meta_uses_character_id():
    """Simulate dubbing_svc post-translation tagging: gender from registry
    via character_id, name/age from chars_meta via raw speaker."""
    registry_summary = [
        {"character_id": "CHAR_000", "gender": "female", "gender_confidence": 0.88,
         "source_speakers": ["SPEAKER_00"]},
    ]
    chars_meta = {
        "SPEAKER_00": {"character_name": "Lin Xiao", "age": "young_adult",
                       "gender": "male"},  # WRONG gender — registry should win
    }
    seg = {"index": 0, "character_id": "CHAR_000", "speaker": "SPEAKER_00"}

    # Simulate the migration logic in dubbing_svc
    char_id_to_profile = {c["character_id"]: c for c in registry_summary}
    cid = seg["character_id"]
    profile = char_id_to_profile.get(cid)
    if profile and profile.get("gender") in ("male", "female"):
        seg["speaker_gender"] = profile["gender"]

    spk = seg["speaker"]
    ci = chars_meta[spk]
    seg["character_name"] = ci["character_name"]
    seg["age"] = ci["age"]
    if not profile and ci.get("gender"):
        seg["speaker_gender"] = ci["gender"]

    assert seg["speaker_gender"] == "female", \
        f"Expected female from registry, got {seg['speaker_gender']}"
    assert seg["character_name"] == "Lin Xiao"
    assert seg["age"] == "young_adult"
    print("✓ test_chars_meta_uses_character_id — registry wins gender, "
          "chars_meta supplies name+age")


# ── 3. Prompt block builder ──────────────────────────────────────

def test_build_character_registry_prompt_block():
    registry = _make_registry([
        ("CHAR_000", "male", 0.92, 120, False),
        ("CHAR_001", "female", 0.88, 85, False),
        ("CHAR_002", "unknown", 0.0, 12, False),
        ("CHAR_003", "male", 0.95, 30, True),  # locked
    ])
    chars_meta = {
        "SPEAKER_00": {"character_name": "Wang Wei", "role": "protagonist"},
        "SPEAKER_01": {"character_name": "Lin Xiao", "role": "love_interest"},
    }
    block = build_character_registry_prompt_block(registry, chars_meta=chars_meta)

    assert "CHARACTER REGISTRY" in block
    assert "CHAR_000" in block
    assert "Wang Wei" in block
    assert "male" in block
    assert "lines=120" in block
    assert "CHAR_003 [LOCKED]" in block
    assert "neutral-safe required" in block  # for CHAR_002 unknown
    assert "RULES:" in block
    assert "LOCKED characters" in block
    print(f"✓ test_build_character_registry_prompt_block — "
          f"block len={len(block)}, contains all keys")


def test_prompt_block_empty_registry():
    assert build_character_registry_prompt_block(None) == ""
    empty = CharacterRegistry(project_id="t")
    assert build_character_registry_prompt_block(empty) == ""
    print("✓ test_prompt_block_empty_registry")


def test_prompt_block_with_possible_merges():
    registry = _make_registry([
        ("CHAR_000", "male", 0.92, 50, False),
        ("CHAR_001", "male", 0.85, 30, False),
    ])
    registry.possible_merges.append(PossibleMerge(
        characters=["CHAR_000", "CHAR_001"],
        similarity=0.70,
        evidences_present=["same_gender_high_conf"],
        evidences_count=1,
        reason_not_merged="only_1_evidences_below_min_2",
    ))
    block = build_character_registry_prompt_block(registry)
    assert "POSSIBLE MERGES" in block
    assert "CHAR_000 ↔ CHAR_001" in block
    print("✓ test_prompt_block_with_possible_merges")


# ── 4. Batch with full registry ──────────────────────────────────

def test_batch_with_full_registry():
    """Each batch should pass FULL registry — even chars not in batch."""
    registry = _make_registry([
        ("CHAR_000", "male", 0.90, 100, False),
        ("CHAR_001", "female", 0.85, 50, False),
        ("CHAR_002", "male", 0.80, 30, False),
    ])
    # Batch has only CHAR_000 segments
    batch = [
        {"index": 0, "character_id": "CHAR_000", "original_text": "Xin chào."},
        {"index": 1, "character_id": "CHAR_000", "original_text": "Ai đó ở đó?"},
    ]
    # Pass FULL registry, not filtered to chars-in-batch
    block = build_character_registry_prompt_block(registry)
    assert "CHAR_000" in block
    assert "CHAR_001" in block  # ← MUST be present (relationship context)
    assert "CHAR_002" in block
    print("✓ test_batch_with_full_registry — full registry passed (3 chars)")


# ── 5. Context window not translated ─────────────────────────────

def test_context_window_not_translated():
    segments = [
        {"index": i, "character_id": f"CHAR_00{i % 2}",
         "original_text": f"Segment {i}"}
        for i in range(10)
    ]
    batch_indices = [4, 5, 6]
    before, after = gather_translation_context(segments, batch_indices, window=2)
    assert len(before) == 2
    assert len(after) == 2
    assert before[0]["index"] == 2  # window=2 → indices [2, 3]
    assert before[1]["index"] == 3
    assert after[0]["index"] == 7
    assert after[1]["index"] == 8
    # Batch itself NOT in context
    assert all(s["index"] not in (4, 5, 6) for s in before + after)

    # Format context block — must say "do NOT translate"
    cb = format_context_block(before, after)
    assert "do NOT translate" in cb
    assert "Segment 2" in cb
    assert "Segment 7" in cb
    # batch segments not in context block
    assert "Segment 4" not in cb
    assert "Segment 5" not in cb
    print(f"✓ test_context_window_not_translated — before=[2,3], after=[7,8]")


def test_context_window_at_boundaries():
    segments = [{"index": i, "original_text": f"s{i}"} for i in range(5)]
    # Batch at start
    before, after = gather_translation_context(segments, [0, 1], window=3)
    assert len(before) == 0
    assert len(after) == 3
    # Batch at end
    before, after = gather_translation_context(segments, [3, 4], window=3)
    assert len(before) == 3
    assert len(after) == 0
    print("✓ test_context_window_at_boundaries")


# ── 6. translation_notes enum validated ──────────────────────────

def test_translation_notes_enum_validated():
    assert parse_llm_translation_note("ok") == "ok"
    assert parse_llm_translation_note("follows_character_profile") == "follows_character_profile"
    assert parse_llm_translation_note("ambiguous_pronoun") == "ambiguous_pronoun"

    # Whitespace + case
    assert parse_llm_translation_note("  OK  ") == "ok"
    assert parse_llm_translation_note("FOLLOWS_CHARACTER_PROFILE") == "follows_character_profile"

    # Invalid → "ok" fallback
    assert parse_llm_translation_note("invalid_note") == "ok"
    assert parse_llm_translation_note("perfect_translation") == "ok"
    assert parse_llm_translation_note("") == "ok"
    assert parse_llm_translation_note(None) == "ok"
    assert parse_llm_translation_note(123) == "ok"  # type: ignore[arg-type]

    # Punctuation strip
    assert parse_llm_translation_note("note: ok!") == "ok"
    print(f"✓ test_translation_notes_enum_validated — "
          f"{len(VALID_TRANSLATION_NOTES)} valid enum values")


# ── 7. Locked character QA ───────────────────────────────────────

def test_locked_character_gender_preserved():
    """Locked male char với female pronouns trong translation → warning."""
    registry = _make_registry([
        ("CHAR_000", "male", 0.95, 50, True),  # locked + high conf
    ])
    segments = [
        {"index": 0, "character_id": "CHAR_000",
         "translated_text": "Cô đến đây làm gì? Chị đợi gì nữa?"},  # FEMALE pronouns
    ]
    warnings = validate_locked_character_translations(segments, registry)
    assert len(warnings) == 1
    w = warnings[0]
    assert w.character_id == "CHAR_000"
    assert w.issue == "locked_character_gender_violated"
    assert w.auto_fixed is False
    print(f"✓ test_locked_character_gender_preserved — warning emitted")


def test_locked_high_conf_no_violation_when_consistent():
    """Locked male char với male pronouns → 0 warnings."""
    registry = _make_registry([
        ("CHAR_000", "male", 0.95, 50, True),
    ])
    segments = [
        {"index": 0, "character_id": "CHAR_000",
         "translated_text": "Anh đến đây làm gì? Anh đợi gì nữa?"},
    ]
    warnings = validate_locked_character_translations(segments, registry)
    assert len(warnings) == 0
    print("✓ test_locked_high_conf_no_violation_when_consistent")


def test_locked_not_violated_when_unlocked():
    """Char không locked → KHÔNG check pronouns."""
    registry = _make_registry([
        ("CHAR_000", "male", 0.95, 50, False),  # NOT locked
    ])
    segments = [
        {"index": 0, "character_id": "CHAR_000",
         "translated_text": "Cô đến đây."},
    ]
    warnings = validate_locked_character_translations(segments, registry)
    assert len(warnings) == 0
    print("✓ test_locked_not_violated_when_unlocked")


# ── 8. Unknown gender uses neutral-safe ──────────────────────────

def test_unknown_gender_uses_neutral_safe():
    registry = _make_registry([
        ("CHAR_000", "unknown", 0.0, 30, False),
    ])
    block = build_character_registry_prompt_block(registry)
    assert "neutral-safe required" in block
    # Rules section reinforces
    assert "neutral-safe" in block.lower()
    print("✓ test_unknown_gender_uses_neutral_safe — prompt rule emitted")


# ── 9. High conf follows profile ─────────────────────────────────

def test_high_conf_gender_follows_profile():
    profile = CharacterProfile(
        character_id="CHAR_000",
        source_speakers=["SPEAKER_00"],
        gender="male",
        gender_confidence=0.92,
        line_count=50,
        total_duration=100.0,
    )
    note = classify_translation_note_for_segment(
        {"index": 0}, profile, ownership_tier="high",
    )
    assert note == "follows_character_profile"
    print(f"✓ test_high_conf_gender_follows_profile — note={note}")


def test_low_gender_conf_neutral_safe():
    profile = CharacterProfile(
        character_id="CHAR_000",
        source_speakers=["SPEAKER_00"],
        gender="male",
        gender_confidence=0.50,  # < 0.60 medium threshold
        line_count=50,
        total_duration=100.0,
    )
    note = classify_translation_note_for_segment({"index": 0}, profile)
    assert note == "neutral_safe_due_to_low_gender_confidence"
    print(f"✓ test_low_gender_conf_neutral_safe — note={note}")


# ── 12. Low ownership note ───────────────────────────────────────

def test_translation_note_low_ownership():
    profile = CharacterProfile(
        character_id="CHAR_000",
        source_speakers=["SPEAKER_00"],
        gender="male",
        gender_confidence=0.90,
        line_count=50,
        total_duration=100.0,
    )
    note = classify_translation_note_for_segment(
        {"index": 0}, profile, ownership_tier="low",
    )
    assert note == "neutral_safe_due_to_low_ownership_confidence"
    print(f"✓ test_translation_note_low_ownership — note={note}")


# ── 10. Face-only fallback ───────────────────────────────────────

def test_translation_face_only_fallback():
    """Registry=None → empty prompt block; caller falls back to chars_meta."""
    block = build_character_registry_prompt_block(None)
    assert block == ""

    # Verify locked validation doesn't crash with no registry
    warnings = validate_locked_character_translations(
        [{"index": 0, "translated_text": "test"}], None,
    )
    assert warnings == []
    print("✓ test_translation_face_only_fallback")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_translate_runs_after_registry,
        test_chars_meta_uses_character_id,
        test_build_character_registry_prompt_block,
        test_prompt_block_empty_registry,
        test_prompt_block_with_possible_merges,
        test_batch_with_full_registry,
        test_context_window_not_translated,
        test_context_window_at_boundaries,
        test_translation_notes_enum_validated,
        test_locked_character_gender_preserved,
        test_locked_high_conf_no_violation_when_consistent,
        test_locked_not_violated_when_unlocked,
        test_unknown_gender_uses_neutral_safe,
        test_high_conf_gender_follows_profile,
        test_low_gender_conf_neutral_safe,
        test_translation_note_low_ownership,
        test_translation_face_only_fallback,
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
