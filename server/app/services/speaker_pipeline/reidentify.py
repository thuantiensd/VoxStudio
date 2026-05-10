"""Phase 4 (cont.) — Cross-scene speaker reidentification.

Pyannote diarization có thể gán SPK khác nhau cho cùng 1 người ở 2 scene
khác nhau (vd cảnh 1 = SPEAKER_00, cảnh 7 = SPEAKER_03). reID merge dựa
trên cosine similarity của speaker embeddings.

Algorithm: agglomerative clustering với cosine distance threshold.
Sau đó renumber thành SPEAKER_00, SPEAKER_01... (stable IDs).
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Optional

import numpy as np

from .types import DiarizationTurn, SpeakerEmbedding

logger = logging.getLogger(__name__)


def _cosine_dist(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine distance assuming a, b are L2-normalized."""
    return 1.0 - float(np.dot(a, b))


def _per_speaker_centroids(
    embeddings: list[SpeakerEmbedding],
) -> dict[str, np.ndarray]:
    """Compute per-(temp)-speaker centroid embedding.

    Pyannote outputs nhiều turns cho cùng 1 SPEAKER_00 — average
    embeddings (weighted by quality) → 1 vector per temp speaker.
    """
    grouped: dict[str, list[tuple[np.ndarray, float]]] = defaultdict(list)
    for e in embeddings:
        grouped[e.speaker_id].append((e.vector, e.quality))
    centroids: dict[str, np.ndarray] = {}
    for spk, vecs in grouped.items():
        if not vecs:
            continue
        # Quality-weighted average
        weights = np.array([max(0.05, q) for _, q in vecs], dtype=np.float32)
        mat = np.stack([v for v, _ in vecs])
        weighted = (mat * weights[:, None]).sum(axis=0) / weights.sum()
        weighted = weighted / (np.linalg.norm(weighted) + 1e-9)
        centroids[spk] = weighted
    return centroids


def reidentify_speakers(
    embeddings: list[SpeakerEmbedding],
    turns: list[DiarizationTurn],
    threshold: float = 0.45,
) -> tuple[list[DiarizationTurn], dict[str, str]]:
    """Merge temp speakers across scenes via embedding clustering.

    Args:
      embeddings: từ Phase 4
      turns: original turns từ Phase 3 (sẽ được rename speaker)
      threshold: cosine distance ≤ threshold → cùng người
                 (0.45 conservative — reduces false-merge)

    Returns:
      (renamed_turns, mapping)
        renamed_turns — turns với speaker thành SPEAKER_00, SPEAKER_01...
        mapping — {old_id: new_id} dùng cho debug

    Algorithm:
      1. Build per-temp-speaker centroid
      2. Agglomerative cluster centroids by cosine distance
      3. Renumber clusters → SPEAKER_00, SPEAKER_01... (in order of first appearance)
    """
    if not embeddings:
        # No embeddings (no HF_TOKEN) → fallback: keep original speaker IDs
        # but renumber to SPEAKER_XX format
        return _fallback_renumber(turns)

    centroids = _per_speaker_centroids(embeddings)
    if not centroids:
        return _fallback_renumber(turns)

    speaker_ids = list(centroids.keys())
    n = len(speaker_ids)
    if n == 0:
        return _fallback_renumber(turns)
    if n == 1:
        # Only 1 speaker → trivial
        new_id = "SPEAKER_00"
        mapping = {speaker_ids[0]: new_id}
        return _apply_mapping(turns, mapping), mapping

    # Build distance matrix
    dist = np.zeros((n, n), dtype=np.float32)
    for i in range(n):
        for j in range(i + 1, n):
            d = _cosine_dist(centroids[speaker_ids[i]], centroids[speaker_ids[j]])
            dist[i, j] = d
            dist[j, i] = d

    # Agglomerative clustering — single linkage with threshold cutoff
    # Use sklearn for correctness (already deps via pyannote)
    try:
        from sklearn.cluster import AgglomerativeClustering
        clusterer = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=threshold,
            metric="precomputed",
            linkage="average",
        )
        labels = clusterer.fit_predict(dist)
    except Exception as e:
        logger.warning("AgglomerativeClustering failed (%s) — fallback no-merge", e)
        labels = np.arange(n)

    # Find first-appearance order of each cluster
    first_seen: dict[int, float] = {}
    for turn in turns:
        if turn.speaker not in speaker_ids:
            continue
        idx = speaker_ids.index(turn.speaker)
        cluster = int(labels[idx])
        if cluster not in first_seen or turn.start < first_seen[cluster]:
            first_seen[cluster] = turn.start

    # Sort clusters by first appearance → assign SPEAKER_00, SPEAKER_01...
    sorted_clusters = sorted(first_seen.keys(), key=lambda c: first_seen[c])
    cluster_to_new = {c: f"SPEAKER_{i:02d}" for i, c in enumerate(sorted_clusters)}

    # Build mapping old_speaker_id → new_id
    mapping: dict[str, str] = {}
    for i, old_id in enumerate(speaker_ids):
        cluster = int(labels[i])
        mapping[old_id] = cluster_to_new[cluster]

    logger.info(
        "ReID: %d temp speakers → %d stable (threshold=%.2f). Mapping: %s",
        n, len(sorted_clusters), threshold, mapping,
    )
    return _apply_mapping(turns, mapping), mapping


def _fallback_renumber(
    turns: list[DiarizationTurn],
) -> tuple[list[DiarizationTurn], dict[str, str]]:
    """No embedding → renumber by first appearance, no merging."""
    seen: dict[str, str] = {}
    for turn in turns:
        if turn.speaker not in seen:
            seen[turn.speaker] = f"SPEAKER_{len(seen):02d}"
    return _apply_mapping(turns, seen), seen


def _apply_mapping(
    turns: list[DiarizationTurn],
    mapping: dict[str, str],
) -> list[DiarizationTurn]:
    return [
        DiarizationTurn(
            start=t.start,
            end=t.end,
            speaker=mapping.get(t.speaker, t.speaker),
        )
        for t in turns
    ]
