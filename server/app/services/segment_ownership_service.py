"""Segment Ownership Service (Phase 6 audit refactor).

Validate per-segment character_id assignment bằng cosine similarity GIỮA
segment embedding và character canonical embedding (mean of cluster sources).

Đây là phase FIX REGRESSION CARRYOVER từ Phase 3:
  Trước Phase 6: audio_speaker_confidences = gender_confidences (proxy SAI).
  Sau Phase 6:  ownership_confidence = cosine(seg_emb, char_emb) — đúng nghĩa.

Rule priority (theo spec audit Phase 6, áp dụng theo thứ tự — match đầu tiên thắng):

  1. SHORT_SEGMENT / LOW_QUALITY EMBEDDING
     Segment duration < MIN_EMBEDDING_DURATION (mặc định 0.5s, nới hơn
     MIN_EMBEDDING_DURATION audio đẹp 2s vì segment có thể ngắn nhưng
     vẫn cần assign) HOẶC segment_embedding_quality < 0.3
     → GIỮ assignment, mark low_confidence, log OwnershipWarning.
     Lý do: embedding ngắn/noisy → cosine sim không tin cậy → không reassign.

  2. REASSIGN_STRONG
     best_candidate_sim - assigned_sim > OWNERSHIP_REASSIGN_GAP (0.20)
     VÀ best_candidate_sim ≥ OWNERSHIP_KEEP (0.70)
     → REASSIGN sang best_candidate, ownership = best_candidate_sim,
       confidence = high, log OwnershipWarning (reason=reassigned_strong).

  3. KEPT_HIGH_CONF
     assigned_sim ≥ OWNERSHIP_KEEP (0.70)
     → GIỮ assignment, ownership = assigned_sim, confidence = high.

  4. LOW_CONF_KEEP
     assigned_sim < OWNERSHIP_LOW (0.50)
     → GIỮ assignment (không có candidate đủ mạnh để reassign — rule 2 đã
       check trước), mark low_confidence, log OwnershipWarning.

  5. MEDIUM_CONF_KEEP (fallback)
     OWNERSHIP_LOW ≤ assigned_sim < OWNERSHIP_KEEP
     → GIỮ assignment, confidence = medium.

Edge cases:
  - Segment không có character_id (chưa assign) → skip, không log warning
    (downstream Phase 8 voice fallback xử lý).
  - registry.characters rỗng → return empty list (không có gì để validate).
  - character không có embedding (vd len(source_speakers)=0 hoặc embeddings
    thiếu) → ownership=0.0, mark low_confidence + log SystemError-ish warning.

Public API:
  validate_segment_ownership(segment, character_embeddings, segment_embedding,
                             *, thresholds, ...) → SegmentOwnershipInfo
  validate_segments_batch(segments, character_embeddings, segment_embeddings,
                          registry, ...) → tuple[list[SegmentOwnershipInfo], list[OwnershipWarning]]
  build_character_embeddings(registry, speaker_embeddings)
                          → dict[str, np.ndarray]
  compute_segment_embedding(segment_audio, sr) → np.ndarray  [Phase 6.5+ wire]
"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from app.config import (
    MIN_EMBEDDING_DURATION,
    OWNERSHIP_KEEP,
    OWNERSHIP_LOW,
    OWNERSHIP_REASSIGN_GAP,
)
from app.models.character_schemas import (
    CharacterRegistry,
    OwnershipWarning,
    SegmentOwnershipInfo,
)

logger = logging.getLogger(__name__)


# ── Decision reasons (enum-like strings cho qa_report) ────────────
REASON_SHORT_SEGMENT_KEEP = "short_segment_keep"
REASON_LOW_QUALITY_EMBEDDING_KEEP = "low_quality_embedding_keep"
REASON_REASSIGNED_STRONG = "reassigned_strong"
REASON_KEPT_HIGH_CONF = "kept_high_conf"
REASON_LOW_CONF_KEEP = "low_conf_keep"
REASON_MEDIUM_CONF_KEEP = "medium_conf_keep"
REASON_NO_CHARACTER_EMBEDDING = "no_character_embedding"
REASON_NO_SEGMENT_EMBEDDING = "no_segment_embedding"


# Default ngưỡng segment duration "ngắn" để skip ownership check (mặc định
# nhẹ hơn MIN_EMBEDDING_DURATION audio extract — vẫn cho phép assign nhưng
# low_confidence). Có thể override qua arg.
DEFAULT_SHORT_SEGMENT_SEC = 0.5
DEFAULT_MIN_EMBEDDING_QUALITY = 0.3


# ── Utilities ─────────────────────────────────────────────────────

def _cosine_sim(a: Optional[np.ndarray], b: Optional[np.ndarray]) -> float:
    """Cosine similarity 2 vectors L2-normalized. 0.0 nếu None/shape mismatch."""
    if a is None or b is None:
        return 0.0
    if a.shape != b.shape:
        return 0.0
    return float(np.dot(a, b))


def _l2_normalize(vec: np.ndarray) -> np.ndarray:
    """L2-normalize embedding. Trả vec gốc nếu norm ~ 0."""
    n = float(np.linalg.norm(vec))
    if n < 1e-9:
        return vec
    return (vec / n).astype(np.float32)


# ── Build character canonical embeddings ──────────────────────────

def build_character_embeddings(
    registry: CharacterRegistry,
    speaker_embeddings: dict[str, np.ndarray],
) -> dict[str, np.ndarray]:
    """Build per-character canonical embedding = L2-normalized mean of
    source_speaker embeddings.

    Args:
      registry: CharacterRegistry từ Phase 5 build_character_registry.
      speaker_embeddings: per-speaker_id (SPEAKER_XX) L2-normalized embedding.

    Returns: dict[char_id, embedding]. char_id chỉ xuất hiện nếu ≥ 1
      source_speaker có embedding trong speaker_embeddings.
    """
    char_embeddings: dict[str, np.ndarray] = {}
    for char_id, profile in registry.characters.items():
        vecs = [
            speaker_embeddings[spk]
            for spk in profile.source_speakers
            if spk in speaker_embeddings and speaker_embeddings[spk] is not None
        ]
        if not vecs:
            logger.warning(
                "build_character_embeddings: %s sources=%s — KHÔNG có embedding "
                "(skip — sẽ không validate được ownership cho char này)",
                char_id, profile.source_speakers,
            )
            continue
        # Mean rồi L2-normalize lại (mean of unit vectors KHÔNG còn unit).
        mean_vec = np.mean(np.stack(vecs, axis=0), axis=0)
        char_embeddings[char_id] = _l2_normalize(mean_vec)
    return char_embeddings


# ── Core decision: validate 1 segment ─────────────────────────────

def validate_segment_ownership(
    segment: dict,
    character_embeddings: dict[str, np.ndarray],
    segment_embedding: Optional[np.ndarray],
    *,
    assigned_character_id: Optional[str] = None,
    segment_embedding_quality: float = 1.0,
    short_segment_sec: float = DEFAULT_SHORT_SEGMENT_SEC,
    min_embedding_quality: float = DEFAULT_MIN_EMBEDDING_QUALITY,
    ownership_keep: float = OWNERSHIP_KEEP,
    ownership_low: float = OWNERSHIP_LOW,
    reassign_gap: float = OWNERSHIP_REASSIGN_GAP,
) -> SegmentOwnershipInfo:
    """Validate ownership của 1 segment theo rule priority 1-5.

    Args:
      segment: dict cần có "start", "end", optional "index"/"segment_id".
      character_embeddings: dict[char_id, L2-normalized embedding] từ
        build_character_embeddings.
      segment_embedding: L2-normalized embedding cho segment audio (từ
        compute_segment_embedding hoặc None nếu chưa extract).
      assigned_character_id: char_id hiện đang gán (từ Phase 5 assign).
        Nếu None → sẽ thử pick best_candidate (rule 2 vẫn áp dụng).
      segment_embedding_quality: 0-1 SNR-based quality. Default 1.0 (caller
        không biết → giả định OK).
      short_segment_sec: ngưỡng segment ngắn để skip (rule 1).
      min_embedding_quality: ngưỡng quality thấp để skip (rule 1).
      ownership_keep/low/reassign_gap: từ config, override-able cho test.

    Returns: SegmentOwnershipInfo. Caller dùng .assigned_character_id +
      .confidence_tier để mutate segment["character_id"], seg["ownership_*"].
    """
    seg_id = segment.get("segment_id", segment.get("index", 0))
    duration = float(segment.get("end", 0.0)) - float(segment.get("start", 0.0))

    # ── Rule 1a: SHORT_SEGMENT ──
    if duration < short_segment_sec:
        return SegmentOwnershipInfo(
            segment_id=seg_id,
            assigned_character_id=assigned_character_id,
            ownership_confidence=0.0,
            best_candidate_character_id=None,
            best_candidate_similarity=None,
            decision_reason=REASON_SHORT_SEGMENT_KEEP,
            confidence_tier="low",
        )

    # ── Rule 1b: LOW_QUALITY_EMBEDDING ──
    if segment_embedding is None:
        return SegmentOwnershipInfo(
            segment_id=seg_id,
            assigned_character_id=assigned_character_id,
            ownership_confidence=0.0,
            best_candidate_character_id=None,
            best_candidate_similarity=None,
            decision_reason=REASON_NO_SEGMENT_EMBEDDING,
            confidence_tier="low",
        )

    if segment_embedding_quality < min_embedding_quality:
        return SegmentOwnershipInfo(
            segment_id=seg_id,
            assigned_character_id=assigned_character_id,
            ownership_confidence=0.0,
            best_candidate_character_id=None,
            best_candidate_similarity=None,
            decision_reason=REASON_LOW_QUALITY_EMBEDDING_KEEP,
            confidence_tier="low",
        )

    # Compute sim to ALL characters
    if not character_embeddings:
        return SegmentOwnershipInfo(
            segment_id=seg_id,
            assigned_character_id=assigned_character_id,
            ownership_confidence=0.0,
            best_candidate_character_id=None,
            best_candidate_similarity=None,
            decision_reason=REASON_NO_CHARACTER_EMBEDDING,
            confidence_tier="low",
        )

    sims: dict[str, float] = {
        cid: _cosine_sim(segment_embedding, emb)
        for cid, emb in character_embeddings.items()
    }

    # Best candidate (highest sim)
    best_char = max(sims, key=lambda c: sims[c])
    best_sim = sims[best_char]

    # Assigned sim — nếu chưa có assigned → coi như -1 (rule 2/3 sẽ assign best)
    if assigned_character_id and assigned_character_id in sims:
        assigned_sim = sims[assigned_character_id]
    else:
        assigned_sim = -1.0  # no current assignment → always reassign

    # ── Rule 2: REASSIGN_STRONG ──
    if assigned_character_id and best_char != assigned_character_id:
        gap = best_sim - assigned_sim
        if gap > reassign_gap and best_sim >= ownership_keep:
            return SegmentOwnershipInfo(
                segment_id=seg_id,
                assigned_character_id=best_char,  # NEW assignment
                ownership_confidence=round(best_sim, 3),
                best_candidate_character_id=best_char,
                best_candidate_similarity=round(best_sim, 3),
                decision_reason=REASON_REASSIGNED_STRONG,
                confidence_tier="high",
            )

    # Nếu chưa có assignment → gán best_char (treat như reassign_strong khi đủ mạnh)
    if not assigned_character_id:
        if best_sim >= ownership_keep:
            return SegmentOwnershipInfo(
                segment_id=seg_id,
                assigned_character_id=best_char,
                ownership_confidence=round(best_sim, 3),
                best_candidate_character_id=best_char,
                best_candidate_similarity=round(best_sim, 3),
                decision_reason=REASON_REASSIGNED_STRONG,
                confidence_tier="high",
            )
        # Best không đủ → vẫn assign best nhưng mark low/medium
        assigned_character_id = best_char
        assigned_sim = best_sim

    # ── Rule 3: KEPT_HIGH_CONF ──
    if assigned_sim >= ownership_keep:
        return SegmentOwnershipInfo(
            segment_id=seg_id,
            assigned_character_id=assigned_character_id,
            ownership_confidence=round(assigned_sim, 3),
            best_candidate_character_id=best_char,
            best_candidate_similarity=round(best_sim, 3),
            decision_reason=REASON_KEPT_HIGH_CONF,
            confidence_tier="high",
        )

    # ── Rule 4: LOW_CONF_KEEP ──
    if assigned_sim < ownership_low:
        return SegmentOwnershipInfo(
            segment_id=seg_id,
            assigned_character_id=assigned_character_id,
            ownership_confidence=round(max(0.0, assigned_sim), 3),
            best_candidate_character_id=best_char,
            best_candidate_similarity=round(best_sim, 3),
            decision_reason=REASON_LOW_CONF_KEEP,
            confidence_tier="low",
        )

    # ── Rule 5: MEDIUM_CONF_KEEP ──
    return SegmentOwnershipInfo(
        segment_id=seg_id,
        assigned_character_id=assigned_character_id,
        ownership_confidence=round(assigned_sim, 3),
        best_candidate_character_id=best_char,
        best_candidate_similarity=round(best_sim, 3),
        decision_reason=REASON_MEDIUM_CONF_KEEP,
        confidence_tier="medium",
    )


# ── Batch entry: validate_segments_batch ──────────────────────────

def validate_segments_batch(
    segments: list[dict],
    character_embeddings: dict[str, np.ndarray],
    segment_embeddings: dict,  # dict[seg_id_or_index, (embedding, quality)]
    registry: CharacterRegistry,
    *,
    raw_speaker_field: str = "speaker",
    character_id_field: str = "character_id",
    apply_decisions: bool = True,
    short_segment_sec: float = DEFAULT_SHORT_SEGMENT_SEC,
    min_embedding_quality: float = DEFAULT_MIN_EMBEDDING_QUALITY,
    ownership_keep: float = OWNERSHIP_KEEP,
    ownership_low: float = OWNERSHIP_LOW,
    reassign_gap: float = OWNERSHIP_REASSIGN_GAP,
) -> tuple[list[SegmentOwnershipInfo], list[OwnershipWarning]]:
    """Validate ownership cho cả batch segments.

    Args:
      segments: list dict. Mỗi seg cần "start", "end", optional
        seg[character_id_field] (từ Phase 5 assign).
      character_embeddings: từ build_character_embeddings.
      segment_embeddings: dict {seg_index_or_id: (vector, quality)}.
        Nếu seg không có key → segment_embedding=None → rule 1b apply.
      registry: CharacterRegistry — dùng để map character_id back nếu reassign.
      raw_speaker_field: field chứa raw speaker (cho fallback log).
      character_id_field: field chứa assigned character_id.
      apply_decisions: True (default) → mutate seg["character_id"],
        seg["ownership_confidence"], seg["ownership_decision_reason"],
        seg["ownership_tier"]. False → chỉ return infos (dry-run).
      thresholds: từ config, override-able.

    Returns: (ownership_infos, warnings)
      - ownership_infos: 1 SegmentOwnershipInfo per segment (cùng order)
      - warnings: list OwnershipWarning cho seg có tier=low hoặc reassign
    """
    infos: list[SegmentOwnershipInfo] = []
    warnings: list[OwnershipWarning] = []

    for seg in segments:
        seg_key = seg.get("index", seg.get("segment_id"))
        emb_entry = segment_embeddings.get(seg_key)
        if emb_entry is None:
            seg_emb, seg_quality = None, 1.0
        else:
            seg_emb, seg_quality = emb_entry

        assigned_char = seg.get(character_id_field)

        info = validate_segment_ownership(
            segment=seg,
            character_embeddings=character_embeddings,
            segment_embedding=seg_emb,
            assigned_character_id=assigned_char,
            segment_embedding_quality=seg_quality,
            short_segment_sec=short_segment_sec,
            min_embedding_quality=min_embedding_quality,
            ownership_keep=ownership_keep,
            ownership_low=ownership_low,
            reassign_gap=reassign_gap,
        )
        infos.append(info)

        # Apply mutation
        if apply_decisions:
            if info.assigned_character_id:
                seg[character_id_field] = info.assigned_character_id
            seg["ownership_confidence"] = round(info.ownership_confidence, 3)
            seg["ownership_decision_reason"] = info.decision_reason
            seg["ownership_tier"] = info.confidence_tier

        # Log warning cho low confidence hoặc reassign
        if (
            info.confidence_tier == "low"
            or info.decision_reason == REASON_REASSIGNED_STRONG
        ):
            warnings.append(OwnershipWarning(
                segment_id=info.segment_id,
                start_time=float(seg.get("start", 0.0)),
                end_time=float(seg.get("end", 0.0)),
                assigned_character=info.assigned_character_id,
                best_candidate=info.best_candidate_character_id,
                ownership_confidence=info.ownership_confidence,
                reason=info.decision_reason,
            ))

    # Logging summary
    from collections import Counter
    reason_counts = Counter(i.decision_reason for i in infos)
    tier_counts = Counter(i.confidence_tier for i in infos)
    logger.info(
        "segment_ownership: %d segments validated · tiers=%s · reasons=%s",
        len(infos), dict(tier_counts), dict(reason_counts),
    )
    if warnings:
        logger.warning(
            "segment_ownership: %d warnings (low_conf hoặc reassign)",
            len(warnings),
        )

    return infos, warnings


# ── Embedding extraction helpers (wire-ready cho dubbing_svc) ─────

def extract_speaker_embeddings_from_pipeline(
    sp_result_embeddings: Optional[list],
) -> dict[str, np.ndarray]:
    """Convert list[SpeakerEmbedding] từ speaker_pipeline → dict[speaker_id, vec].

    Nếu 1 speaker_id xuất hiện nhiều lần (multiple turns) → average + L2 normalize.

    Args:
      sp_result_embeddings: từ extract_embeddings (Phase 4 speaker_pipeline).
        list[SpeakerEmbedding(speaker_id, start, end, vector, quality)].
        None hoặc [] → return {}.

    Returns: dict[speaker_id, L2-normalized embedding vec].
    """
    if not sp_result_embeddings:
        return {}

    # Group by speaker_id
    by_speaker: dict[str, list[np.ndarray]] = {}
    for emb in sp_result_embeddings:
        spk = getattr(emb, "speaker_id", None)
        vec = getattr(emb, "vector", None)
        if spk is None or vec is None:
            continue
        by_speaker.setdefault(spk, []).append(np.asarray(vec, dtype=np.float32))

    out: dict[str, np.ndarray] = {}
    for spk, vecs in by_speaker.items():
        if len(vecs) == 1:
            out[spk] = _l2_normalize(vecs[0])
        else:
            mean_vec = np.mean(np.stack(vecs, axis=0), axis=0)
            out[spk] = _l2_normalize(mean_vec)
    return out


def compute_segment_embeddings(
    audio_path: str,
    segments: list[dict],
    *,
    extract_embeddings_fn=None,
    min_duration: float = 0.5,
) -> dict:
    """Extract per-segment embedding bằng pyannote/embedding.

    Reuse extract_embeddings() từ speaker_pipeline (pyannote WeSpeaker-ResNet34
    256-d). Build pseudo DiarizationTurn cho mỗi segment để feed vào.

    Args:
      audio_path: clean vocals.wav (preferable) hoặc audio gốc.
      segments: list seg dict cần "start", "end", optional "index".
      extract_embeddings_fn: inject extractor (cho test dễ mock). Default
        lazy-import từ speaker_pipeline.embedding.
      min_duration: skip segment ngắn (rule 1a sẽ handle null embedding).

    Returns: dict[seg_index, (embedding_vec, quality)].
      Segment ngắn / fail → KHÔNG có key trong dict (caller treat None).
    """
    if not segments:
        return {}

    if extract_embeddings_fn is None:
        try:
            from app.services.speaker_pipeline.embedding import extract_embeddings
            extract_embeddings_fn = extract_embeddings
        except ImportError as e:
            logger.warning("compute_segment_embeddings: pyannote/embedding "
                           "unavailable (%s) — return empty dict", e)
            return {}

    # Build pseudo turns: speaker_id = "SEG_<index>"
    from app.services.speaker_pipeline.types import DiarizationTurn
    pseudo_turns: list[DiarizationTurn] = []
    seg_key_by_speaker: dict[str, int] = {}  # pseudo speaker → seg_index
    for seg in segments:
        seg_idx = seg.get("index")
        if seg_idx is None:
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", 0.0))
        if end - start < min_duration:
            continue
        pseudo_id = f"SEG_{seg_idx:05d}"
        pseudo_turns.append(DiarizationTurn(start=start, end=end, speaker=pseudo_id))
        seg_key_by_speaker[pseudo_id] = seg_idx

    if not pseudo_turns:
        return {}

    try:
        embs = extract_embeddings_fn(audio_path, pseudo_turns, min_duration=min_duration)
    except Exception as e:
        logger.warning("compute_segment_embeddings: extract_embeddings fail (%s)", e)
        return {}

    out: dict = {}
    for emb in embs:
        spk = getattr(emb, "speaker_id", None)
        if spk not in seg_key_by_speaker:
            continue
        seg_idx = seg_key_by_speaker[spk]
        vec = _l2_normalize(np.asarray(emb.vector, dtype=np.float32))
        quality = float(getattr(emb, "quality", 1.0))
        out[seg_idx] = (vec, quality)
    logger.info("compute_segment_embeddings: %d/%d segments extracted",
                len(out), len(segments))
    return out
