"""Unit tests for gender_detection_service (Phase 7a audit refactor).

Coverage:
  Fusion (6+ case combinations):
    1. Audio only (no face) → audio_only reason
    2. Face only (no audio) → face_only_no_audio
    3. Audio + face AGREE → boost + cap 0.95
    4. Audio + face DISAGREE + audio strong (≥0.70) → audio wins, -0.10
    5. Audio + face DISAGREE + audio weak → unknown
    6. Self-ref boost positive (+0.10, cap)
    7. Self-ref AGREE doesn't override final gender (positive AGREE case)
    8. Self-ref MISMATCH KHÔNG override audio+face agreed
    9. No signal at all → unknown
    10. face_track NOT stable → face signal dropped
    11. Tier thresholds: HIGH/MEDIUM/UNKNOWN

  Self-reference pattern match (positive + negative):
    P1. "Tôi là cha" → male
    P2. "Tôi là mẹ" → female
    P3. "Cha đây" → male
    P4. "Mẹ đã về" → female
    N1. "Cô ấy đợi ngài" → None (no self-ref)
    N2. "Anh đừng lại gần" → None (addressee, not self)
    N3. "Hắn nói dối" → None (3rd person)
    N4. Empty / None text → None

  Batch entry:
    B1. detect_all_character_genders với 2 chars → mutate profiles
    B2. GenderConflict logged khi disagree

Chạy: PYTHONPATH=. python tests/test_gender_detection_service.py
"""
from __future__ import annotations

from app.models.character_schemas import CharacterProfile, CharacterRegistry
from app.services.gender_detection_service import (
    REASON_AUDIO_FACE_AGREE,
    REASON_AUDIO_ONLY,
    REASON_AUDIO_WINS_CONFLICT,
    REASON_FACE_ONLY,
    REASON_NO_SIGNAL,
    REASON_UNKNOWN_BOTH_WEAK,
    detect_all_character_genders,
    detect_character_gender,
    detect_self_reference_gender,
)


# ── Fusion: case 1 — Audio only ──────────────────────────────────

def test_fusion_audio_only():
    d = detect_character_gender(
        character_id="CHAR_000",
        audio_gender="male",
        audio_confidence=0.85,
    )
    assert d.final_gender == "male"
    assert d.final_confidence == 0.85
    assert d.tier == "high"
    assert d.decision_reason == REASON_AUDIO_ONLY
    print(f"✓ test_fusion_audio_only — male/{d.final_confidence}/{d.tier}")


# ── Fusion: case 2 — Face only ───────────────────────────────────

def test_fusion_face_only():
    d = detect_character_gender(
        character_id="CHAR_000",
        face_gender="female",
        face_confidence=0.78,
        face_track_stable=True,
    )
    assert d.final_gender == "female"
    assert d.final_confidence == 0.78
    assert d.tier == "medium"
    assert d.decision_reason == REASON_FACE_ONLY
    print(f"✓ test_fusion_face_only — female/{d.final_confidence}/{d.tier}")


# ── Fusion: case 3 — AGREE ───────────────────────────────────────

def test_fusion_audio_face_agree_boost():
    """audio=0.75 + face=0.80 + AGREE → conf = min(0.80+0.05, 0.95) = 0.85, high."""
    d = detect_character_gender(
        character_id="CHAR_001",
        audio_gender="male",
        audio_confidence=0.75,
        face_gender="male",
        face_confidence=0.80,
        face_track_stable=True,
    )
    assert d.final_gender == "male"
    assert d.final_confidence == 0.85
    assert d.tier == "high"
    assert d.decision_reason == REASON_AUDIO_FACE_AGREE
    print(f"✓ test_fusion_audio_face_agree_boost — {d.final_confidence}/{d.tier}")


def test_fusion_agree_boost_capped_at_095():
    """audio=0.95 + face=0.95 → 0.95 + 0.05 = 1.00 → cap 0.95."""
    d = detect_character_gender(
        character_id="C",
        audio_gender="female",
        audio_confidence=0.95,
        face_gender="female",
        face_confidence=0.95,
    )
    assert d.final_confidence == 0.95
    print("✓ test_fusion_agree_boost_capped_at_095")


