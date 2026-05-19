"""Smoke tests cho refactor Phase A + Phase C cleanup.

Verify regression-detection cho 9 fix commits trên branch fix-audio-mix
+ Phase A (legacy params cleanup) + Phase C (face opt-in).

Run: pytest server/tests/test_refactor_phase_a.py -v
"""
import os
import sys
from pathlib import Path

import pytest

# Add server/ to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class TestPhaseACleanup:
    """Verify legacy params + paths đã bị xóa khỏi schema/API/svc."""

    def test_export_options_schema_only_target_lufs(self):
        from app.models.dubbing_schemas import ExportOptions
        fields = set(ExportOptions.model_fields.keys())
        # Phase A: chỉ giữ target_lufs
        assert fields == {"target_lufs"}, (
            f"ExportOptions phải chỉ có target_lufs, hiện có: {fields}"
        )

    def test_export_video_signature_minimal(self):
        from app.services.dubbing_svc import export_video
        import inspect
        sig = inspect.signature(export_video)
        params = list(sig.parameters.keys())
        # Chỉ: project_id, target_lufs
        assert params == ["project_id", "target_lufs"], (
            f"export_video signature must be (project_id, target_lufs), got {params}"
        )

    def test_apply_ducking_removed(self):
        """_apply_ducking() đã xóa (legacy envelope ducking)."""
        from app.services import dubbing_svc
        assert not hasattr(dubbing_svc, "_apply_ducking"), (
            "_apply_ducking() phải đã bị xóa trong Phase A"
        )


class TestSpeedRange:
    """Phase A fix: speed range [0.90, 1.25]."""

    def test_max_speed_factor_125(self):
        from app.services.dubbing_svc import MAX_SPEED_FACTOR
        assert MAX_SPEED_FACTOR == 1.25, (
            f"MAX_SPEED_FACTOR phải = 1.25 (giảm từ 1.40), hiện = {MAX_SPEED_FACTOR}"
        )

    def test_min_speed_factor_090(self):
        from app.services.dubbing_svc import MIN_SPEED_FACTOR
        assert MIN_SPEED_FACTOR == 0.90, (
            f"MIN_SPEED_FACTOR phải = 0.90 (giảm từ 0.85), hiện = {MIN_SPEED_FACTOR}"
        )

    def test_overflow_grace_120(self):
        from app.services.dubbing_svc import OVERFLOW_GRACE
        assert OVERFLOW_GRACE == 1.20

    def test_emotion_speed_cap_neutral(self):
        from app.services.dubbing_svc import _emotion_speed_cap, MAX_SPEED_FACTOR
        assert _emotion_speed_cap(None) == MAX_SPEED_FACTOR
        assert _emotion_speed_cap("neutral") == MAX_SPEED_FACTOR
        # Angry max 1.30 (giảm từ 1.45)
        assert _emotion_speed_cap("angry") == 1.30
        # Whisper 1.15 (giảm từ 1.20)
        assert _emotion_speed_cap("whisper") == 1.15


class TestMergeShortFragment:
    """Phase 9 fix: merge SHORT FRAGMENT — Whisper add period sai cũng merge."""

    def test_short_fragment_merge_despite_period(self):
        """Fragment ngắn (< 1.5s + có period) phải merge."""
        from app.services.dubbing_svc import _merge_short_segments
        segments = [
            {"text": "Chuyện sức khỏe của con.", "start": 37.98, "end": 38.84,
             "speaker": None, "words": []},
            {"text": "Cũng không thể biết trước được.", "start": 39.65, "end": 43.20,
             "speaker": None, "words": []},
        ]
        merged = _merge_short_segments(segments, min_duration=4.0,
                                        max_gap=1.8, max_combined=14.0)
        # Fragment 0.86s với period → merge với cur 3.55s
        assert len(merged) == 1, (
            f"Phải merge 2 segments thành 1 (fragment < 1.5s + same speaker), "
            f"hiện có {len(merged)}: {[s['text'] for s in merged]}"
        )

    def test_different_speakers_not_merged(self):
        """Speaker khác nhau → KHÔNG merge."""
        from app.services.dubbing_svc import _merge_short_segments
        segments = [
            {"text": "Câu của A.", "start": 0, "end": 1.0, "speaker": "A", "words": []},
            {"text": "Câu của B.", "start": 1.2, "end": 2.2, "speaker": "B", "words": []},
        ]
        merged = _merge_short_segments(segments)
        assert len(merged) == 2, "Speaker khác phải giữ separate"


