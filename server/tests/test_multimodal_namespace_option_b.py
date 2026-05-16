"""Phase 7b regression tests — namespace Option B.

Verify fuse_speakers KHÔNG còn tạo CHAR_XX synthetic IDs.
seg["speaker"] phải là raw SPEAKER_XX hoặc FACE_XX sau fusion.

Cover:
  1. Audio strong + face match (Tier A) → seg["speaker"] = SPEAKER_XX raw
  2. Audio strong no face (Tier B) → seg["speaker"] = SPEAKER_XX raw
  3. Face wins weak audio (Tier E) → seg["speaker"] = FACE_XX raw
  4. Face only no audio (Tier F) → seg["speaker"] = FACE_XX raw
  5. No CHAR_XX prefix anywhere
  6. fusion.char_genders keyed by raw IDs (SPEAKER_XX / FACE_XX), không CHAR_XX
  7. stats["namespace"] == "raw_ids_phase_7b" marker
  8. Backward compat: FusionResult schema không break

Chạy: PYTHONPATH=. python tests/test_multimodal_namespace_option_b.py
"""
from __future__ import annotations

from app.services.multimodal_speaker_svc import (
    REASON_AUDIO_STRONG_FACE_CONFIRM,
    REASON_AUDIO_STRONG_NO_FACE,
    REASON_FACE_ONLY_NO_AUDIO,
    REASON_FACE_WINS_WEAK_AUDIO,
    fuse_speakers,
)