# ── Fusion: case 4 — DISAGREE audio strong wins ──────────────────

def test_fusion_disagree_audio_strong_wins():
    """audio=male/0.85, face=female/0.70 → audio wins, conf=0.85-0.10=0.75."""
    d = detect_character_gender(
        character_id="C2",
        audio_gender="male",
        audio_confidence=0.85,
        face_gender="female",
        face_confidence=0.70,
        face_track_stable=True,
    )
    assert d.final_gender == "male"
    assert d.final_confidence == 0.75
    assert d.tier == "medium"  # 0.60 ≤ 0.75 < 0.80
    assert d.decision_reason == REASON_AUDIO_WINS_CONFLICT
    print(f"✓ test_fusion_disagree_audio_strong_wins — {d.final_gender}/{d.final_confidence}")


# ── Fusion: case 5 — DISAGREE audio weak → unknown ───────────────

def test_fusion_disagree_audio_weak_unknown():
    """audio=male/0.60 (< 0.70), face=female/0.75 → unknown (both weak)."""
    d = detect_character_gender(
        character_id="C3",
        audio_gender="male",
        audio_confidence=0.60,
        face_gender="female",
        face_confidence=0.75,
        face_track_stable=True,
    )
    assert d.final_gender == "unknown"
    assert d.tier == "unknown"
    assert d.decision_reason == REASON_UNKNOWN_BOTH_WEAK
    print(f"✓ test_fusion_disagree_audio_weak_unknown — {d.decision_reason}")


# ── Fusion: case 6 — Self-ref boost ──────────────────────────────

def test_fusion_selfref_boost_positive():
    """audio=male/0.65, self_ref=male → boost +0.10 → 0.75."""
    d = detect_character_gender(
        character_id="C4",
        audio_gender="male",
        audio_confidence=0.65,
        self_ref_gender="male",
    )
    assert d.final_gender == "male"
    assert d.final_confidence == 0.75
    assert d.self_ref_boost_applied is True
    print(f"✓ test_fusion_selfref_boost_positive — {d.final_confidence}")


def test_fusion_selfref_boost_capped():
    """audio=0.90 + self_ref agree → 0.90+0.10 = 1.0 → cap 0.95."""
    d = detect_character_gender(
        character_id="C",
        audio_gender="female",
        audio_confidence=0.90,
        self_ref_gender="female",
    )
    assert d.final_confidence == 0.95
    print("✓ test_fusion_selfref_boost_capped")


# ── Fusion: case 8 — Self-ref MISMATCH (negative) ────────────────

def test_fusion_selfref_mismatch_does_not_override():
    """audio+face AGREE male, self_ref=female → KHÔNG override, no boost."""
    d = detect_character_gender(
        character_id="C5",
        audio_gender="male",
        audio_confidence=0.85,
        face_gender="male",
        face_confidence=0.80,
        self_ref_gender="female",  # mismatch
    )
    assert d.final_gender == "male"  # NOT female
    assert d.self_ref_boost_applied is False
    # conf = min(max(0.85, 0.80) + 0.05, 0.95) = 0.90
    assert d.final_confidence == 0.90
    print(f"✓ test_fusion_selfref_mismatch_does_not_override — gender={d.final_gender}")


# ── Fusion: case 9 — No signal ───────────────────────────────────

def test_fusion_no_signal():
    d = detect_character_gender(character_id="C6")
    assert d.final_gender == "unknown"
    assert d.final_confidence == 0.0
    assert d.decision_reason == REASON_NO_SIGNAL
    print("✓ test_fusion_no_signal")


# ── Fusion: case 10 — face_track NOT stable → face dropped ───────

def test_fusion_face_not_stable_dropped():
    """face_track_stable=False → face signal ignored → fallback audio_only."""
    d = detect_character_gender(
        character_id="C7",
        audio_gender="male",
        audio_confidence=0.85,
        face_gender="female",  # would conflict but ignored
        face_confidence=0.95,
        face_track_stable=False,
    )
    assert d.final_gender == "male"
    assert d.decision_reason == REASON_AUDIO_ONLY
    assert d.face_input is None
    print("✓ test_fusion_face_not_stable_dropped")


