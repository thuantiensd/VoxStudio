"""Multi-modal speaker fusion — combine audio diarization + face detection.

Face-only diarization fail khi off-screen audio, voice-over, hoặc face mờ.
Audio-only diarization fail khi voice gần giống nhau, utterance ngắn.

Hệ thống tốt nhất: **kết hợp cả 2** với confidence-weighted decision per
segment + cross-matching giữa audio_speaker ↔ face_cluster.

Pipeline:
  1. Đầu vào: segments với seg["audio_speaker"] (từ pyannote) +
                          seg["face_id"] (từ face_speaker_svc) +
                          seg["face_confidence"]
  2. Cross-match: đếm cooccurrence (audio_speaker, face_cluster) → greedy
     match. Kết quả: dict {SPEAKER_XX → FACE_YY}.
  3. Per-segment decision:
     • face_conf ≥ 0.7 + face_id có      → CHAR = face_id  (on-screen rõ)
     • elif audio_speaker có             → CHAR = mapped_face_id hoặc audio_id
     • else → None (fallback gender từ text LLM)
  4. Gender per character: vote từ face_genders + audio_genders + LLM evidence.

Output canonical "CHAR_XX" trong seg["speaker"] (replace cả face_id và
audio_speaker). Voice mapping dựa trên CHAR_XX.

Public API:
  fuse_speakers(segments, face_result, audio_speaker_genders) → FusionResult
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class FusionResult:
    """Kết quả multi-modal fusion."""
    audio_to_face: dict[str, int]  # SPEAKER_XX → face_cluster_id (matched)
    char_genders: dict[str, str]   # CHAR_XX → "male"/"female"
    char_count: int
    stats: dict


def _segment_overlap(a_start: float, a_end: float,
                      b_start: float, b_end: float) -> float:
    """Trả overlap duration giữa 2 segments."""
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _cross_match_audio_face(
    segments: list[dict],
    min_cooccurrence: int = 2,
) -> dict[str, int]:
    """Cross-match audio_speaker (pyannote) ↔ face_cluster (vision).

    Đếm cooccurrence trên segments: bao nhiêu segment có cả audio_speaker A
    + face_cluster B → likely cùng nhân vật. Greedy assign theo cooccurrence
    cao nhất.

    Args:
      segments: list seg với seg["audio_speaker"] + seg["face_id"]
        (face_id format "FACE_XX" → parse thành int cluster_id).
      min_cooccurrence: ngưỡng tối thiểu để match. Tránh assign theo 1 sample fluke.

    Returns: {audio_speaker_id: face_cluster_int} mapping.
    """
    cooccur: dict[tuple[str, int], int] = defaultdict(int)
    for seg in segments:
        audio_spk = seg.get("audio_speaker")
        face_id_str = seg.get("face_id")
        if not audio_spk or not face_id_str:
            continue
        # Parse "FACE_03" → 3
        try:
            face_cluster_int = int(face_id_str.replace("FACE_", ""))
        except (ValueError, AttributeError):
            continue
        cooccur[(audio_spk, face_cluster_int)] += 1

    # Greedy assign — cao nhất trước; mỗi audio_speaker + face chỉ match 1 lần.
    sorted_pairs = sorted(cooccur.items(), key=lambda kv: -kv[1])
    audio_to_face: dict[str, int] = {}
    used_faces: set[int] = set()
    for (audio_spk, face_int), count in sorted_pairs:
        if count < min_cooccurrence:
            continue
        if audio_spk in audio_to_face:
            continue
        if face_int in used_faces:
            continue
        audio_to_face[audio_spk] = face_int
        used_faces.add(face_int)
        logger.info("cross-match: %s ↔ FACE_%02d (cooccurrence=%d)",
                     audio_spk, face_int, count)
    return audio_to_face


def fuse_speakers(
    segments: list[dict],
    face_genders: dict[int, str],
    face_gender_confs: dict[int, float],
    audio_speaker_genders: Optional[dict[str, str]] = None,
    face_conf_threshold: float = 0.6,
) -> FusionResult:
    """Multi-modal fusion: quyết định canonical CHAR_XX per segment.

    Args:
      segments: list seg, mỗi seg đã có:
        - audio_speaker (SPEAKER_XX from pyannote) hoặc None
        - face_id ("FACE_XX" from face_speaker_svc) hoặc None
        - face_confidence (0.0-1.0)
      face_genders: {face_cluster_int: "male"/"female"} từ face_speaker_svc
      face_gender_confs: {face_cluster_int: 0.0-1.0}
      audio_speaker_genders: {SPEAKER_XX: "male"/"female"} từ audio F0
      face_conf_threshold: nếu face_conf >= threshold → face thắng audio

    Mutates segments in-place: set seg["speaker"] = canonical "CHAR_XX".

    Returns FusionResult.
    """
    audio_speaker_genders = audio_speaker_genders or {}

    # ── Step 1: cross-match audio ↔ face ──
    audio_to_face = _cross_match_audio_face(segments, min_cooccurrence=2)

    # ── Step 2: build canonical CHAR_XX namespace ──
    # Mỗi face_cluster_int = 1 CHAR. Audio_speakers không match → CHAR riêng.
    char_genders: dict[str, str] = {}
    char_gender_confs: dict[str, float] = {}

    # Faces → CHAR
    used_face_ids = set(face_genders.keys())
    for face_int, g in face_genders.items():
        char_id = f"CHAR_{face_int:02d}"
        char_genders[char_id] = g
        char_gender_confs[char_id] = face_gender_confs.get(face_int, 0.0)

    # Audio speakers không match face → CHAR riêng (off-screen / voice-over)
    matched_faces = set(audio_to_face.values())
    unmatched_audios = [
        spk for spk in audio_speaker_genders.keys()
        if spk not in audio_to_face and spk
    ]
    next_unmatched_char = max(used_face_ids, default=-1) + 1
    audio_unmatched_to_char: dict[str, str] = {}
    for spk in unmatched_audios:
        char_id = f"CHAR_{next_unmatched_char:02d}"
        next_unmatched_char += 1
        char_genders[char_id] = audio_speaker_genders.get(spk, "unknown")
        char_gender_confs[char_id] = 0.5  # audio gender weaker
        audio_unmatched_to_char[spk] = char_id

    # ── Step 3: per-segment decision ──
    fusion_stats = {
        "face_wins": 0,
        "audio_wins": 0,
        "audio_mapped_to_face": 0,
        "no_signal": 0,
    }
    for seg in segments:
        audio_spk = seg.get("audio_speaker")
        face_id_str = seg.get("face_id")
        face_conf = float(seg.get("face_confidence") or 0.0)

        face_int = None
        if face_id_str:
            try:
                face_int = int(face_id_str.replace("FACE_", ""))
            except (ValueError, AttributeError):
                face_int = None

        canonical = None
        decision_reason = None

        # Priority A: face conf cao → face thắng (on-screen rõ)
        if face_int is not None and face_conf >= face_conf_threshold:
            canonical = f"CHAR_{face_int:02d}"
            decision_reason = "face_strong"
            fusion_stats["face_wins"] += 1
        # Priority B: audio có cross-match với face → dùng face mapped (audio
        #             confirms face identity, face đã có voice slot)
        elif audio_spk in audio_to_face:
            face_int_mapped = audio_to_face[audio_spk]
            canonical = f"CHAR_{face_int_mapped:02d}"
            decision_reason = "audio_mapped_to_face"
            fusion_stats["audio_mapped_to_face"] += 1
        # Priority C: audio không match face → CHAR riêng cho off-screen voice
        elif audio_spk in audio_unmatched_to_char:
            canonical = audio_unmatched_to_char[audio_spk]
            decision_reason = "audio_only"
            fusion_stats["audio_wins"] += 1
        # Priority D: face conf thấp nhưng có → dùng tạm (better than nothing)
        elif face_int is not None:
            canonical = f"CHAR_{face_int:02d}"
            decision_reason = "face_weak"
            fusion_stats["face_wins"] += 1
        else:
            decision_reason = "no_signal"
            fusion_stats["no_signal"] += 1

        # Update seg
        seg["speaker"] = canonical
        seg["fusion_reason"] = decision_reason
        if canonical and canonical in char_genders:
            g = char_genders[canonical]
            if g and g != "unknown":
                seg["speaker_gender"] = g

    # Final char list (chỉ chars được dùng)
    used_chars = {s.get("speaker") for s in segments if s.get("speaker")}
    final_char_genders = {c: g for c, g in char_genders.items() if c in used_chars}

    logger.info(
        "multimodal fusion: %d chars, decisions=%s, audio↔face matches=%d",
        len(used_chars), fusion_stats, len(audio_to_face),
    )
    logger.info("multimodal genders: %s", final_char_genders)

    return FusionResult(
        audio_to_face={k: v for k, v in audio_to_face.items()},
        char_genders=final_char_genders,
        char_count=len(used_chars),
        stats={**fusion_stats, "audio_to_face_match": audio_to_face},
    )
