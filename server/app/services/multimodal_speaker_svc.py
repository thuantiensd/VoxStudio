"""Multi-modal speaker fusion — combine audio diarization + face detection.

Phase 3 refactor (audit fix CRIT-1): AUDIO-FIRST decision tree.

NGUYÊN TẮC AUDIO-FIRST:
  - Audio là nguồn chính (pyannote diarization + embedding).
  - Face chỉ hỗ trợ khi audio_confidence < OWNERSHIP_KEEP (audio không chắc).
  - Audio CHẮC (>= AUDIO_STRONG) → face KHÔNG được override.

Pipeline:
  1. Đầu vào: segments với
     - seg["audio_speaker"]            (SPEAKER_XX từ pyannote, hoặc None)
     - seg["face_id"]                  ("FACE_XX" từ face_speaker_svc, hoặc None)
     - seg["face_confidence"]          ≈ active_speaker_confidence (MAR variance)
     và optional audio_speaker_confidences map (per SPEAKER_XX).
  2. Cross-match: đếm cooccurrence (audio_speaker, face_cluster) → greedy
     match. Kết quả: dict {SPEAKER_XX → FACE_YY}.
  3. Per-segment decision tree (xem `_decide_segment` docstring).

Output canonical "CHAR_XX" trong seg["speaker"] + seg["ownership_confidence"]
+ seg["fusion_reason"]. Voice mapping (Phase 8) dùng CHAR_XX.

LƯU Ý SEMANTIC:
  - seg["face_confidence"] thực chất ĐO MAR variance — đây là
    ACTIVE_SPEAKER_CONFIDENCE (face đang nói trong segment), KHÔNG phải
    face DETECTION trust (mediapipe). Phase 3 dùng đúng tên semantic
    `active_speaker_conf` ở local vars để rõ ràng.

Public API:
  fuse_speakers(segments, face_genders, face_gender_confs,
                audio_speaker_genders=None,
                audio_speaker_confidences=None,
                active_speaker_threshold=ACTIVE_SPEAKER_STRONG,
                audio_strong_threshold=AUDIO_STRONG,
                ownership_keep_threshold=OWNERSHIP_KEEP)
    → FusionResult
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from app.config import (
    ACTIVE_SPEAKER_STRONG,
    AUDIO_FACE_COOCCURRENCE_MIN,
    AUDIO_STRONG,
    OWNERSHIP_KEEP,
    OWNERSHIP_LOW,
)

logger = logging.getLogger(__name__)


# ── Decision reasons (enum-like strings cho audit/qa_report) ──────
REASON_AUDIO_STRONG_FACE_CONFIRM = "audio_strong_face_confirms"
REASON_AUDIO_STRONG_NO_FACE = "audio_strong_no_face"
REASON_AUDIO_MID_FACE_CONFIRM = "audio_mid_face_confirms"
REASON_AUDIO_MID_NO_FACE = "audio_mid_no_face"
REASON_FACE_WINS_WEAK_AUDIO = "face_wins_audio_weak"
REASON_FACE_ONLY_NO_AUDIO = "face_only_no_audio"
REASON_FACE_WEAK_FALLBACK = "face_weak_fallback"
REASON_NO_SIGNAL = "no_signal"


@dataclass
class FusionResult:
    """Kết quả multi-modal fusion."""
    audio_to_face: dict[str, int]
    char_genders: dict[str, str]
    char_count: int
    stats: dict
    # Phase 3 thêm: gender conflicts để qa_report (Phase 11) dùng
    gender_conflicts: list[dict] = field(default_factory=list)


# ── Cross-match audio ↔ face ──────────────────────────────────────

def _cross_match_audio_face(
    segments: list[dict],
    min_cooccurrence: int = AUDIO_FACE_COOCCURRENCE_MIN,
) -> dict[str, int]:
    """Cross-match audio_speaker (pyannote) ↔ face_cluster (vision).

    Đếm cooccurrence trên segments: bao nhiêu segment có cả audio_speaker A
    + face_cluster B → likely cùng nhân vật. Greedy assign theo cooccurrence
    cao nhất.

    Returns: {audio_speaker_id: face_cluster_int} mapping.
    """
    cooccur: dict[tuple[str, int], int] = defaultdict(int)
    for seg in segments:
        audio_spk = seg.get("audio_speaker")
        face_id_str = seg.get("face_id")
        if not audio_spk or not face_id_str:
            continue
        try:
            face_cluster_int = int(face_id_str.replace("FACE_", ""))
        except (ValueError, AttributeError):
            continue
        cooccur[(audio_spk, face_cluster_int)] += 1

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


# ── Per-segment decision tree (audio-first) ───────────────────────

def _decide_segment(
    seg: dict,
    audio_to_face: dict[str, int],
    audio_unmatched_to_char: dict[str, str],
    audio_speaker_confidences: dict[str, float],
    *,
    audio_strong_threshold: float,
    ownership_keep_threshold: float,
    active_speaker_threshold: float,
) -> tuple[Optional[str], str, float]:
    """Quyết định canonical CHAR_XX cho 1 segment theo AUDIO-FIRST tree.

    Decision tree (theo thứ tự ưu tiên):

    Inputs per segment:
      - audio_spk: SPEAKER_XX từ pyannote (có thể None nếu pyannote miss)
      - audio_conf: confidence của audio_speaker assignment (0.0-1.0).
        Nếu pyannote không trả conf, default 0.5.
      - face_int: face cluster_id (có thể None)
      - active_speaker_conf: MAR variance dominance, đo face nào ĐANG NÓI
        (đây là seg["face_confidence"], tên cũ misleading nhưng giữ key).
      - cross_matched: audio_spk có map với face_int trong audio_to_face không

    Tier (CRIT-1 fix: audio chắc → face KHÔNG override):

      A. AUDIO STRONG (audio_conf >= AUDIO_STRONG=0.85) + cross-matched:
         → CHAR mapped (audio xác nhận, face confirm identity)
         → ownership_confidence = audio_conf
      B. AUDIO STRONG + no cross-match (voice-over off-screen):
         → CHAR audio_only (audio dominates)
         → ownership_confidence = audio_conf
      C. AUDIO MID (>= OWNERSHIP_KEEP=0.70) + cross-matched:
         → CHAR mapped (audio + face đồng tình)
         → ownership_confidence = mean(audio_conf, active_speaker_conf)
      D. AUDIO MID + no cross-match:
         → CHAR audio_only (audio đủ tin)
         → ownership_confidence = audio_conf
      E. AUDIO WEAK (< OWNERSHIP_KEEP) + face_active_strong
         (active_speaker_conf >= ACTIVE_SPEAKER_STRONG=0.80):
         → CHAR face (face WINS vì audio không đủ tin)
         → ownership_confidence = active_speaker_conf
      F. No audio_spk + face_active_strong:
         → CHAR face (face only signal — on-screen actor có face track)
         → ownership_confidence = active_speaker_conf
      G. AUDIO WEAK + face WEAK:
         → fallback CHAR face nếu có face_id, hoặc audio_only nếu có audio
         → mark low_confidence (ownership_confidence = min)
      H. No signal:
         → None
         → ownership_confidence = 0.0

    Returns: (canonical_char_id_or_None, decision_reason, ownership_confidence)
    """
    audio_spk = seg.get("audio_speaker")
    face_id_str = seg.get("face_id")
    active_speaker_conf = float(seg.get("face_confidence") or 0.0)

    # Parse face_int
    face_int: Optional[int] = None
    if face_id_str:
        try:
            face_int = int(face_id_str.replace("FACE_", ""))
        except (ValueError, AttributeError):
            face_int = None

    # Audio confidence — fallback 0.5 nếu không có info
    audio_conf = 0.0
    if audio_spk:
        audio_conf = float(audio_speaker_confidences.get(audio_spk, 0.5))

    cross_matched = audio_spk is not None and audio_spk in audio_to_face
    has_face_active_strong = (
        face_int is not None and active_speaker_conf >= active_speaker_threshold
    )

    # Helper: CHAR id từ face_int
    def _char_from_face(fid: int) -> str:
        return f"CHAR_{fid:02d}"

    # ── Tier A: AUDIO STRONG + cross-match ──
    if audio_spk and audio_conf >= audio_strong_threshold and cross_matched:
        return (
            _char_from_face(audio_to_face[audio_spk]),
            REASON_AUDIO_STRONG_FACE_CONFIRM,
            audio_conf,
        )

    # ── Tier B: AUDIO STRONG, không cross-match (voice-over) ──
    if audio_spk and audio_conf >= audio_strong_threshold:
        # CHAR audio_only — caller sẽ resolve qua audio_unmatched_to_char
        char_id = audio_unmatched_to_char.get(audio_spk)
        if char_id:
            return (char_id, REASON_AUDIO_STRONG_NO_FACE, audio_conf)
        # Fallback nếu audio_unmatched_to_char chưa map → tier C/D dưới

    # ── Tier C: AUDIO MID + cross-match ──
    if audio_spk and audio_conf >= ownership_keep_threshold and cross_matched:
        ownership = (audio_conf + active_speaker_conf) / 2.0
        return (
            _char_from_face(audio_to_face[audio_spk]),
            REASON_AUDIO_MID_FACE_CONFIRM,
            ownership,
        )

    # ── Tier D: AUDIO MID, không cross-match ──
    if audio_spk and audio_conf >= ownership_keep_threshold:
        char_id = audio_unmatched_to_char.get(audio_spk)
        if char_id:
            return (char_id, REASON_AUDIO_MID_NO_FACE, audio_conf)

    # ── Tier E: AUDIO WEAK + face active strong ──
    if audio_spk and has_face_active_strong:
        # Audio yếu, face active strong → trust face vì face xác định ai đang nói
        return (
            _char_from_face(face_int),
            REASON_FACE_WINS_WEAK_AUDIO,
            active_speaker_conf,
        )

    # ── Tier F: No audio + face active strong (on-screen actor, pyannote miss) ──
    if not audio_spk and has_face_active_strong:
        return (
            _char_from_face(face_int),
            REASON_FACE_ONLY_NO_AUDIO,
            active_speaker_conf,
        )

    # ── Tier G: WEAK both → fallback ──
    # Ưu tiên face_id nếu có (visual hint), không thì audio_only nếu có audio.
    if face_int is not None:
        # Cap ownership ở OWNERSHIP_LOW vì weak signal
        weak_conf = min(active_speaker_conf, OWNERSHIP_LOW)
        return (
            _char_from_face(face_int),
            REASON_FACE_WEAK_FALLBACK,
            weak_conf,
        )
    if audio_spk:
        char_id = audio_unmatched_to_char.get(audio_spk)
        if char_id:
            return (char_id, REASON_AUDIO_MID_NO_FACE, audio_conf)

    # ── Tier H: no signal ──
    return (None, REASON_NO_SIGNAL, 0.0)


# ── Main fusion entry ─────────────────────────────────────────────

def fuse_speakers(
    segments: list[dict],
    face_genders: dict[int, str],
    face_gender_confs: dict[int, float],
    audio_speaker_genders: Optional[dict[str, str]] = None,
    audio_speaker_confidences: Optional[dict[str, float]] = None,
    *,
    active_speaker_threshold: float = ACTIVE_SPEAKER_STRONG,
    audio_strong_threshold: float = AUDIO_STRONG,
    ownership_keep_threshold: float = OWNERSHIP_KEEP,
) -> FusionResult:
    """Multi-modal fusion AUDIO-FIRST: quyết định canonical CHAR_XX per segment.

    Args:
      segments: list seg in-place mutate. Mỗi seg đã có:
        - audio_speaker (SPEAKER_XX from pyannote) hoặc None
        - face_id ("FACE_XX" from face_speaker_svc) hoặc None
        - face_confidence (0.0-1.0) — thực chất là active_speaker_confidence
      face_genders: {face_cluster_int: "male"/"female"/"unknown"}
      face_gender_confs: {face_cluster_int: 0.0-1.0}
      audio_speaker_genders: {SPEAKER_XX: gender} từ audio F0/F1
      audio_speaker_confidences: {SPEAKER_XX: 0.0-1.0} confidence speaker
        labelling từ pyannote. Optional — None → default 0.5 cho mọi speaker.
      active_speaker_threshold: ngưỡng face active_speaker (MAR variance) để
        face thắng audio khi audio weak. Default ACTIVE_SPEAKER_STRONG=0.80.
      audio_strong_threshold: ngưỡng audio_conf để face KHÔNG override.
        Default AUDIO_STRONG=0.85.
      ownership_keep_threshold: ngưỡng audio_conf mid để vẫn ưu tiên audio.
        Default OWNERSHIP_KEEP=0.70.

    Mutates segments in-place: set seg["speaker"], seg["fusion_reason"],
    seg["ownership_confidence"], seg["speaker_gender"] (nếu char gender ≠ unknown).

    Returns FusionResult.
    """
    audio_speaker_genders = audio_speaker_genders or {}
    audio_speaker_confidences = audio_speaker_confidences or {}

    # ── Step 1: cross-match audio ↔ face ──
    audio_to_face = _cross_match_audio_face(
        segments, min_cooccurrence=AUDIO_FACE_COOCCURRENCE_MIN,
    )

    # ── Step 2: build canonical CHAR_XX namespace ──
    char_genders: dict[str, str] = {}
    char_gender_confs: dict[str, float] = {}

    used_face_ids = set(face_genders.keys())
    for face_int, g in face_genders.items():
        char_id = f"CHAR_{face_int:02d}"
        char_genders[char_id] = g
        char_gender_confs[char_id] = face_gender_confs.get(face_int, 0.0)

    # Audio speakers không match face → CHAR riêng (off-screen / voice-over)
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
        char_gender_confs[char_id] = 0.5  # audio gender mid confidence
        audio_unmatched_to_char[spk] = char_id

    # ── Step 3: per-segment decision (AUDIO-FIRST tree) ──
    fusion_stats: dict[str, int] = defaultdict(int)
    gender_conflicts: list[dict] = []

    for seg in segments:
        canonical, reason, ownership = _decide_segment(
            seg,
            audio_to_face=audio_to_face,
            audio_unmatched_to_char=audio_unmatched_to_char,
            audio_speaker_confidences=audio_speaker_confidences,
            audio_strong_threshold=audio_strong_threshold,
            ownership_keep_threshold=ownership_keep_threshold,
            active_speaker_threshold=active_speaker_threshold,
        )
        fusion_stats[reason] += 1

        # Update segment fields
        seg["speaker"] = canonical
        seg["fusion_reason"] = reason
        seg["ownership_confidence"] = round(ownership, 3)

        # Gender per segment LẤY TỪ CHAR (per-character canonical, không per-segment)
        if canonical and canonical in char_genders:
            g = char_genders[canonical]
            if g and g != "unknown":
                seg["speaker_gender"] = g

        # Detect gender conflict: audio gender vs face gender đồng segment khác nhau
        audio_spk = seg.get("audio_speaker")
        if audio_spk and canonical:
            audio_g = audio_speaker_genders.get(audio_spk)
            face_g = char_genders.get(canonical)
            if (audio_g and face_g
                    and audio_g != "unknown"
                    and face_g != "unknown"
                    and audio_g != face_g):
                gender_conflicts.append({
                    "segment_id": seg.get("index"),
                    "audio_speaker": audio_spk,
                    "audio_gender": audio_g,
                    "face_char": canonical,
                    "face_gender": face_g,
                    "fusion_reason": reason,
                })

    # Final char list (chỉ chars được dùng)
    used_chars = {s.get("speaker") for s in segments if s.get("speaker")}
    final_char_genders = {c: g for c, g in char_genders.items() if c in used_chars}

    logger.info(
        "multimodal fusion AUDIO-FIRST: %d chars, "
        "audio↔face matches=%d, decisions=%s",
        len(used_chars), len(audio_to_face), dict(fusion_stats),
    )
    if gender_conflicts:
        logger.warning(
            "Gender conflicts detected on %d segments (audio vs face disagree)",
            len(gender_conflicts),
        )
    logger.info("multimodal genders: %s", final_char_genders)

    return FusionResult(
        audio_to_face=dict(audio_to_face),
        char_genders=final_char_genders,
        char_count=len(used_chars),
        stats={
            **dict(fusion_stats),
            "audio_to_face_match": dict(audio_to_face),
            "gender_conflicts_count": len(gender_conflicts),
            "thresholds_used": {
                "active_speaker": active_speaker_threshold,
                "audio_strong": audio_strong_threshold,
                "ownership_keep": ownership_keep_threshold,
            },
        },
        gender_conflicts=gender_conflicts,
    )