# ── Fusion: case 11 — Tier thresholds ────────────────────────────

def test_fusion_tier_high_medium_unknown():
    d_high = detect_character_gender("C", audio_gender="male", audio_confidence=0.85)
    d_med = detect_character_gender("C", audio_gender="male", audio_confidence=0.70)
    d_unk = detect_character_gender("C", audio_gender="male", audio_confidence=0.55)
    assert d_high.tier == "high"
    assert d_med.tier == "medium"
    assert d_unk.tier == "unknown"
    print("✓ test_fusion_tier_high_medium_unknown")


# ── Self-ref pattern: positive ───────────────────────────────────

def test_selfref_tôi_là_cha():
    assert detect_self_reference_gender("Tôi là cha của thằng bé.") == "male"
    print("✓ test_selfref_tôi_là_cha")


def test_selfref_tôi_là_mẹ():
    assert detect_self_reference_gender("Tôi là mẹ nó đó.") == "female"
    print("✓ test_selfref_tôi_là_mẹ")


def test_selfref_cha_đây():
    assert detect_self_reference_gender("Cha đây con.") == "male"
    assert detect_self_reference_gender("Cha về rồi nè.") == "male"
    print("✓ test_selfref_cha_đây")


def test_selfref_mẹ_đã_về():
    assert detect_self_reference_gender("Mẹ đã về rồi con.") == "female"
    assert detect_self_reference_gender("Má đây nè.") == "female"
    print("✓ test_selfref_mẹ_đã_về")


def test_selfref_tôi_là_đàn_ông():
    assert detect_self_reference_gender("Tôi là một người đàn ông.") == "male"
    assert detect_self_reference_gender("Tôi là phụ nữ.") == "female"
    print("✓ test_selfref_tôi_là_đàn_ông")


# ── Self-ref pattern: negative ───────────────────────────────────

def test_selfref_negative_cô_ấy_đợi_ngài():
    """3rd person 'cô ấy' + addressee 'ngài' — không tự nhận."""
    assert detect_self_reference_gender("Cô ấy đợi ngài.") is None
    print("✓ test_selfref_negative_cô_ấy_đợi_ngài")


def test_selfref_negative_anh_đừng_lại_gần():
    """'anh' = addressee, không phải self-ref."""
    assert detect_self_reference_gender("Anh đừng lại gần.") is None
    print("✓ test_selfref_negative_anh_đừng_lại_gần")


def test_selfref_negative_hắn_nói_dối():
    assert detect_self_reference_gender("Hắn nói dối.") is None
    print("✓ test_selfref_negative_hắn_nói_dối")


def test_selfref_empty_input():
    assert detect_self_reference_gender("") is None
    assert detect_self_reference_gender(None) is None
    assert detect_self_reference_gender("Xin chào.") is None
    print("✓ test_selfref_empty_input")


def test_selfref_ambiguous_both_patterns():
    """Cả 2 pattern khớp → None (ambiguous)."""
    text = "Tôi là cha. Tôi là mẹ nó."
    assert detect_self_reference_gender(text) is None
    print("✓ test_selfref_ambiguous_both_patterns")


# ── Batch entry: detect_all_character_genders ────────────────────

def test_batch_mutates_profiles():
    """detect_all_character_genders apply_to_profiles=True → mutate registry."""
    registry = CharacterRegistry(
        project_id="t",
        characters={
            "CHAR_000": CharacterProfile(
                character_id="CHAR_000",
                source_speakers=["SPEAKER_00"],
            ),
            "CHAR_001": CharacterProfile(
                character_id="CHAR_001",
                source_speakers=["SPEAKER_01"],
            ),
        },
    )
    decisions, conflicts = detect_all_character_genders(
        registry=registry,
        audio_speaker_genders={"SPEAKER_00": "male", "SPEAKER_01": "female"},
        audio_speaker_gender_confs={"SPEAKER_00": 0.85, "SPEAKER_01": 0.80},
    )
    assert len(decisions) == 2
    assert registry.characters["CHAR_000"].gender == "male"
    assert registry.characters["CHAR_000"].gender_confidence == 0.85
    assert registry.characters["CHAR_001"].gender == "female"
    assert len(conflicts) == 0
    print(f"✓ test_batch_mutates_profiles — {len(decisions)} decisions")


