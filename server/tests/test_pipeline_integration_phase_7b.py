"""Integration test simulate full Phase 5-7b data flow.

Cover what manual e2e smoke test would check, but mock-driven (no GPU/audio
required) so có thể chạy CI hoặc dev box. KHÔNG thay thế end-to-end test
trên video thật — chỉ verify pipeline INVARIANTS:

  I1. fuse_speakers KHÔNG emit CHAR_XX 2-digit (Option B Phase 7b).
  I2. character_registry produce CHAR_XXX 3-digit single namespace.
  I3. assign_character_ids_to_segments tag seg["character_id"] đúng.
  I4. gender_detection_service mutate CharacterProfile (not per-segment field
      trực tiếp).
  I5. voice_map keyed by character_id (registry path), keyspace marker set.
  I6. NO CHAR_XX 2-digit ANYWHERE in final project meta JSON.
  I7. seg["speaker_gender"] FINAL = CharacterProfile.gender (post-fusion),
      NOT raw F0 stale.
  I8. Backward compat: face-only path produces FACE_XX voice_map.

Cách build mock data: tạo synthetic embeddings cho 2 speakers (male + female),
2 face IDs match, run full chain. Check tất cả output fields.

Chạy: PYTHONPATH=. python tests/test_pipeline_integration_phase_7b.py
"""
from __future__ import annotations

import json
import re

import numpy as np

from app.models.character_schemas import CharacterProfile, CharacterRegistry
from app.services.character_registry_service import (
    assign_character_ids_to_segments,
    build_character_registry,
)
from app.services.gender_detection_service import detect_all_character_genders
from app.services.multimodal_speaker_svc import fuse_speakers
from app.services.segment_ownership_service import (
    build_character_embeddings,
    extract_speaker_embeddings_from_pipeline,
)
from app.services.speaker_pipeline.types import SpeakerEmbedding


# ── Helpers ──────────────────────────────────────────────────────

def _l2(vec):
    arr = np.asarray(vec, dtype=np.float32)
    n = float(np.linalg.norm(arr))
    return arr / n if n > 1e-9 else arr


