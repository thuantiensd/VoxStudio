"""Unit tests for Phase 11 — qa_report + dispatcher wire + Check 4 fix.

Coverage:
  qa_report:
    test_qa_report_full_structure
    test_qa_report_aggregates_phase_warnings
    test_qa_report_summary_counts_correct
    test_qa_report_serialize_roundtrip
    test_qa_report_reconstructs_registry_from_summary
    test_qa_report_face_only_no_registry
    test_qa_report_skip_invalid_warning_entries

  Check 4 fix (Phase 10 false positive):
    test_check4_ambiguous_3rd_person_keeps_original
    test_check4_clear_self_reference_rewrites
    test_check4_pronoun_with_ay_marker_keeps_original

  Dispatcher wire:
    test_dispatcher_helper_builds_registry_block
    test_dispatcher_helper_returns_none_when_no_registry

Chạy: PYTHONPATH=. python tests/test_qa_report_phase_11.py
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.models.character_schemas import (
    CharacterProfile,
    CharacterRegistry,
    GenderConflict,
    OwnershipWarning,
    PossibleMerge,
    QAReport,
    QASummary,
    TranslationWarning,
    VoiceMapWarning,
)
from app.services.qa_report_service import (
    build_qa_report,
    save_qa_report,
)
from app.services.translation_qa_service import run_translation_qa


# ── Helpers ──────────────────────────────────────────────────────

def _make_registry(specs: list[tuple]) -> CharacterRegistry:
    """specs = [(char_id, gender, gender_conf, line_count, locked, review_required), ...]"""
    chars = {}
    for spec in specs:
        cid, g, gc, lc, locked, rev = spec
        chars[cid] = CharacterProfile(
            character_id=cid,
            source_speakers=[f"SPEAKER_{cid[-2:]}"],
            gender=g,
            gender_confidence=gc,
            line_count=lc,
            total_duration=lc * 2.0,
            locked=locked,
            review_required=rev,
        )
    return CharacterRegistry(project_id="t", characters=chars)


# ── qa_report ────────────────────────────────────────────────────

def test_qa_report_full_structure():
    """All 12 QAReport fields present, valid Pydantic."""
    registry = _make_registry([
        ("CHAR_000", "male", 0.90, 50, False, False),
    ])
    project = {
        "id": "p1",
        "segments": [
            {"index": 0, "id": "s0", "ownership_tier": "high",
             "ownership_confidence": 0.85},
            {"index": 1, "id": "s1", "ownership_tier": "low",
             "ownership_confidence": 0.30},
        ],
    }
    report = build_qa_report(project, registry)
    assert report.project_id == "p1"
    assert report.generated_at is not None
    assert isinstance(report.summary, QASummary)
    assert isinstance(report.uncertain_characters, list)
    assert isinstance(report.uncertain_segments, list)
    assert isinstance(report.possible_merges, list)
    assert isinstance(report.gender_conflicts, list)
    assert isinstance(report.ownership_warnings, list)
    assert isinstance(report.translation_warnings, list)
    assert isinstance(report.voice_map_warnings, list)
    assert isinstance(report.timing_warnings, list)
    assert isinstance(report.system_errors, list)
    print(f"✓ test_qa_report_full_structure — {len(report.model_dump())} fields")


def test_qa_report_summary_counts_correct():
    registry = _make_registry([
        ("CHAR_000", "male", 0.90, 50, False, False),
        ("CHAR_001", "unknown", 0.30, 30, False, True),  # uncertain
        ("CHAR_002", "female", 0.85, 40, False, False),
    ])
    project = {
        "id": "p1",
        "segments": [
            {"index": 0, "id": "s0", "ownership_tier": "high",
             "ownership_confidence": 0.80},
            {"index": 1, "id": "s1", "ownership_tier": "low",
             "ownership_confidence": 0.40},
            {"index": 2, "id": "s2", "ownership_tier": "low",
             "ownership_confidence": 0.30},
            {"index": 3, "id": "s3", "ownership_tier": "medium",
             "ownership_confidence": 0.60},
        ],
    }
    report = build_qa_report(project, registry)
    assert report.summary.total_segments == 4
    assert report.summary.total_characters == 3
    assert report.summary.low_confidence_segments == 2  # s1, s2
    assert abs(report.summary.low_confidence_ratio - 0.5) < 0.01
    assert report.summary.unknown_gender_characters == 1  # CHAR_001
    print(f"✓ test_qa_report_summary_counts_correct — {report.summary.model_dump()}")


def test_qa_report_aggregates_phase_warnings():
    registry = _make_registry([
        ("CHAR_000", "male", 0.90, 50, False, False),
    ])
    project = {
        "id": "p1",
        "segments": [{"index": 0, "id": "s0", "ownership_confidence": 0.8}],
        # Phase 6 warnings
        "ownership_warnings": [
            {"segment_id": 0, "start_time": 0.0, "end_time": 5.0,
             "assigned_character": "CHAR_000", "best_candidate": "CHAR_001",
             "ownership_confidence": 0.4, "reason": "low_conf_keep"},
        ],
        # Phase 7a
        "gender_conflicts": [
            {"character_id": "CHAR_000", "audio_gender": "male",
             "audio_confidence": 0.85, "face_gender": "female",
             "face_confidence": 0.70, "decision": "male",
             "decision_reason": "audio_wins_conflict_strong"},
        ],
        # Phase 8
        "voice_map_warnings": [
            {"character_id": "CHAR_000", "issue": "majority_rule_applied",
             "decided_voice": "v_male", "reason": "fallback"},
        ],
        # Phase 9/10
        "translation_warnings": [
            {"segment_id": 0, "character_id": "CHAR_000",
             "issue": "locked_character_gender_violated",
             "auto_fixed": True},
        ],
    }
    # Add possible_merges to registry
    registry.possible_merges.append(PossibleMerge(
        characters=["CHAR_000", "CHAR_001"],
        similarity=0.70,
        evidences_present=["same_gender_high_conf"],
        evidences_count=1,
        reason_not_merged="only_1_evidences_below_min_2",
    ))

    report = build_qa_report(project, registry)
    assert len(report.ownership_warnings) == 1
    assert len(report.gender_conflicts) == 1
    assert len(report.voice_map_warnings) == 1
    assert len(report.translation_warnings) == 1
    assert len(report.possible_merges) == 1
    print(f"✓ test_qa_report_aggregates_phase_warnings — all 5 channels populated")


def test_qa_report_serialize_roundtrip():
    """JSON write → read → equal."""
    registry = _make_registry([
        ("CHAR_000", "male", 0.85, 50, False, False),
    ])
    project = {"id": "p1", "segments": []}
    report = build_qa_report(project, registry)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        path = Path(f.name)
    try:
        save_qa_report(report, path)
        loaded_dict = json.loads(path.read_text())
        # Re-validate via Pydantic
        loaded = QAReport.model_validate(loaded_dict)
        assert loaded.project_id == report.project_id
        assert loaded.summary.total_characters == report.summary.total_characters
        print(f"✓ test_qa_report_serialize_roundtrip — {path.stat().st_size}B")
    finally:
        path.unlink(missing_ok=True)


def test_qa_report_reconstructs_registry_from_summary():
    """build_qa_report(project, registry=None) → reconstruct from project meta."""
    project = {
        "id": "p1",
        "segments": [{"index": 0, "id": "s0", "ownership_confidence": 0.9}],
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_000", "gender": "female",
                 "gender_confidence": 0.88, "source_speakers": ["SPEAKER_00"],
                 "line_count": 30, "merge_confidence": 1.0,
                 "locked": False, "review_required": False},
            ],
            "possible_merges": [],
        },
    }
    report = build_qa_report(project, registry=None)
    assert report.summary.total_characters == 1
    print("✓ test_qa_report_reconstructs_registry_from_summary")


def test_qa_report_face_only_no_registry():
    """Face-only path — no registry available → graceful empty."""
    project = {
        "id": "face_only",
        "segments": [{"index": 0, "id": "s0", "speaker": "FACE_00"}],
        # No character_registry_summary
    }
    report = build_qa_report(project, registry=None)
    assert report.summary.total_characters == 0
    assert report.summary.total_segments == 1
    assert report.uncertain_characters == []
    print("✓ test_qa_report_face_only_no_registry")


def test_qa_report_skip_invalid_warning_entries():
    """Invalid Pydantic entries in project meta → skip with debug log, no crash."""
    registry = _make_registry([("CHAR_000", "male", 0.85, 50, False, False)])
    project = {
        "id": "p1",
        "segments": [],
        "ownership_warnings": [
            {"invalid_field": "wrong_schema"},  # malformed
            {"segment_id": 0, "start_time": 0.0, "end_time": 5.0,
             "assigned_character": "CHAR_000", "best_candidate": None,
             "ownership_confidence": 0.4, "reason": "low_conf_keep"},  # valid
        ],
    }
    report = build_qa_report(project, registry)
    assert len(report.ownership_warnings) == 1  # only valid entry
    print(f"✓ test_qa_report_skip_invalid_warning_entries — 1/2 valid kept")


# ── Check 4 false positive fix ───────────────────────────────────

def test_check4_ambiguous_3rd_person_keeps_original():
    """Phase 11 fix: "Cô đợi anh ấy" với unknown gender → keep original,
    warning only (issue=ambiguous_pronoun), KHÔNG auto-fix.

    Semantic preservation: "Cô đợi anh ấy" (she waits for him) phải NOT
    auto-rewrite thành "Tôi đợi anh ấy" (I wait for him) → đổi nghĩa.
    """
    registry = _make_registry([
        ("CHAR_000", "unknown", 0.0, 30, False, False),
    ])
    segments = [{
        "index": 0, "character_id": "CHAR_000",
        "translated_text": "Cô đợi anh ấy ở đây.",
        "ownership_confidence": 0.9,
    }]
    r = run_translation_qa(segments, registry)
    # Should emit ambiguous_pronoun warning, NOT gender_unknown_forced_safe
    ambiguous = [w for w in r["warnings"] if w.issue == "ambiguous_pronoun"]
    assert len(ambiguous) == 1, \
        f"Expected ambiguous_pronoun warning, got {[w.issue for w in r['warnings']]}"
    assert ambiguous[0].auto_fixed is False
    # Should NOT have auto-fix rewrite
    assert 0 not in r["rewrites"], \
        f"Phase 11 fix: should not rewrite ambiguous 3rd-person context, got {r['rewrites']}"
    # text preserved
    assert segments[0]["translated_text"] == "Cô đợi anh ấy ở đây."
    print(f"✓ test_check4_ambiguous_3rd_person_keeps_original — semantic preserved")


def test_check4_clear_self_reference_rewrites():
    """Phase 11 fix: "Cô là người tốt" (no other pronoun) → likely self-ref,
    rewrite to neutral."""
    registry = _make_registry([
        ("CHAR_000", "unknown", 0.0, 30, False, False),
    ])
    segments = [{
        "index": 0, "character_id": "CHAR_000",
        "translated_text": "Cô là người tốt.",
        "ownership_confidence": 0.9,
    }]
    r = run_translation_qa(segments, registry)
    # Should auto-fix (no other gendered pronoun nearby → likely self-ref)
    forced = [w for w in r["warnings"] if w.issue == "gender_unknown_forced_safe"]
    assert len(forced) == 1
    assert 0 in r["rewrites"]
    new_text = r["rewrites"][0]
    assert "Tôi" in new_text
    print(f"✓ test_check4_clear_self_reference_rewrites — rewrite='{new_text}'")


def test_check4_pronoun_with_ay_marker_keeps_original():
    """Phase 11 fix: "Cô nói rằng anh ấy đến" — "anh ấy" có marker → keep."""
    registry = _make_registry([
        ("CHAR_000", "unknown", 0.0, 30, False, False),
    ])
    segments = [{
        "index": 0, "character_id": "CHAR_000",
        "translated_text": "Cô nói rằng anh ấy đến.",
        "ownership_confidence": 0.9,
    }]
    r = run_translation_qa(segments, registry)
    # Ambiguous - "anh ấy" 3rd person marker → keep
    ambiguous = [w for w in r["warnings"] if w.issue == "ambiguous_pronoun"]
    assert len(ambiguous) == 1
    assert segments[0]["translated_text"] == "Cô nói rằng anh ấy đến."
    print("✓ test_check4_pronoun_with_ay_marker_keeps_original")


# ── Dispatcher helper ────────────────────────────────────────────

def test_dispatcher_helper_builds_registry_block():
    """build_registry_block_for_translate returns block from project meta.
    Phase 11 — import từ helper module (không phụ thuộc dubbing_svc /
    ffmpeg) để test chạy được trên env minimal."""
    from app.services.translation_character_helper import (
        build_registry_block_for_translate,
    )
    project = {
        "id": "p1",
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_000", "gender": "male",
                 "gender_confidence": 0.92, "source_speakers": ["SPEAKER_00"],
                 "line_count": 120, "merge_confidence": 1.0},
                {"character_id": "CHAR_001", "gender": "female",
                 "gender_confidence": 0.88, "source_speakers": ["SPEAKER_01"],
                 "line_count": 85, "merge_confidence": 1.0},
            ],
            "possible_merges": [],
        },
        "speaker_characters": {
            "SPEAKER_00": {"character_name": "Wang Wei", "role": "protagonist"},
            "SPEAKER_01": {"character_name": "Lin Xiao", "role": "love_interest"},
        },
    }
    block = build_registry_block_for_translate(project)
    assert block is not None
    assert "CHAR_000" in block
    assert "CHAR_001" in block
    assert "Wang Wei" in block
    assert "Lin Xiao" in block
    assert "RULES" in block  # Phase 12: "RULES (CRITICAL..."
    print(f"✓ test_dispatcher_helper_builds_registry_block — len={len(block)}")


def test_dispatcher_helper_returns_none_when_no_registry():
    """No character_registry_summary in project → None."""
    from app.services.translation_character_helper import (
        build_registry_block_for_translate,
    )
    project = {"id": "p1"}  # no registry
    block = build_registry_block_for_translate(project)
    assert block is None
    print("✓ test_dispatcher_helper_returns_none_when_no_registry")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        # qa_report
        test_qa_report_full_structure,
        test_qa_report_summary_counts_correct,
        test_qa_report_aggregates_phase_warnings,
        test_qa_report_serialize_roundtrip,
        test_qa_report_reconstructs_registry_from_summary,
        test_qa_report_face_only_no_registry,
        test_qa_report_skip_invalid_warning_entries,
        # Check 4 fix
        test_check4_ambiguous_3rd_person_keeps_original,
        test_check4_clear_self_reference_rewrites,
        test_check4_pronoun_with_ay_marker_keeps_original,
        # Dispatcher
        test_dispatcher_helper_builds_registry_block,
        test_dispatcher_helper_returns_none_when_no_registry,
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
