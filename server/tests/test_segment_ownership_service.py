"""Unit tests for segment_ownership_service (Phase 6 audit refactor).

Test coverage rule priority 1-5 + edge cases:
  1. Short segment → low_confidence keep
  1b. Low quality embedding → low_confidence keep
  1c. No segment embedding → low_confidence keep
  2. Best gap > 0.20 + best ≥ 0.70 → reassign_strong
  3. Assigned sim ≥ 0.70 → kept_high_conf
  4. Assigned sim < 0.50 → low_conf_keep
  5. 0.50 ≤ assigned sim < 0.70 → medium_conf_keep

Plus:
  - build_character_embeddings: mean of sources
  - validate_segments_batch: apply_decisions mutates segments
  - extract_speaker_embeddings_from_pipeline: group + L2 normalize
  - No assigned + best strong → reassign-like behavior
  - Empty character_embeddings → no_character_embedding

Chạy: python -m pytest server/tests/test_segment_ownership_service.py -v
"""
from __future__ import annotations

import numpy as np

from app.models.character_schemas import CharacterProfile, CharacterRegistry
from app.services.segment_ownership_service import (
    REASON_KEPT_HIGH_CONF,
    REASON_LOW_CONF_KEEP,
    REASON_LOW_QUALITY_EMBEDDING_KEEP,
    REASON_MEDIUM_CONF_KEEP,
    REASON_NO_CHARACTER_EMBEDDING,
    REASON_NO_SEGMENT_EMBEDDING,
    REASON_REASSIGNED_STRONG,
    REASON_SHORT_SEGMENT_KEEP,
    build_character_embeddings,
    extract_speaker_embeddings_from_pipeline,
    validate_segment_ownership,
    validate_segments_batch,
)


# ── Helpers ──────────────────────────────────────────────────────

def _l2(vec: list[float]) -> np.ndarray:
    arr = np.asarray(vec, dtype=np.float32)
    n = np.linalg.norm(arr)
    return arr / n if n > 0 else arr


# ── Rule 1a: SHORT_SEGMENT ───────────────────────────────────────

def test_rule_1a_short_segment_keep():
    """duration < 0.5s → REASON_SHORT_SEGMENT_KEEP, tier=low."""
    seg = {"index": 0, "start": 0.0, "end": 0.3}  # 0.3s ngắn
    char_embs = {"CHAR_000": _l2([1.0, 0.0, 0.0])}
    seg_emb = _l2([1.0, 0.0, 0.0])  # match perfectly

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",
    )
    assert info.decision_reason == REASON_SHORT_SEGMENT_KEEP
    assert info.confidence_tier == "low"
    assert info.assigned_character_id == "CHAR_000"  # giữ assignment
    assert info.ownership_confidence == 0.0  # short → không tính sim
    print(f"✓ test_rule_1a_short_segment_keep — reason={info.decision_reason}")


# ── Rule 1b: LOW_QUALITY_EMBEDDING ───────────────────────────────

def test_rule_1b_low_quality_embedding_keep():
    """quality < 0.3 → REASON_LOW_QUALITY_EMBEDDING_KEEP."""
    seg = {"index": 1, "start": 0.0, "end": 5.0}  # đủ dài
    char_embs = {"CHAR_000": _l2([1.0, 0.0, 0.0])}
    seg_emb = _l2([1.0, 0.0, 0.0])

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",
        segment_embedding_quality=0.2,  # < 0.3
    )
    assert info.decision_reason == REASON_LOW_QUALITY_EMBEDDING_KEEP
    assert info.confidence_tier == "low"
    print("✓ test_rule_1b_low_quality_embedding_keep")


# ── Rule 1c: NO_SEGMENT_EMBEDDING ────────────────────────────────

def test_rule_1c_no_segment_embedding():
    """segment_embedding=None → REASON_NO_SEGMENT_EMBEDDING."""
    seg = {"index": 2, "start": 0.0, "end": 5.0}
    char_embs = {"CHAR_000": _l2([1.0, 0.0, 0.0])}

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=None,
        assigned_character_id="CHAR_000",
    )
    assert info.decision_reason == REASON_NO_SEGMENT_EMBEDDING
    assert info.confidence_tier == "low"
    print("✓ test_rule_1c_no_segment_embedding")


# ── Rule 2: REASSIGN_STRONG ──────────────────────────────────────

