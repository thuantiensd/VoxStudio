"""Phase 12 Fix A — Skip Pass-0 speaker_relationships khi character_registry exists.

User confirmed Fix A: nếu character_registry_summary có chars → skip legacy
Pass-0 LLM analyze. Tránh 2 prompt section chồng nhau gây LLM rối (2-voice
mode dịch ngu hơn 1-voice).

4 spec tests:
  1. test_skip_pass0_when_character_registry_exists
  2. test_fallback_to_legacy_when_no_character_registry
  3. test_rollback_flag_disables_skip
  4. test_face_only_path_uses_legacy (no registry → use Pass-0)

Plus support:
  - test_helper_returns_bool
  - test_skip_when_chars_empty_list

Chạy: PYTHONPATH=. python tests/test_translation_fix_a_phase_12.py
"""
from __future__ import annotations

from app.services.voice_routing_svc import should_skip_pass0_analysis


# ── Spec 1: skip Pass-0 when registry exists ─────────────────────

def test_skip_pass0_when_character_registry_exists():
    """character_registry_summary có characters > 0 → skip Pass-0."""
    project = {
        "character_registry_summary": {
            "characters": [
                {"character_id": "CHAR_000", "gender": "male"},
                {"character_id": "CHAR_001", "gender": "female"},
            ],
        },
    }
    result = should_skip_pass0_analysis(project)
    assert result is True, "Expected skip Pass-0 when registry has chars"
    print(f"✓ test_skip_pass0_when_character_registry_exists — skip=True")


# ── Spec 2: fallback to legacy when no registry ──────────────────

def test_fallback_to_legacy_when_no_character_registry():
    """Không có character_registry_summary → dùng Pass-0 legacy."""
    project = {}  # no registry
    result = should_skip_pass0_analysis(project)
    assert result is False, "Expected use legacy Pass-0 when no registry"
    print("✓ test_fallback_to_legacy_when_no_character_registry — skip=False")


# ── Spec 3: rollback flag disables skip ──────────────────────────

def test_rollback_flag_disables_skip():
    """USE_LEGACY_SPEAKER_RELATIONSHIPS_WITH_REGISTRY = True → always use legacy."""
    import app.config as config
    original = config.USE_LEGACY_SPEAKER_RELATIONSHIPS_WITH_REGISTRY
    try:
        config.USE_LEGACY_SPEAKER_RELATIONSHIPS_WITH_REGISTRY = True
        project = {
            "character_registry_summary": {
                "characters": [{"character_id": "CHAR_000", "gender": "male"}],
            },
        }
        result = should_skip_pass0_analysis(project)
        assert result is False, \
            "Rollback flag must force False (use legacy Pass-0)"
    finally:
        config.USE_LEGACY_SPEAKER_RELATIONSHIPS_WITH_REGISTRY = original
    print("✓ test_rollback_flag_disables_skip")


# ── Spec 4: face-only path uses legacy ───────────────────────────

def test_face_only_path_uses_legacy():
    """Face-only path (no pyannote registry) → use Pass-0 legacy."""
    project = {
        "character_registry_summary": {
            "characters": [],  # registry built but no chars (face-only path)
        },
    }
    result = should_skip_pass0_analysis(project)
    assert result is False, "Empty chars → use legacy Pass-0"
    print("✓ test_face_only_path_uses_legacy")


# ── Support tests ────────────────────────────────────────────────

def test_helper_returns_bool():
    """Return type must be bool (not None, dict, etc)."""
    assert isinstance(should_skip_pass0_analysis({}), bool)
    assert isinstance(
        should_skip_pass0_analysis(
            {"character_registry_summary": {"characters": [{"character_id": "X"}]}}
        ),
        bool,
    )
    print("✓ test_helper_returns_bool")


def test_skip_when_chars_empty_list():
    """character_registry_summary.characters = [] → use legacy (not skip)."""
    project = {"character_registry_summary": {"characters": []}}
    assert should_skip_pass0_analysis(project) is False
    print("✓ test_skip_when_chars_empty_list")


def test_skip_when_summary_missing_characters_key():
    """character_registry_summary present but no 'characters' key → use legacy."""
    project = {"character_registry_summary": {}}
    assert should_skip_pass0_analysis(project) is False
    print("✓ test_skip_when_summary_missing_characters_key")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_skip_pass0_when_character_registry_exists,
        test_fallback_to_legacy_when_no_character_registry,
        test_rollback_flag_disables_skip,
        test_face_only_path_uses_legacy,
        test_helper_returns_bool,
        test_skip_when_chars_empty_list,
        test_skip_when_summary_missing_characters_key,
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