def test_batch_logs_conflict():
    """audio + face disagree → GenderConflict logged."""
    registry = CharacterRegistry(
        project_id="t",
        characters={
            "CHAR_000": CharacterProfile(
                character_id="CHAR_000",
                source_speakers=["SPEAKER_00"],
            ),
        },
    )
    decisions, conflicts = detect_all_character_genders(
        registry=registry,
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_gender_confs={"SPEAKER_00": 0.85},
        face_track_to_speaker={0: "SPEAKER_00"},
        face_genders={0: "female"},
        face_gender_confs={0: 0.70},
    )
    assert len(conflicts) == 1
    assert conflicts[0].audio_gender == "male"
    assert conflicts[0].face_gender == "female"
    assert conflicts[0].decision == "male"  # audio strong wins
    print(f"✓ test_batch_logs_conflict — {len(conflicts)} conflict")


def test_batch_face_track_not_mapped_drops_face():
    """Char không có face_track mapping → face_track_stable=False → drop face."""
    registry = CharacterRegistry(
        project_id="t",
        characters={
            "CHAR_000": CharacterProfile(
                character_id="CHAR_000",
                source_speakers=["SPEAKER_00"],
            ),
        },
    )
    decisions, _ = detect_all_character_genders(
        registry=registry,
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_gender_confs={"SPEAKER_00": 0.85},
        face_track_to_speaker={},  # KHÔNG có mapping → face không stable
        face_genders={0: "female"},
        face_gender_confs={0: 0.99},
    )
    d = decisions["CHAR_000"]
    assert d.final_gender == "male"  # face female dropped
    assert d.decision_reason == REASON_AUDIO_ONLY
    print("✓ test_batch_face_track_not_mapped_drops_face")


def test_batch_self_ref_via_character_texts():
    """character_texts → pattern match → boost."""
    registry = CharacterRegistry(
        project_id="t",
        characters={
            "CHAR_000": CharacterProfile(
                character_id="CHAR_000",
                source_speakers=["SPEAKER_00"],
            ),
        },
    )
    decisions, _ = detect_all_character_genders(
        registry=registry,
        audio_speaker_genders={"SPEAKER_00": "male"},
        audio_speaker_gender_confs={"SPEAKER_00": 0.65},
        character_texts={"CHAR_000": ["Tôi là cha của nó.", "Cha về rồi đây."]},
    )
    d = decisions["CHAR_000"]
    assert d.final_gender == "male"
    assert d.self_ref_boost_applied is True
    assert d.final_confidence == 0.75  # 0.65 + 0.10
    print(f"✓ test_batch_self_ref_via_character_texts — conf={d.final_confidence}")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_fusion_audio_only,
        test_fusion_face_only,
        test_fusion_audio_face_agree_boost,
        test_fusion_agree_boost_capped_at_095,
        test_fusion_disagree_audio_strong_wins,
        test_fusion_disagree_audio_weak_unknown,
        test_fusion_selfref_boost_positive,
        test_fusion_selfref_boost_capped,
        test_fusion_selfref_mismatch_does_not_override,
        test_fusion_no_signal,
        test_fusion_face_not_stable_dropped,
        test_fusion_tier_high_medium_unknown,
        # Pattern match
        test_selfref_tôi_là_cha,
        test_selfref_tôi_là_mẹ,
        test_selfref_cha_đây,
        test_selfref_mẹ_đã_về,
        test_selfref_tôi_là_đàn_ông,
        test_selfref_negative_cô_ấy_đợi_ngài,
        test_selfref_negative_anh_đừng_lại_gần,
        test_selfref_negative_hắn_nói_dối,
        test_selfref_empty_input,
        test_selfref_ambiguous_both_patterns,
        # Batch
        test_batch_mutates_profiles,
        test_batch_logs_conflict,
        test_batch_face_track_not_mapped_drops_face,
        test_batch_self_ref_via_character_texts,
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
    ok = main()
    sys.exit(0 if ok else 1)