def test_rule_2_reassign_strong():
    """Best - assigned > 0.20 và best ≥ 0.70 → reassign sang best."""
    seg = {"index": 3, "start": 0.0, "end": 5.0}
    # seg_emb gần CHAR_001 hơn CHAR_000
    seg_emb = _l2([0.0, 1.0, 0.0])
    char_embs = {
        "CHAR_000": _l2([1.0, 0.1, 0.0]),  # sim ~ 0.1
        "CHAR_001": _l2([0.0, 1.0, 0.0]),  # sim ~ 1.0 (best)
    }

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",  # gán SAI ban đầu
    )
    assert info.decision_reason == REASON_REASSIGNED_STRONG
    assert info.assigned_character_id == "CHAR_001"  # reassign
    assert info.confidence_tier == "high"
    assert info.ownership_confidence >= 0.99
    print(f"✓ test_rule_2_reassign_strong — {info.assigned_character_id}, "
          f"conf={info.ownership_confidence}")


def test_rule_2_no_reassign_if_gap_small():
    """Best - assigned ≤ 0.20 → KHÔNG reassign dù best cao."""
    seg = {"index": 4, "start": 0.0, "end": 5.0}
    # seg_emb gần cả 2 (gap nhỏ)
    seg_emb = _l2([1.0, 0.8, 0.0])  # angle nhỏ với cả 2
    char_embs = {
        "CHAR_000": _l2([1.0, 0.7, 0.0]),
        "CHAR_001": _l2([1.0, 0.9, 0.0]),
    }
    # Tính trước: assigned=CHAR_000, sims gần nhau

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",
    )
    # Gap nhỏ → KHÔNG reassign → rule 3 (kept_high_conf) trigger
    assert info.decision_reason in (REASON_KEPT_HIGH_CONF, REASON_MEDIUM_CONF_KEEP)
    assert info.assigned_character_id == "CHAR_000"  # giữ assignment
    print(f"✓ test_rule_2_no_reassign_if_gap_small — kept {info.decision_reason}")


# ── Rule 3: KEPT_HIGH_CONF ───────────────────────────────────────

def test_rule_3_kept_high_conf():
    """assigned_sim ≥ 0.70 và không bị reassign → kept_high_conf."""
    seg = {"index": 5, "start": 0.0, "end": 5.0}
    seg_emb = _l2([1.0, 0.0, 0.0])
    char_embs = {
        "CHAR_000": _l2([1.0, 0.05, 0.0]),  # sim ~ 0.999
        # Không có char khác → best = assigned → không reassign
    }

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",
    )
    assert info.decision_reason == REASON_KEPT_HIGH_CONF
    assert info.confidence_tier == "high"
    assert info.ownership_confidence >= 0.70
    print(f"✓ test_rule_3_kept_high_conf — conf={info.ownership_confidence}")


# ── Rule 4: LOW_CONF_KEEP ────────────────────────────────────────

def test_rule_4_low_conf_keep():
    """assigned_sim < 0.50 (rule 2 không trigger) → low_conf_keep."""
    seg = {"index": 6, "start": 0.0, "end": 5.0}
    # seg_emb mismatch với CHAR_000 (assigned) sim ~ 0.3
    seg_emb = _l2([0.3, 0.95, 0.0])
    char_embs = {
        "CHAR_000": _l2([1.0, 0.0, 0.0]),  # sim ~ 0.3
        # Best = CHAR_000 vẫn (chỉ 1 char). Best sim ~ 0.3 < 0.70 → no reassign
    }

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",
    )
    assert info.decision_reason == REASON_LOW_CONF_KEEP
    assert info.confidence_tier == "low"
    assert info.assigned_character_id == "CHAR_000"  # vẫn giữ
    print(f"✓ test_rule_4_low_conf_keep — conf={info.ownership_confidence}")


# ── Rule 5: MEDIUM_CONF_KEEP ─────────────────────────────────────

def test_rule_5_medium_conf_keep():
    """0.50 ≤ assigned_sim < 0.70 → medium_conf_keep."""
    seg = {"index": 7, "start": 0.0, "end": 5.0}
    # seg_emb mid match sim ~ 0.6
    seg_emb = _l2([0.6, 0.8, 0.0])
    char_embs = {
        "CHAR_000": _l2([1.0, 0.0, 0.0]),  # cos = 0.6
    }

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id="CHAR_000",
    )
    assert info.decision_reason == REASON_MEDIUM_CONF_KEEP
    assert info.confidence_tier == "medium"
    assert 0.50 <= info.ownership_confidence < 0.70
    print(f"✓ test_rule_5_medium_conf_keep — conf={info.ownership_confidence}")


