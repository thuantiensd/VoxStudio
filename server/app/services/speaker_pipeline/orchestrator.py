"""Pipeline orchestrator — chạy 12 phase end-to-end.

Entry point: `analyze_speakers(audio_path, transcribe_kwargs={...})` →
SpeakerPipelineResult.

Modular: từng phase ném exception riêng → caller catch + retry/log.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

from .types import (
    DiarizationTurn,
    OverlapRegion,
    SpeakerEmbedding,
    SpeakerPipelineResult,
    SpeakerSentence,
    TranscribedSegment,
    TranscribedWord,
)
from .embedding import extract_embeddings, is_available as embedding_available
from .reidentify import reidentify_speakers
from .overlap import detect_overlaps
from .word_assignment import assign_speakers_to_words
from .sentence_grouping import group_words_into_sentences
from .confidence import apply_confidence

logger = logging.getLogger(__name__)


def _run_diarization(audio_path: str, min_speakers: int, max_speakers: int) -> list[DiarizationTurn]:
    """Phase 3 — Pyannote diarization.

    Always tries pyannote first (per spec). Resemblyzer là legacy fallback
    cho dev không có HF_TOKEN.
    """
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
    if token:
        try:
            from app.services.diarize_svc import diarize as pyannote_diarize
            result = pyannote_diarize.diarize(
                audio_path, min_speakers=min_speakers, max_speakers=max_speakers,
            )
            turns = [
                DiarizationTurn(start=s, end=e, speaker=spk)
                for s, e, spk in result.get("turns", [])
            ]
            logger.info("Pyannote diarization: %d turns", len(turns))
            return turns
        except Exception as e:
            logger.warning("Pyannote diarization failed (%s) — fallback Resemblyzer", e)

    # Fallback: Resemblyzer (no HF token, lower quality but works)
    from app.services.resemblyzer_diarize_svc import diarize as resem_diarize
    result = resem_diarize.diarize(
        audio_path, min_speakers=min_speakers, max_speakers=max_speakers,
    )
    return [
        DiarizationTurn(start=s, end=e, speaker=spk)
        for s, e, spk in result.get("turns", [])
    ]


def _run_transcribe_and_align(
    audio_path: str, language: Optional[str] = None,
) -> tuple[list[TranscribedSegment], str]:
    """Phase 6-7 — Transcribe via faster-whisper + WhisperX align.

    Returns (segments_with_words, detected_language).
    """
    from app.services import whisper_svc, whisperx_svc

    # Try whisperx (gives word-level alignment OOTB)
    if whisperx_svc.is_available():
        try:
            res = whisperx_svc.transcribe(
                audio_path, language=language,
                do_align=True, do_diarize=False,
            )
            segments: list[TranscribedSegment] = []
            for s in res.get("segments", []):
                words = [
                    TranscribedWord(
                        word=w.get("word", ""),
                        start=float(w.get("start") or 0.0),
                        end=float(w.get("end") or 0.0),
                        score=float(w.get("score") or 1.0),
                    )
                    for w in (s.get("words") or [])
                    if w.get("start") is not None and w.get("end") is not None
                ]
                segments.append(TranscribedSegment(
                    start=float(s.get("start", 0.0)),
                    end=float(s.get("end", 0.0)),
                    text=s.get("text", ""),
                    words=words,
                ))
            logger.info("WhisperX: %d segments, %d words total",
                        len(segments), sum(len(s.words) for s in segments))
            return segments, res.get("language", language or "auto")
        except Exception as e:
            logger.warning("WhisperX failed (%s) — fallback whisper_svc", e)

    # Fallback: faster-whisper với word_timestamps=True đã ON sẵn
    res = whisper_svc.transcribe(audio_path, language=language)
    segments = []
    for s in res.get("segments", []):
        words = [
            TranscribedWord(
                word=w.get("word", ""),
                start=float(w.get("start") or 0.0),
                end=float(w.get("end") or 0.0),
                score=float(w.get("probability") or 1.0),
            )
            for w in (s.get("words") or [])
            if w.get("start") is not None and w.get("end") is not None
        ]
        segments.append(TranscribedSegment(
            start=float(s.get("start", 0.0)),
            end=float(s.get("end", 0.0)),
            text=s.get("text", ""),
            words=words,
            no_speech_prob=float(s.get("no_speech_prob") or 0.0),
            avg_logprob=float(s.get("avg_logprob") or 0.0),
        ))
    return segments, res.get("language") or language or "auto"


def analyze_speakers(
    audio_path: str,
    *,
    embedding_audio_path: Optional[str] = None,
    language: Optional[str] = None,
    min_speakers: int = 1,
    max_speakers: int = 6,
    reid_threshold: float = 0.45,
    confidence_threshold_review: float = 0.55,
) -> SpeakerPipelineResult:
    """End-to-end speaker pipeline. Production-ready output JSON.

    Args:
      audio_path: clean audio (vocals.wav recommended) cho diarization +
                  transcribe + align.
      embedding_audio_path: optional separate audio cho embedding extract
                            (vd original_audio.wav nếu Demucs làm méo
                            speaker characteristics).
      language: ISO code hoặc None để auto-detect.
      reid_threshold: cosine distance ≤ threshold → cùng speaker (0.45 conservative).
      confidence_threshold_review: sentences below → need_review=True.

    Returns: SpeakerPipelineResult — speaker IDs stable, words/sentences
             với confidence, ready for FE editor.
    """
    t0 = time.time()
    stats: dict = {}

    # ── Phase 3: Diarization ──
    t = time.time()
    turns = _run_diarization(audio_path, min_speakers, max_speakers)
    stats["diarization_seconds"] = round(time.time() - t, 2)
    stats["raw_turns"] = len(turns)

    if not turns:
        logger.warning("No diarization turns — empty result")
        return SpeakerPipelineResult(
            sentences=[], speakers=[], overlaps=[], language=language or "auto", stats=stats,
        )

    # ── Phase 4: Speaker embedding + reID ──
    t = time.time()
    emb_audio = embedding_audio_path or audio_path
    embeddings: list[SpeakerEmbedding] = []
    if embedding_available():
        try:
            embeddings = extract_embeddings(emb_audio, turns)
        except Exception as e:
            logger.warning("Embedding extract failed (%s) — skip reID", e)

    turns, speaker_mapping = reidentify_speakers(
        embeddings, turns, threshold=reid_threshold,
    )
    stats["reid_seconds"] = round(time.time() - t, 2)
    stats["embeddings_used"] = len(embeddings)

    # Stable speaker IDs trong order xuất hiện
    seen: list[str] = []
    for turn in turns:
        if turn.speaker not in seen:
            seen.append(turn.speaker)
    speakers = seen
    stats["unique_speakers"] = len(speakers)

    # ── Phase 5: Overlap detection ──
    t = time.time()
    overlaps = detect_overlaps(audio_path, turns)
    stats["overlap_seconds"] = round(time.time() - t, 2)
    stats["overlap_regions"] = len(overlaps)

    # ── Phase 6-7: Transcribe + align ──
    t = time.time()
    segments, detected_lang = _run_transcribe_and_align(audio_path, language=language)
    stats["transcribe_seconds"] = round(time.time() - t, 2)
    stats["transcribed_segments"] = len(segments)
    stats["transcribed_words"] = sum(len(s.words) for s in segments)

    # ── Phase 8: Word-level speaker assignment ──
    t = time.time()
    assigned_words = assign_speakers_to_words(segments, turns, overlaps)
    stats["word_assignment_seconds"] = round(time.time() - t, 2)

    # ── Phase 9: Sentence grouping ──
    t = time.time()
    sentences = group_words_into_sentences(assigned_words)
    stats["sentence_grouping_seconds"] = round(time.time() - t, 2)
    stats["sentences"] = len(sentences)

    # ── Phase 10: Confidence engine ──
    t = time.time()
    sentences = apply_confidence(sentences, threshold_review=confidence_threshold_review)
    stats["confidence_seconds"] = round(time.time() - t, 2)
    stats["sentences_need_review"] = sum(1 for s in sentences if s.need_review)

    # Filter speakers list to only those that actually have sentences
    used_speakers = {s.speaker_id for s in sentences if s.speaker_id}
    final_speakers = [spk for spk in speakers if spk in used_speakers]
    stats["final_speakers"] = len(final_speakers)
    stats["total_seconds"] = round(time.time() - t0, 2)

    logger.info("Pipeline done in %.1fs: %d speakers, %d sentences (%d need review)",
                stats["total_seconds"], len(final_speakers), len(sentences),
                stats["sentences_need_review"])

    return SpeakerPipelineResult(
        sentences=sentences,
        speakers=final_speakers,
        overlaps=overlaps,
        language=detected_lang,
        stats=stats,
    )