def _make_synthetic_pipeline_data():
    """Build mock sp_result-like data + face_result-like data + segments.

    Scenario: 2 characters (1 nam, 1 nữ), 4 segments (2 mỗi character),
    pyannote nhận diện đúng, face detection map đúng 1-1.
    """
    # Speaker embeddings — 2 raw speakers, perpendicular vectors
    emb_male = _l2([1.0, 0.0, 0.0, 0.0])
    emb_female = _l2([0.0, 1.0, 0.0, 0.0])

    sp_embeddings = [
        SpeakerEmbedding("SPEAKER_00", 0.0, 5.0, emb_male, quality=0.85),
        SpeakerEmbedding("SPEAKER_00", 10.0, 15.0, emb_male, quality=0.85),
        SpeakerEmbedding("SPEAKER_01", 5.0, 10.0, emb_female, quality=0.80),
        SpeakerEmbedding("SPEAKER_01", 15.0, 20.0, emb_female, quality=0.80),
    ]

    # Segments — 4 segments, 2 per speaker, all có audio + face
    merged_segments = [
        {"index": 0, "start": 0.0, "end": 5.0, "text": "Tôi là cha của thằng bé.",
         "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.85},
        {"index": 1, "start": 5.0, "end": 10.0, "text": "Mẹ đã về rồi con.",
         "audio_speaker": "SPEAKER_01", "face_id": "FACE_01", "face_confidence": 0.85},
        {"index": 2, "start": 10.0, "end": 15.0, "text": "Anh đứng lại đó.",
         "audio_speaker": "SPEAKER_00", "face_id": "FACE_00", "face_confidence": 0.85},
        {"index": 3, "start": 15.0, "end": 20.0, "text": "Em xin lỗi anh.",
         "audio_speaker": "SPEAKER_01", "face_id": "FACE_01", "face_confidence": 0.85},
    ]

    speaker_genders = {"SPEAKER_00": "male", "SPEAKER_01": "female"}
    speaker_gender_confs = {"SPEAKER_00": 0.85, "SPEAKER_01": 0.80}

    face_genders = {0: "male", 1: "female"}
    face_gender_confs = {0: 0.90, 1: 0.88}

    return {
        "sp_embeddings": sp_embeddings,
        "speakers": ["SPEAKER_00", "SPEAKER_01"],
        "merged": merged_segments,
        "speaker_genders": speaker_genders,
        "speaker_gender_confs": speaker_gender_confs,
        "face_genders": face_genders,
        "face_gender_confs": face_gender_confs,
    }


# ── I1: fuse_speakers Option B ───────────────────────────────────

def test_i1_fuse_speakers_no_char_xx_2digit():
    """INVARIANT 1: seg["speaker"] after fusion = SPEAKER_XX or FACE_XX,
    KHÔNG CHAR_XX 2-digit."""
    data = _make_synthetic_pipeline_data()

    # Compute audio_confs from embedding quality (Phase 6 fix)
    from collections import defaultdict
    qual_acc = defaultdict(list)
    for emb in data["sp_embeddings"]:
        qual_acc[emb.speaker_id].append(emb.quality)
    audio_confs = {spk: sum(qs) / len(qs) for spk, qs in qual_acc.items()}

    fusion = fuse_speakers(
        segments=data["merged"],
        face_genders=data["face_genders"],
        face_gender_confs=data["face_gender_confs"],
        audio_speaker_genders=data["speaker_genders"],
        audio_speaker_confidences=audio_confs,
    )

    char_xx_pattern = re.compile(r"^CHAR_\d{2}$")
    for seg in data["merged"]:
        spk = seg.get("speaker")
        assert spk is not None
        assert not char_xx_pattern.match(spk), \
            f"I1 VIOLATION: seg[{seg['index']}].speaker = {spk} (CHAR_XX 2-digit leak!)"

    # fusion.char_genders should be keyed by raw IDs
    for key in fusion.char_genders.keys():
        assert not char_xx_pattern.match(key), \
            f"I1 VIOLATION: fusion.char_genders has CHAR_XX key: {key}"

    assert fusion.stats.get("namespace") == "raw_ids_phase_7b"
    print(f"✓ I1 fuse_speakers Option B — speakers: "
          f"{[s['speaker'] for s in data['merged']]}, "
          f"fusion.char_genders keys: {list(fusion.char_genders.keys())}")


# ── I2 + I3: character_registry + assign ─────────────────────────

def test_i2_i3_character_registry_produces_char_xxx():
    """INVARIANT 2: registry char_ids are CHAR_XXX (3-digit).
    INVARIANT 3: assign_character_ids tags seg["character_id"]."""
    data = _make_synthetic_pipeline_data()

    # Run fusion first (mutates merged)
    audio_confs = {"SPEAKER_00": 0.85, "SPEAKER_01": 0.80}
    fusion = fuse_speakers(
        segments=data["merged"],
        face_genders=data["face_genders"],
        face_gender_confs=data["face_gender_confs"],
        audio_speaker_genders=data["speaker_genders"],
        audio_speaker_confidences=audio_confs,
    )

    # Build registry (audio path)
    speaker_embeddings_dict = extract_speaker_embeddings_from_pipeline(
        data["sp_embeddings"],
    )
    speaker_segments_dict = {}
    for seg in data["merged"]:
        spk = seg.get("audio_speaker")
        if spk:
            speaker_segments_dict.setdefault(spk, []).append({
                "start": seg["start"], "end": seg["end"],
            })

    registry = build_character_registry(
        project_id="integration_test",
        raw_speakers=data["speakers"],
        speaker_embeddings=speaker_embeddings_dict,
        speaker_segments=speaker_segments_dict,
        speaker_genders=data["speaker_genders"],
        speaker_gender_confs=data["speaker_gender_confs"],
        face_track_to_speaker={
            face_int: audio_spk
            for audio_spk, face_int in fusion.audio_to_face.items()
        },
    )

    # I2: char_ids are CHAR_XXX (3-digit)
    char_xxx_pattern = re.compile(r"^CHAR_\d{3}$")
    for char_id in registry.characters.keys():
        assert char_xxx_pattern.match(char_id), \
            f"I2 VIOLATION: char_id format wrong: {char_id} (expected CHAR_XXX)"

    # 2 perpendicular embeddings → 2 separate characters
    assert len(registry.characters) == 2, \
        f"Expected 2 chars (perpendicular embs), got {len(registry.characters)}"

    # I3: assign_character_ids tags seg["character_id"]
    n_assigned = assign_character_ids_to_segments(
        data["merged"], registry, raw_speaker_field="audio_speaker",
    )
    assert n_assigned == 4, f"Expected 4 assigned, got {n_assigned}"

    for seg in data["merged"]:
        cid = seg.get("character_id")
        assert cid is not None
        assert char_xxx_pattern.match(cid), \
            f"I3 VIOLATION: seg[{seg['index']}].character_id = {cid} not CHAR_XXX"

    print(f"✓ I2+I3 registry+assign — chars: {list(registry.characters.keys())}, "
          f"all segments tagged character_id")
    return registry, data, fusion


# ── I4: gender_detection mutates CharacterProfile ────────────────

def test_i4_gender_detection_mutates_profile():
    """INVARIANT 4: detect_all_character_genders mutates CharacterProfile.gender
    + .gender_confidence, NOT per-segment seg["speaker_gender"]."""
    registry, data, fusion = test_i2_i3_character_registry_produces_char_xxx()

    # Snapshot before
    before = {
        cid: (p.gender, p.gender_confidence)
        for cid, p in registry.characters.items()
    }

    # Build character_texts
    char_texts = {}
    for seg in data["merged"]:
        cid = seg.get("character_id")
        if cid and seg.get("text"):
            char_texts.setdefault(cid, []).append(seg["text"])

    decisions, conflicts = detect_all_character_genders(
        registry=registry,
        audio_speaker_genders=data["speaker_genders"],
        audio_speaker_gender_confs=data["speaker_gender_confs"],
        face_track_to_speaker={
            face_int: audio_spk
            for audio_spk, face_int in fusion.audio_to_face.items()
        },
        face_genders=data["face_genders"],
        face_gender_confs=data["face_gender_confs"],
        character_texts=char_texts,
        apply_to_profiles=True,
    )

    # I4: CharacterProfile.gender mutated (audio + face AGREE → high conf)
    for cid, profile in registry.characters.items():
        # Both male/female cases should be HIGH tier after fusion
        assert profile.gender in ("male", "female"), \
            f"I4 VIOLATION: profile.gender = {profile.gender}"
        assert profile.gender_confidence >= 0.80, \
            f"I4 VIOLATION: gender_confidence too low: {profile.gender_confidence}"
        # AGREE case: should boost ≥ max(0.85, 0.90) + 0.05 = 0.95 or self-ref +0.10 cap
        assert profile.gender_confidence >= 0.85

    # Check self-ref boost applied
    # Seg 0 "Tôi là cha" → male self-ref
    # Seg 1 "Mẹ đã về rồi con" → female self-ref
    male_decision = next(d for d in decisions.values() if d.final_gender == "male")
    female_decision = next(d for d in decisions.values() if d.final_gender == "female")
    assert male_decision.self_ref_boost_applied is True, \
        "Male char: 'Tôi là cha' should have triggered self-ref boost"
    assert female_decision.self_ref_boost_applied is True, \
        "Female char: 'Mẹ đã về' should have triggered self-ref boost"

    # Conflicts should be 0 (audio + face AGREE for both)
    assert len(conflicts) == 0

    print(f"✓ I4 gender_detection — male={male_decision.final_confidence}, "
          f"female={female_decision.final_confidence}, "
          f"both self_ref_boost_applied, conflicts=0")
    return registry, data


# ── I5: voice_map keyed by character_id ──────────────────────────

def test_i5_voice_map_keyspace_character_id():
    """INVARIANT 5: voice_map keys = CHAR_XXX (registry path),
    keyspace marker = 'character_id'.

    Simulate the unified voice_map build block từ dubbing_svc Phase 7b."""
    registry, data = test_i4_gender_detection_mutates_profile()

    from app.services.speaker_pipeline import build_speaker_voice_map

    # Simulate project meta dict
    project = {"voice_slots": ["voice_male_A", "voice_female_B"]}

    # Phase 7b unified voice_map (registry path)
    char_speakers = sorted(registry.characters.keys())
    char_genders_for_map = {
        cid: p.gender for cid, p in registry.characters.items()
    }
    char_gender_confs_for_map = {
        cid: float(p.gender_confidence) for cid, p in registry.characters.items()
    }

    voice_map = build_speaker_voice_map(
        speakers=char_speakers,
        voice_slots=project["voice_slots"],
        user_overrides={},
        speaker_genders=char_genders_for_map,
        gender_confidences=char_gender_confs_for_map,
    )
    project["speaker_voice_map"] = voice_map
    project["voice_map_keyspace"] = "character_id"

    # I5: voice_map keys = CHAR_XXX
    char_xxx_pattern = re.compile(r"^CHAR_\d{3}$")
    for key in voice_map.keys():
        assert char_xxx_pattern.match(key), \
            f"I5 VIOLATION: voice_map key not CHAR_XXX: {key}"

    assert project["voice_map_keyspace"] == "character_id"
    print(f"✓ I5 voice_map keyspace — {voice_map}")
    return project, registry, data


# ── I6: no CHAR_XX 2-digit ANYWHERE in project meta ──────────────

def test_i6_no_char_xx_2digit_in_meta():
    """INVARIANT 6: dump project meta to JSON → grep CHAR_XX 2-digit → 0 matches."""
    project, registry, data = test_i5_voice_map_keyspace_character_id()

    # Build full project meta như transcribe_project sẽ produce
    project["character_registry_summary"] = {
        "characters": [
            {
                "character_id": c.character_id,
                "source_speakers": c.source_speakers,
                "gender": c.gender,
                "gender_confidence": c.gender_confidence,
                "merge_confidence": c.merge_confidence,
                "review_required": c.review_required,
            }
            for c in registry.characters.values()
        ],
        "possible_merges": [pm.model_dump() for pm in registry.possible_merges],
    }
    project["segments"] = [
        {
            "index": seg["index"],
            "start": seg["start"], "end": seg["end"],
            "speaker": seg.get("speaker"),
            "character_id": seg.get("character_id"),
        }
        for seg in data["merged"]
    ]

    # Serialize to JSON and grep CHAR_XX 2-digit
    meta_json = json.dumps(project, default=str)
    matches = re.findall(r"CHAR_\d{2}(?!\d)", meta_json)
    assert len(matches) == 0, \
        f"I6 VIOLATION: found {len(matches)} CHAR_XX 2-digit in meta: {set(matches)}"

    # Sanity: CHAR_XXX (3-digit) should be present
    char_xxx_matches = re.findall(r"CHAR_\d{3}", meta_json)
    assert len(char_xxx_matches) > 0, "Expected CHAR_XXX present in meta"

    print(f"✓ I6 NO CHAR_XX 2-digit leak — meta JSON length={len(meta_json)}, "
          f"CHAR_XXX count={len(char_xxx_matches)}")
    return project, registry, data


# ── I7: seg["speaker_gender"] = CharacterProfile.gender ──────────

def test_i7_seg_speaker_gender_from_character_profile():
    """INVARIANT 7: final seg["speaker_gender"] derived from
    CharacterProfile.gender (not stale raw F0)."""
    project, registry, data = test_i6_no_char_xx_2digit_in_meta()

    # Simulate the final segments builder (line 2779 in dubbing_svc)
    final_segments = []
    for seg in data["merged"]:
        _cid = seg.get("character_id")
        _seg_gender = None
        if _cid and _cid in registry.characters:
            _seg_gender = registry.characters[_cid].gender
            if _seg_gender == "unknown":
                _seg_gender = None
        if _seg_gender is None:
            _raw = seg.get("speaker")
            _seg_gender = data["speaker_genders"].get(_raw)
            if _seg_gender == "unknown":
                _seg_gender = None
        final_segments.append({
            "index": seg["index"],
            "speaker": seg.get("speaker"),
            "character_id": _cid,
            "speaker_gender": _seg_gender,
        })

    # I7: every segment's speaker_gender matches the character profile
    for fs in final_segments:
        cid = fs["character_id"]
        expected = registry.characters[cid].gender
        actual = fs["speaker_gender"]
        assert actual == expected, \
            f"I7 VIOLATION: seg[{fs['index']}] character_id={cid} " \
            f"expected gender={expected}, got {actual}"

    # No segment has "unknown" gender (both chars fully resolved)
    assert all(fs["speaker_gender"] in ("male", "female") for fs in final_segments)
    print(f"✓ I7 seg.speaker_gender from CharacterProfile — "
          f"{[(fs['index'], fs['speaker_gender']) for fs in final_segments]}")


# ── I8: backward compat face-only path ───────────────────────────

def test_i8_face_only_path_face_xx_voice_map():
    """INVARIANT 8: face-only path (no pyannote sp_result) → voice_map
    keyed by FACE_XX raw IDs (fallback)."""
    # Face-only segments: audio_speaker = None, face_id set
    segments = [
        {"index": 0, "start": 0.0, "end": 5.0, "audio_speaker": None,
         "face_id": "FACE_00", "face_confidence": 0.85},
        {"index": 1, "start": 5.0, "end": 10.0, "audio_speaker": None,
         "face_id": "FACE_01", "face_confidence": 0.85},
    ]
    fusion = fuse_speakers(
        segments=segments,
        face_genders={0: "male", 1: "female"},
        face_gender_confs={0: 0.85, 1: 0.85},
    )
    # All segments should have FACE_XX speaker
    for seg in segments:
        spk = seg["speaker"]
        assert spk.startswith("FACE_"), \
            f"I8 VIOLATION: face-only seg[{seg['index']}].speaker = {spk}"

    # Simulate face-only voice_map build (no registry path)
    from app.services.speaker_pipeline import build_speaker_voice_map
    raw_keys = sorted(fusion.char_genders.keys())
    voice_map = build_speaker_voice_map(
        speakers=raw_keys,
        voice_slots=["voice_a", "voice_b"],
        user_overrides={},
        speaker_genders=fusion.char_genders,
        gender_confidences={k: 0.6 for k in raw_keys},
    )
    for k in voice_map.keys():
        assert k.startswith("FACE_"), \
            f"I8 VIOLATION: face-only voice_map key not FACE_XX: {k}"
    print(f"✓ I8 face-only path — voice_map keys: {list(voice_map.keys())}")


# ── Runner ───────────────────────────────────────────────────────

def main():
    tests = [
        test_i1_fuse_speakers_no_char_xx_2digit,
        # I2/I3/I4/I5/I6/I7 chained — each depends on previous
        test_i6_no_char_xx_2digit_in_meta,  # runs I2 → I3 → I4 → I5 → I6 transitively
        test_i7_seg_speaker_gender_from_character_profile,
        test_i8_face_only_path_face_xx_voice_map,
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
    print(f"═══ {passed}/{len(tests)} integration invariants passed, {failed} failed ═══")
    return failed == 0


if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)