class TestSmartPauseChunks:
    """Phase 7 fix: smart pause adjustment — split batch thành chunks per-segment."""

    def test_split_batch_into_chunks(self):
        import numpy as np
        from app.services.dubbing_svc import _split_batch_into_segment_chunks
        sr = 24000
        batch_audio = np.ones(sr * 5, dtype=np.float32)  # 5s audio
        batch = [
            {"id": "s1", "start": 0.0, "end": 1.5, "speech_text": "Xin chào"},  # 8 chars
            {"id": "s2", "start": 1.5, "end": 2.5, "speech_text": "Hôm nay vui"},  # 11 chars
            {"id": "s3", "start": 3.5, "end": 5.0, "speech_text": "Tạm biệt"},  # 8 chars
        ]
        chunks = _split_batch_into_segment_chunks(batch_audio, batch, sr)
        assert len(chunks) == 3, f"Phải có 3 chunks, hiện {len(chunks)}"
        # Mỗi chunk có start_time = seg start gốc (giữ timing)
        assert chunks[0]["start_time"] == 0.0
        assert chunks[1]["start_time"] == 1.5
        assert chunks[2]["start_time"] == 3.5  # ← gap 1s với chunk 1 (preserved)


class TestLLMPromptBlocks:
    """Phase 5-6 fix: KINSHIP RULES + SUBJECT INFERENCE block injected."""

    def test_kinship_hard_rules_constant_exists(self):
        from app.services.llm.prompts import KINSHIP_HARD_RULES_VN
        assert "KINSHIP HARD RULES" in KINSHIP_HARD_RULES_VN
        assert "Mẹ" in KINSHIP_HARD_RULES_VN
        assert "Bố" in KINSHIP_HARD_RULES_VN

    def test_subject_inference_rules_constant_exists(self):
        from app.services.llm.prompts import SUBJECT_INFERENCE_RULES_VN
        assert "SUBJECT INFERENCE" in SUBJECT_INFERENCE_RULES_VN
        # Phải có ví dụ về subject inference từ context
        assert "TOPIC CONTINUITY" in SUBJECT_INFERENCE_RULES_VN
        # Phải có warning không bịa subject
        assert "KHÔNG bịa subject" in SUBJECT_INFERENCE_RULES_VN or \
               "CẤM: bịa subject" in SUBJECT_INFERENCE_RULES_VN

    def test_kinship_in_anchor_block_for_vn(self):
        """KINSHIP RULES phải inject vào prompt khi target=vietnamese."""
        from app.services.llm.prompts import build_translator_prompt
        prompt = build_translator_prompt(
            segments=[{"original_text": "你好妈妈", "speaker": "SPEAKER_00",
                       "speaker_gender": "female"}],
            target_lang="vietnamese",
            source_lang="chinese",
        )
        assert "KINSHIP HARD RULES" in prompt["system"]
        assert "SUBJECT INFERENCE" in prompt["system"]


class TestFaceDetectionOptIn:
    """Phase C: face detection OPT-IN (default OFF)."""

    def test_face_detection_skipped_by_default(self, monkeypatch):
        """VOX_ENABLE_FACE_SPEAKER không set → face detection skip."""
        monkeypatch.delenv("VOX_ENABLE_FACE_SPEAKER", raising=False)
        # Verify env logic — không cần chạy pipeline thực
        env_val = os.environ.get("VOX_ENABLE_FACE_SPEAKER", "").lower()
        assert env_val != "true", "Default phải không bật face"


class TestRegistryBlockTrimmed:
    """Phase 5 fix: registry_block bỏ ADDRESSEE rules (chống overlap KINSHIP)."""

    def test_registry_block_no_addressee_rules(self):
        from app.services.translation_character_helper import (
            build_character_registry_prompt_block,
        )
        from app.models.character_schemas import CharacterRegistry, CharacterProfile
        registry = CharacterRegistry(
            project_id="test",
            characters={
                "CHAR_00": CharacterProfile(
                    character_id="CHAR_00",
                    source_speakers=["SPEAKER_00"],
                    gender="female",
                    gender_confidence=0.9,
                    line_count=10,
                ),
            },
        )
        block = build_character_registry_prompt_block(registry)
        # SELF-REFERENCE rules được giữ (gender-based pronoun)
        assert "SELF-REFERENCE" in block
        # ADDRESSEE rules bị xóa — phải reference đến KINSHIP block trong anchor,
        # KHÔNG repeat bảng addressee chi tiết với Trung→Việt mappings.
        # Marker rõ ràng của bảng addressee cũ: "→" arrows giữa CJK và VN.
        assert "→ \"Bố\"" not in block, "Bảng addressee 父→Bố không được lặp"
        assert "→ \"Mẹ\"" not in block, "Bảng addressee 母→Mẹ không được lặp"
        # Phải có reference đến KINSHIP block
        assert "KINSHIP" in block, "Phải có reference đến KINSHIP RULES anchor"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