def test_tier_a_audio_strong_face_match_emits_raw_speaker():
    """Audio strong (>=0.85) + cross-match → seg["speaker"] = SPEAKER_XX raw."""
    # 2 segments để qua AUDIO_FACE_COOCCURRENCE_MIN (default 2) cross-match
    segments = [
        {"index": 0, "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.5},
        {"index": 1, "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.5},
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={0: "male"},
        face_gender_confs={0: 0.9},
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_confidences={"SPEAKER_00": 0.9},
    )
    for seg in segments:
        assert seg["speaker"] == "SPEAKER_00", \
            f"Expected raw SPEAKER_00, got {seg['speaker']}"
        assert not str(seg["speaker"]).startswith("CHAR_"), \
            f"Phase 7b violation — CHAR_XX leak: {seg['speaker']}"
        assert seg["fusion_reason"] == REASON_AUDIO_STRONG_FACE_CONFIRM
    print("✓ test_tier_a_audio_strong_face_match_emits_raw_speaker")


def test_tier_b_audio_strong_no_face_emits_raw_speaker():
    """Audio strong + no face → seg["speaker"] = SPEAKER_XX (off-screen voice-over)."""
    segments = [
        {"index": 0, "audio_speaker": "SPEAKER_01", "face_id": None, "face_confidence": 0.0},
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={},
        face_gender_confs={},
        audio_speaker_genders={"SPEAKER_01": "female"},
        audio_speaker_confidences={"SPEAKER_01": 0.92},
    )
    assert segments[0]["speaker"] == "SPEAKER_01"
    assert segments[0]["fusion_reason"] == REASON_AUDIO_STRONG_NO_FACE
    assert not segments[0]["speaker"].startswith("CHAR_")
    print("✓ test_tier_b_audio_strong_no_face_emits_raw_speaker")


def test_tier_e_face_wins_weak_audio_emits_face_raw():
    """Audio weak + face active strong → seg["speaker"] = FACE_XX raw."""
    segments = [
        {"index": 0, "audio_speaker": "SPEAKER_02", "face_id": "FACE_03", "face_confidence": 0.85},
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={3: "male"},
        face_gender_confs={3: 0.8},
        audio_speaker_genders={"SPEAKER_02": "male"},
        audio_speaker_confidences={"SPEAKER_02": 0.5},  # weak < OWNERSHIP_KEEP
    )
    assert segments[0]["speaker"] == "FACE_03"
    assert segments[0]["fusion_reason"] == REASON_FACE_WINS_WEAK_AUDIO
    assert not segments[0]["speaker"].startswith("CHAR_")
    print(f"✓ test_tier_e_face_wins_weak_audio_emits_face_raw — {segments[0]['speaker']}")


def test_tier_f_face_only_no_audio_emits_face_raw():
    """No audio + face active strong → seg["speaker"] = FACE_XX raw."""
    segments = [
        {"index": 0, "audio_speaker": None, "face_id": "FACE_05", "face_confidence": 0.85},
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={5: "female"},
        face_gender_confs={5: 0.9},
    )
    assert segments[0]["speaker"] == "FACE_05"
    assert segments[0]["fusion_reason"] == REASON_FACE_ONLY_NO_AUDIO
    assert not segments[0]["speaker"].startswith("CHAR_")
    print(f"✓ test_tier_f_face_only_no_audio_emits_face_raw — {segments[0]['speaker']}")


def test_no_char_xx_anywhere_in_output():
    """Mixed segments — verify ZERO CHAR_XX leak across all tiers."""
    segments = [
        {"index": 0, "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.85},  # A
        {"index": 1, "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.85},  # A (cooccur)
        {"index": 2, "audio_speaker": "SPEAKER_01", "face_id": None, "face_confidence": 0.0},        # B
        {"index": 3, "audio_speaker": None, "face_id": "FACE_02", "face_confidence": 0.85},         # F
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={0: "male", 2: "female"},
        face_gender_confs={0: 0.9, 2: 0.85},
        audio_speaker_genders={"SPEAKER_00": "male", "SPEAKER_01": "female"},
        audio_speaker_confidences={"SPEAKER_00": 0.9, "SPEAKER_01": 0.9},
    )
    for seg in segments:
        spk = seg.get("speaker")
        assert spk is not None
        assert not str(spk).startswith("CHAR_"), \
            f"CHAR_XX leak detected: seg[{seg['index']}].speaker = {spk}"
    assert all(
        not k.startswith("CHAR_") for k in result.char_genders.keys()
    ), f"char_genders has CHAR_XX keys: {list(result.char_genders.keys())}"
    print(f"✓ test_no_char_xx_anywhere_in_output — {len(segments)} segments clean")


def test_char_genders_keyed_by_raw_ids():
    """fusion.char_genders (legacy field name) should be keyed by raw IDs Phase 7b."""
    segments = [
        {"index": 0, "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.85},
        {"index": 1, "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.85},
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={0: "male"},
        face_gender_confs={0: 0.9},
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_confidences={"SPEAKER_00": 0.9},
    )
    # Used winner = SPEAKER_00 (Tier A audio strong cross-match)
    assert "SPEAKER_00" in result.char_genders
    assert result.char_genders["SPEAKER_00"] == "male"
    print(f"✓ test_char_genders_keyed_by_raw_ids — keys={list(result.char_genders.keys())}")


def test_stats_namespace_marker():
    """stats["namespace"] == 'raw_ids_phase_7b' để caller verify migration."""
    segments = [
        {"index": 0, "audio_speaker": "SPEAKER_00"},
    ]
    result = fuse_speakers(
        segments=segments,
        face_genders={},
        face_gender_confs={},
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_confidences={"SPEAKER_00": 0.9},
    )
    assert result.stats.get("namespace") == "raw_ids_phase_7b"
    print(f"✓ test_stats_namespace_marker — {result.stats['namespace']}")


def test_fusion_result_schema_unchanged():
    """FusionResult dataclass shape không break (backward compat)."""
    segments = [{"index": 0, "audio_speaker": "SPEAKER_00"}]
    result = fuse_speakers(
        segments=segments,
        face_genders={},
        face_gender_confs={},
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_confidences={"SPEAKER_00": 0.9},
    )
    assert hasattr(result, "audio_to_face")
    assert hasattr(result, "char_genders")
    assert hasattr(result, "char_count")
    assert hasattr(result, "stats")
    assert hasattr(result, "gender_conflicts")
    print("✓ test_fusion_result_schema_unchanged")


def main():
    tests = [
        test_tier_a_audio_strong_face_match_emits_raw_speaker,
        test_tier_b_audio_strong_no_face_emits_raw_speaker,
        test_tier_e_face_wins_weak_audio_emits_face_raw,
        test_tier_f_face_only_no_audio_emits_face_raw,
        test_no_char_xx_anywhere_in_output,
        test_char_genders_keyed_by_raw_ids,
        test_stats_namespace_marker,
        test_fusion_result_schema_unchanged,
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
    print()
    print(f"═══ {passed}/{len(tests)} passed, {failed} failed ═══")
    return failed == 0


if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)