# ── Edge cases ───────────────────────────────────────────────────

def test_empty_character_embeddings():
    """character_embeddings={} → REASON_NO_CHARACTER_EMBEDDING."""
    seg = {"index": 8, "start": 0.0, "end": 5.0}
    info = validate_segment_ownership(
        segment=seg,
        character_embeddings={},
        segment_embedding=_l2([1.0, 0.0]),
        assigned_character_id="CHAR_000",
    )
    assert info.decision_reason == REASON_NO_CHARACTER_EMBEDDING
    assert info.confidence_tier == "low"
    print("✓ test_empty_character_embeddings")


def test_no_assigned_strong_best_reassign():
    """assigned=None + best ≥ 0.70 → assign best, mark reassigned_strong."""
    seg = {"index": 9, "start": 0.0, "end": 5.0}
    seg_emb = _l2([1.0, 0.0, 0.0])
    char_embs = {"CHAR_000": _l2([1.0, 0.05, 0.0])}

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id=None,
    )
    assert info.assigned_character_id == "CHAR_000"
    assert info.decision_reason == REASON_REASSIGNED_STRONG
    print("✓ test_no_assigned_strong_best_reassign")


def test_no_assigned_weak_best_medium():
    """assigned=None + best mid → assign best, medium tier (fallback)."""
    seg = {"index": 10, "start": 0.0, "end": 5.0}
    seg_emb = _l2([0.6, 0.8, 0.0])
    char_embs = {"CHAR_000": _l2([1.0, 0.0, 0.0])}  # sim 0.6

    info = validate_segment_ownership(
        segment=seg,
        character_embeddings=char_embs,
        segment_embedding=seg_emb,
        assigned_character_id=None,
    )
    assert info.assigned_character_id == "CHAR_000"
    assert info.decision_reason == REASON_MEDIUM_CONF_KEEP
    print("✓ test_no_assigned_weak_best_medium")


# ── build_character_embeddings ───────────────────────────────────

def test_build_character_embeddings_mean():
    """Char với 2 source speakers → mean rồi L2 normalize."""
    emb_a = _l2([1.0, 0.0, 0.0])
    emb_b = _l2([0.95, 0.31, 0.0])  # gần emb_a
    registry = CharacterRegistry(
        project_id="t",
        characters={
            "CHAR_000": CharacterProfile(
                character_id="CHAR_000",
                source_speakers=["SPEAKER_00", "SPEAKER_01"],
            ),
        },
    )
    char_embs = build_character_embeddings(
        registry,
        {"SPEAKER_00": emb_a, "SPEAKER_01": emb_b},
    )
    assert "CHAR_000" in char_embs
    # L2-normalized: norm ~ 1
    assert abs(np.linalg.norm(char_embs["CHAR_000"]) - 1.0) < 1e-5
    print("✓ test_build_character_embeddings_mean")


def test_build_character_embeddings_missing_source():
    """Char có 0 source embedding → skip char."""
    registry = CharacterRegistry(
        project_id="t",
        characters={
            "CHAR_000": CharacterProfile(
                character_id="CHAR_000",
                source_speakers=["SPEAKER_99"],  # không có trong dict
            ),
        },
    )
    char_embs = build_character_embeddings(registry, {})
    assert "CHAR_000" not in char_embs
    print("✓ test_build_character_embeddings_missing_source")


# ── validate_segments_batch ──────────────────────────────────────

