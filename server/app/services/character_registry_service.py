"""Character Registry Service (Phase 5 audit refactor).

Cluster raw speakers (SPEAKER_XX từ pyannote, hoặc FACE_XX nếu fallback)
→ canonical character_id ổn định (CHAR_000, CHAR_001, ...).

Thay thế logic cluster cũ trong fuse_speakers (chỉ face). Service mới:
  - Chỉ nhận 1 loại embedding space (caller chọn — audio hoặc face).
  - Tính cosine similarity matrix giữa raw speakers.
  - Apply merge rules: HIGH/MEDIUM/LOW + supporting evidences.
  - Hard constraint: timeline overlap ≥ 0.5s → NEVER merge (cùng lúc 2 người
    nói trong frame audio overlap → chắc chắn không phải cùng người).
  - Output: CharacterRegistry Pydantic (Phase 2 schema) + character_registry.json.

Merge rules (theo spec):
  sim >= COSINE_MERGE_HIGH (0.75)              → AUTO MERGE
  COSINE_MERGE_LOW (0.65) <= sim < HIGH (0.75) → CHỈ MERGE nếu ≥ 2 evidences
  sim < COSINE_MERGE_LOW (0.65)                → KEEP SEPARATE

Supporting evidences (countable, từ spec):
  E1: same_face_track          (cả 2 raw speakers map cùng face_id)
  E2: same_gender_high_conf    (cả 2 cùng gender + cả 2 conf ≥ GENDER_HIGH=0.80)
  E3: no_timeline_overlap      (không có segment overlap ≥ 0.5s)
  E4: ownership_pulling        (Phase 6 future — segment ownership kéo về cùng cluster)
  E5: no_face_timeline_conflict (derivative — implicit khi E1 + E3 đúng, không count riêng)

Public API:
  build_character_registry(project_id, raw_speakers, ...) → CharacterRegistry
  assign_character_ids_to_segments(segments, registry) → int (assigned count)
  save_character_registry(registry, output_path) → None
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import numpy as np

from app.config import (
    COSINE_MERGE_HIGH,
    COSINE_MERGE_LOW,
    GENDER_HIGH,
)
from app.models.character_schemas import (
    CharacterProfile,
    CharacterRegistry,
    PossibleMerge,
)

logger = logging.getLogger(__name__)


# ── Evidence type names (countable) ───────────────────────────────
EVIDENCE_SAME_FACE_TRACK = "same_face_track"
EVIDENCE_SAME_GENDER_HIGH = "same_gender_high_conf"
EVIDENCE_NO_TIMELINE_OVERLAP = "no_timeline_overlap"
EVIDENCE_OWNERSHIP_SUPPORT = "ownership_pulling_same_cluster"  # Phase 6+
# EVIDENCE_NO_FACE_CONFLICT — derivative (= E1 ∧ E3), không count riêng để
# tránh double-counting.


# ── Utilities ─────────────────────────────────────────────────────

def cosine_similarity(a: Optional[np.ndarray], b: Optional[np.ndarray]) -> float:
    """Cosine sim 2 vectors. Assumes L2-normalized (insightface/resemblyzer convention).

    Trả 0.0 nếu vector None hoặc shape mismatch.
    """
    if a is None or b is None:
        return 0.0
    if a.shape != b.shape:
        return 0.0
    return float(np.dot(a, b))


def compute_similarity_matrix(
    speaker_embeddings: dict[str, np.ndarray],
) -> dict[tuple[str, str], float]:
    """Pairwise cosine sim → dict[(spk_a, spk_b)] = sim. Symmetric."""
    matrix: dict[tuple[str, str], float] = {}
    speakers = list(speaker_embeddings.keys())
    for i, a in enumerate(speakers):
        for b in speakers[i:]:
            sim = cosine_similarity(speaker_embeddings[a], speaker_embeddings[b])
            matrix[(a, b)] = sim
            matrix[(b, a)] = sim
    return matrix


def compute_timeline_overlaps(
    speaker_segments: dict[str, list[dict]],
    min_overlap_seconds: float = 0.5,
) -> dict[tuple[str, str], bool]:
    """For each pair (spk_a, spk_b): True nếu có ≥ 1 cặp segment overlap ≥ min_overlap_seconds.

    Overlap nghĩa là 2 raw speakers cùng nói cùng lúc → KHÔNG thể là cùng nhân vật.
    """
    overlaps: dict[tuple[str, str], bool] = {}
    speakers = list(speaker_segments.keys())
    for i, a in enumerate(speakers):
        for b in speakers[i:]:
            if a == b:
                overlaps[(a, b)] = False
                continue
            has_overlap = False
            for sa in speaker_segments[a]:
                for sb in speaker_segments[b]:
                    start_a, end_a = float(sa["start"]), float(sa["end"])
                    start_b, end_b = float(sb["start"]), float(sb["end"])
                    overlap = max(0.0, min(end_a, end_b) - max(start_a, start_b))
                    if overlap >= min_overlap_seconds:
                        has_overlap = True
                        break
                if has_overlap:
                    break
            overlaps[(a, b)] = has_overlap
            overlaps[(b, a)] = has_overlap
    return overlaps


def count_supporting_evidences(
    spk_a: str,
    cluster_members: list[str],
    *,
    speaker_genders: dict[str, str],
    speaker_gender_confs: dict[str, float],
    face_track_to_speaker: dict[int, str],
    timeline_overlaps: dict[tuple[str, str], bool],
    gender_high_threshold: float = GENDER_HIGH,
) -> tuple[int, list[str]]:
    """Đếm supporting evidences cho việc merge spk_a vào cluster_members.

    Returns: (count, evidence_names_list).
    """
    evidences: list[str] = []

    # E1: same face_track (spk_a và ít nhất 1 member cùng map face_id)
    spk_a_faces = {fid for fid, sid in face_track_to_speaker.items() if sid == spk_a}
    if spk_a_faces:
        for m in cluster_members:
            m_faces = {fid for fid, sid in face_track_to_speaker.items() if sid == m}
            if m_faces and (spk_a_faces & m_faces):
                evidences.append(EVIDENCE_SAME_FACE_TRACK)
                break

    # E2: same gender high conf (spk_a + ALL members cùng gender, ALL conf ≥ threshold)
    spk_a_g = speaker_genders.get(spk_a, "unknown")
    spk_a_c = speaker_gender_confs.get(spk_a, 0.0)
    if spk_a_g in ("male", "female") and spk_a_c >= gender_high_threshold:
        all_match_high = all(
            speaker_genders.get(m) == spk_a_g
            and speaker_gender_confs.get(m, 0.0) >= gender_high_threshold
            for m in cluster_members
        )
        if all_match_high:
            evidences.append(EVIDENCE_SAME_GENDER_HIGH)

    # E3: no timeline overlap với BẤT KỲ member nào
    no_overlap_with_all = all(
        not timeline_overlaps.get((spk_a, m), False)
        for m in cluster_members
    )
    if no_overlap_with_all:
        evidences.append(EVIDENCE_NO_TIMELINE_OVERLAP)

    # E4: ownership_pulling — Phase 6 future. Sẽ count khi segment_ownership_service
    # cung cấp per-segment best_candidate kéo về cluster này.

    return len(evidences), evidences


# ── Main entry: build_character_registry ──────────────────────────

def build_character_registry(
    project_id: str,
    raw_speakers: list[str],
    speaker_embeddings: dict[str, np.ndarray],
    speaker_segments: dict[str, list[dict]],
    speaker_genders: Optional[dict[str, str]] = None,
    speaker_gender_confs: Optional[dict[str, float]] = None,
    face_track_to_speaker: Optional[dict[int, str]] = None,
    *,
    cosine_merge_high: float = COSINE_MERGE_HIGH,
    cosine_merge_low: float = COSINE_MERGE_LOW,
    gender_high_threshold: float = GENDER_HIGH,
    min_evidences_for_merge: int = 2,
    min_overlap_seconds: float = 0.5,
) -> CharacterRegistry:
    """Cluster raw speakers thành canonical characters.

    Algorithm (greedy clustering, anchor longest duration first):

      Sort raw_speakers theo total_duration desc.
      For each spk:
        Find best existing cluster (avg cosine similarity to members):
          1. sim >= HIGH (0.75):
             - timeline_overlap với BẤT KỲ member → NEW cluster + log possible_merge
             - else → MERGE (auto)
          2. LOW (0.65) <= sim < HIGH:
             - count evidences (E1 face, E2 gender, E3 no-overlap)
             - evidences >= 2 AND no_overlap → MERGE
             - else → NEW cluster + log possible_merge
          3. sim < LOW: NEW cluster (không log possible_merge — too far)

    Args:
      project_id: project ID cho registry
      raw_speakers: list speaker IDs (vd ["SPEAKER_00", "SPEAKER_01"])
      speaker_embeddings: per-speaker L2-normalized embedding (audio hoặc face)
      speaker_segments: per-speaker list[{start, end, ...}]
      speaker_genders: per-speaker gender (male/female/unknown), default {}
      speaker_gender_confs: per-speaker gender confidence [0,1], default {}
      face_track_to_speaker: face_id (int) → speaker_id (str) mapping for E1
      cosine_merge_high/low: thresholds (default từ config)
      gender_high_threshold: ngưỡng gender conf để count E2 (default GENDER_HIGH=0.80)
      min_evidences_for_merge: số evidences tối thiểu để merge vùng MEDIUM (default 2)
      min_overlap_seconds: ngưỡng overlap seconds để coi là timeline overlap (default 0.5)

    Returns: CharacterRegistry với characters + possible_merges.

    Edge cases:
      - raw_speakers rỗng → empty registry
      - speaker_embeddings thiếu key → cosine_similarity trả 0.0 → sim thấp → keep separate
      - face_track_to_speaker None → E1 không count được (chỉ còn E2, E3 → cần cả 2)
    """
    speaker_genders = speaker_genders or {}
    speaker_gender_confs = speaker_gender_confs or {}
    face_track_to_speaker = face_track_to_speaker or {}

    if not raw_speakers:
        logger.info("build_character_registry: no raw_speakers — empty registry")
        return CharacterRegistry(project_id=project_id)

    sim_matrix = compute_similarity_matrix(speaker_embeddings)
    timeline_overlaps = compute_timeline_overlaps(
        speaker_segments, min_overlap_seconds=min_overlap_seconds,
    )

    # Sort by total_duration desc (anchor longest first → stable cluster id)
    sorted_speakers = sorted(
        raw_speakers,
        key=lambda s: -sum(
            float(seg["end"]) - float(seg["start"])
            for seg in speaker_segments.get(s, [])
        ),
    )

    clusters: list[list[str]] = []
    possible_merges: list[PossibleMerge] = []

    for spk in sorted_speakers:
        # Find best existing cluster (highest avg sim to its members)
        best_cluster_idx = -1
        best_sim = -1.0
        for idx, cluster in enumerate(clusters):
            sims_to_members = [sim_matrix.get((spk, m), 0.0) for m in cluster]
            avg_sim = float(np.mean(sims_to_members)) if sims_to_members else 0.0
            if avg_sim > best_sim:
                best_sim = avg_sim
                best_cluster_idx = idx

        # No cluster yet, or best sim too low → NEW cluster
        if best_cluster_idx < 0 or best_sim < cosine_merge_low:
            clusters.append([spk])
            continue

        cluster_members = clusters[best_cluster_idx]
        has_timeline_overlap = any(
            timeline_overlaps.get((spk, m), False)
            for m in cluster_members
        )

        # Tier HIGH: sim >= 0.75
        if best_sim >= cosine_merge_high:
            if has_timeline_overlap:
                # HARD CONSTRAINT: timeline overlap → cannot merge
                new_idx = len(clusters)
                clusters.append([spk])
                possible_merges.append(PossibleMerge(
                    characters=[
                        f"CHAR_{best_cluster_idx:03d}",
                        f"CHAR_{new_idx:03d}",
                    ],
                    similarity=round(best_sim, 3),
                    evidences_present=[],
                    evidences_count=0,
                    reason_not_merged="timeline_overlap_hard_constraint",
                ))
                logger.warning(
                    "character_registry: %s sim=%.3f với cluster %d nhưng "
                    "TIMELINE OVERLAP → KHÔNG merge (hard constraint)",
                    spk, best_sim, best_cluster_idx,
                )
                continue
            # HIGH + no overlap → auto merge
            cluster_members.append(spk)
            logger.info(
                "character_registry: HIGH merge %s → cluster %d (sim=%.3f)",
                spk, best_cluster_idx, best_sim,
            )
            continue

        # Tier MEDIUM: 0.65 <= sim < 0.75
        evidence_count, evidence_list = count_supporting_evidences(
            spk, cluster_members,
            speaker_genders=speaker_genders,
            speaker_gender_confs=speaker_gender_confs,
            face_track_to_speaker=face_track_to_speaker,
            timeline_overlaps=timeline_overlaps,
            gender_high_threshold=gender_high_threshold,
        )

        if (
            evidence_count >= min_evidences_for_merge
            and not has_timeline_overlap
        ):
            cluster_members.append(spk)
            logger.info(
                "character_registry: MEDIUM merge %s → cluster %d "
                "(sim=%.3f, evidences=%d %s)",
                spk, best_cluster_idx, best_sim, evidence_count, evidence_list,
            )
        else:
            new_idx = len(clusters)
            clusters.append([spk])
            reason = (
                "timeline_overlap_hard_constraint"
                if has_timeline_overlap
                else f"only_{evidence_count}_evidences_below_min_{min_evidences_for_merge}"
            )
            possible_merges.append(PossibleMerge(
                characters=[
                    f"CHAR_{best_cluster_idx:03d}",
                    f"CHAR_{new_idx:03d}",
                ],
                similarity=round(best_sim, 3),
                evidences_present=evidence_list,
                evidences_count=evidence_count,
                reason_not_merged=reason,
            ))

    # ── Build CharacterProfile per cluster ──
    characters: dict[str, CharacterProfile] = {}
    for idx, cluster in enumerate(clusters):
        char_id = f"CHAR_{idx:03d}"
        profile = _build_character_profile(
            char_id=char_id,
            cluster=cluster,
            sim_matrix=sim_matrix,
            speaker_segments=speaker_segments,
            speaker_genders=speaker_genders,
            speaker_gender_confs=speaker_gender_confs,
            cosine_merge_high=cosine_merge_high,
        )
        characters[char_id] = profile

    registry = CharacterRegistry(
        project_id=project_id,
        characters=characters,
        possible_merges=possible_merges,
    )

    logger.info(
        "character_registry: %d raw_speakers → %d characters · %d possible_merges",
        len(raw_speakers), len(characters), len(possible_merges),
    )

    return registry


def _build_character_profile(
    char_id: str,
    cluster: list[str],
    sim_matrix: dict[tuple[str, str], float],
    speaker_segments: dict[str, list[dict]],
    speaker_genders: dict[str, str],
    speaker_gender_confs: dict[str, float],
    cosine_merge_high: float,
) -> CharacterProfile:
    """Build CharacterProfile từ 1 cluster sources."""
    # Gender vote (weighted by confidence)
    gender_weighted: dict[str, float] = {}
    for m in cluster:
        g = speaker_genders.get(m, "unknown")
        c = float(speaker_gender_confs.get(m, 0.5))
        gender_weighted[g] = gender_weighted.get(g, 0.0) + c

    cluster_gender: str = "unknown"
    cluster_gender_conf: float = 0.0
    if gender_weighted:
        top_g = max(gender_weighted, key=lambda k: gender_weighted[k])
        top_score = gender_weighted[top_g]
        total = sum(gender_weighted.values())
        if top_g != "unknown" and top_score / total >= 0.6:
            cluster_gender = top_g
            voters_confs = [
                speaker_gender_confs.get(m, 0.5)
                for m in cluster
                if speaker_genders.get(m) == top_g
            ]
            cluster_gender_conf = (
                sum(voters_confs) / len(voters_confs) if voters_confs else 0.5
            )
        else:
            cluster_gender_conf = max(0.0, top_score / total) if total > 0 else 0.0

    # Stats
    line_count = sum(len(speaker_segments.get(m, [])) for m in cluster)
    total_duration = sum(
        float(seg["end"]) - float(seg["start"])
        for m in cluster
        for seg in speaker_segments.get(m, [])
    )

    # Merge confidence: 1.0 single source, else avg pairwise sim
    if len(cluster) == 1:
        merge_conf = 1.0
    else:
        pair_sims: list[float] = []
        for i, a in enumerate(cluster):
            for b in cluster[i + 1:]:
                pair_sims.append(sim_matrix.get((a, b), 0.0))
        merge_conf = float(np.mean(pair_sims)) if pair_sims else 1.0

    return CharacterProfile(
        character_id=char_id,
        source_speakers=list(cluster),
        gender=cluster_gender,  # type: ignore[arg-type]
        gender_confidence=round(cluster_gender_conf, 3),
        line_count=line_count,
        total_duration=round(total_duration, 2),
        merge_confidence=round(merge_conf, 3),
        locked=False,
        review_required=(
            merge_conf < cosine_merge_high or cluster_gender == "unknown"
        ),
    )


# ── Apply to segments ─────────────────────────────────────────────

def assign_character_ids_to_segments(
    segments: list[dict],
    registry: CharacterRegistry,
    raw_speaker_field: str = "speaker",
) -> int:
    """Set seg["character_id"] = canonical CHAR_XXX dựa trên registry.

    Args:
      segments: list mutate in-place. Mỗi seg phải có seg[raw_speaker_field].
      registry: CharacterRegistry từ build_character_registry().
      raw_speaker_field: field name chứa raw speaker ID (default "speaker").
        Nếu seg["speaker"] đã là CHAR_XX (từ fusion cũ) → vẫn map qua
        registry (source_speakers liệt kê cả raw đó nếu được include).

    Returns: số segments đã set character_id.

    Fallback rule (spec Phase 5 update):
      Nếu seg có speaker không có trong registry → log warning + KHÔNG set
      character_id (downstream Phase 8 sẽ dùng fallback voice).
    """
    # Reverse map: raw_speaker → character_id
    raw_to_char: dict[str, str] = {}
    for char_id, profile in registry.characters.items():
        for raw_spk in profile.source_speakers:
            raw_to_char[raw_spk] = char_id

    assigned = 0
    missing_count = 0
    for seg in segments:
        raw_spk = seg.get(raw_speaker_field)
        if not raw_spk:
            continue
        char_id = raw_to_char.get(raw_spk)
        if char_id:
            seg["character_id"] = char_id
            assigned += 1
        else:
            missing_count += 1
            logger.warning(
                "assign_character_ids: seg idx=%s speaker=%s NOT in registry — "
                "no character_id assigned (TTS fallback expected)",
                seg.get("index"), raw_spk,
            )
    if missing_count > 0:
        logger.warning(
            "assign_character_ids: %d/%d segments KHÔNG có character_id "
            "(speaker không có trong registry)",
            missing_count, len(segments),
        )
    return assigned


# ── Persist ────────────────────────────────────────────────────────

def save_character_registry(
    registry: CharacterRegistry,
    output_path: Path,
) -> None:
    """Write character_registry.json (pretty JSON UTF-8)."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    js = registry.model_dump_json(indent=2)
    output_path.write_text(js, encoding="utf-8")
    logger.info("Saved character_registry.json: %s", output_path)