def test_validate_segments_batch_apply_decisions():
    """Batch mutate seg["character_id"], seg["ownership_*"]."""
    seg0 = {"index": 0, "start": 0.0, "end": 5.0, "character_id": "CHAR_000"}
    seg1 = {"index": 1, "start": 0.0, "end": 5.0, "character_id": "CHAR_000"}  # should reassign
    seg2 = {"index": 2, "start": 0.0, "end": 0.2}  # short — no character_id
    segments = [seg0, seg1, seg2]

    char_embs = {
        "CHAR_000": _l2([1.0, 0.0, 0.0]),
        "CHAR_001": _l2([0.0, 1.0, 0.0]),
    }
    seg_embs = {
        0: (_l2([1.0, 0.0, 0.0]), 0.9),  # match CHAR_000 → kept_high
        1: (_l2([0.0, 1.0, 0.0]), 0.9),  # match CHAR_001 → reassign
        # seg2 không có embedding → rule 1a (short) thắng
    }
    registry = CharacterRegistry(project_id="t")

    infos, warnings = validate_segments_batch(
        segments=segments,
        character_embeddings=char_embs,
        segment_embeddings=seg_embs,
        registry=registry,
    )
    assert len(infos) == 3
    assert seg0["character_id"] == "CHAR_000"  # giữ
    assert seg0["ownership_tier"] == "high"
    assert seg1["character_id"] == "CHAR_001"  # reassigned
    assert seg1["ownership_decision_reason"] == REASON_REASSIGNED_STRONG
    assert seg2["ownership_decision_reason"] == REASON_SHORT_SEGMENT_KEEP

    # Warnings: seg1 (reassigned) + seg2 (low_tier short)
    assert len(warnings) >= 2
    print(f"✓ test_validate_segments_batch_apply_decisions — "
          f"{len(infos)} infos, {len(warnings)} warnings")


def test_validate_segments_batch_dry_run():
    """apply_decisions=False → không mutate."""
    seg0 = {"index": 0, "start": 0.0, "end": 5.0, "character_id": "CHAR_000"}
    char_embs = {"CHAR_000": _l2([1.0, 0.0, 0.0])}
    seg_embs = {0: (_l2([1.0, 0.0, 0.0]), 0.9)}
    infos, _ = validate_segments_batch(
        segments=[seg0],
        character_embeddings=char_embs,
        segment_embeddings=seg_embs,
        registry=CharacterRegistry(project_id="t"),
        apply_decisions=False,
    )
    assert "ownership_confidence" not in seg0
    assert "ownership_tier" not in seg0
    assert infos[0].confidence_tier == "high"  # info vẫn computed
    print("✓ test_validate_segments_batch_dry_run")


# ── extract_speaker_embeddings_from_pipeline ─────────────────────

class _FakeSpeakerEmb:
    def __init__(self, speaker_id, vector, quality=1.0):
        self.speaker_id = speaker_id
        self.vector = vector
        self.quality = quality


def test_extract_speaker_embeddings_average_multiple_turns():
    """1 speaker xuất hiện 2 turns → average + L2 norm."""
    embs = [
        _FakeSpeakerEmb("SPEAKER_00", np.array([1.0, 0.0, 0.0], dtype=np.float32)),
        _FakeSpeakerEmb("SPEAKER_00", np.array([0.9, 0.1, 0.0], dtype=np.float32)),
        _FakeSpeakerEmb("SPEAKER_01", np.array([0.0, 1.0, 0.0], dtype=np.float32)),
    ]
    out = extract_speaker_embeddings_from_pipeline(embs)
    assert set(out.keys()) == {"SPEAKER_00", "SPEAKER_01"}
    # L2-normalized
    assert abs(np.linalg.norm(out["SPEAKER_00"]) - 1.0) < 1e-5
    assert abs(np.linalg.norm(out["SPEAKER_01"]) - 1.0) < 1e-5
    print("✓ test_extract_speaker_embeddings_average_multiple_turns")


def test_extract_speaker_embeddings_empty():
    assert extract_speaker_embeddings_from_pipeline([]) == {}
    assert extract_speaker_embeddings_from_pipeline(None) == {}
    print("✓ test_extract_speaker_embeddings_empty")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_rule_1a_short_segment_keep,
        test_rule_1b_low_quality_embedding_keep,
        test_rule_1c_no_segment_embedding,
        test_rule_2_reassign_strong,
        test_rule_2_no_reassign_if_gap_small,
        test_rule_3_kept_high_conf,
        test_rule_4_low_conf_keep,
        test_rule_5_medium_conf_keep,
        test_empty_character_embeddings,
        test_no_assigned_strong_best_reassign,
        test_no_assigned_weak_best_medium,
        test_build_character_embeddings_mean,
        test_build_character_embeddings_missing_source,
        test_validate_segments_batch_apply_decisions,
        test_validate_segments_batch_dry_run,
        test_extract_speaker_embeddings_average_multiple_turns,
        test_extract_speaker_embeddings_empty,
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
