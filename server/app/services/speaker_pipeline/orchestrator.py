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
from .gender import detect_speaker_genders, detect_speaker_genders_with_confidence

logger = logging.getLogger(__name__)


def _try_pyannote(audio_path: str, min_speakers: int, max_speakers: int) -> list[DiarizationTurn] | None:
    """Pyannote primary. Trả None nếu fail (token, license, network, model)."""
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
    if not token:
        return None
    try:
        from app.services.diarize_svc import diarize as pyannote_diarize
        result = pyannote_diarize.diarize(
            audio_path, min_speakers=min_speakers, max_speakers=max_speakers,
        )
        turns = [
            DiarizationTurn(start=s, end=e, speaker=spk)
            for s, e, spk in result.get("turns", [])
        ]
        logger.info("Pyannote: %d turns, speakers=%s", len(turns),
                    sorted({t.speaker for t in turns}))
        return turns
    except Exception as e:
        logger.warning("Pyannote diarization failed: %s", e)
        return None


def _try_resemblyzer(audio_path: str, min_speakers: int, max_speakers: int) -> list[DiarizationTurn] | None:
    """Resemblyzer secondary. Trả None nếu fail."""
    try:
        from app.services.resemblyzer_diarize_svc import diarize as resem_diarize
        result = resem_diarize.diarize(
            audio_path, min_speakers=min_speakers, max_speakers=max_speakers,
        )
        turns = [
            DiarizationTurn(start=s, end=e, speaker=spk)
            for s, e, spk in result.get("turns", [])
        ]
        logger.info("Resemblyzer: %d turns, speakers=%s", len(turns),
                    sorted({t.speaker for t in turns}))
        return turns
    except Exception as e:
        logger.warning("Resemblyzer diarization failed: %s", e)
        return None


def _vote_diarization(
    pyannote_turns: list[DiarizationTurn] | None,
    resemblyzer_turns: list[DiarizationTurn] | None,
) -> tuple[list[DiarizationTurn], float]:
    """Vote giữa 2 method. Trả (chosen_turns, confidence 0-1).

    Logic:
      - Cả 2 đều có + đồng ý số speaker (±1) → high confidence (0.9), pick pyannote
      - Cả 2 đều có nhưng khác số speaker → medium (0.5), pick pyannote (chính)
      - Chỉ pyannote → 0.7
      - Chỉ resemblyzer → 0.4 (kém hơn nhưng có dữ liệu)
      - Cả 2 fail → 0.0, return []
    """
    if pyannote_turns and resemblyzer_turns:
        n_py = len({t.speaker for t in pyannote_turns})
        n_re = len({t.speaker for t in resemblyzer_turns})
        if abs(n_py - n_re) <= 1:
            confidence = 0.9
            logger.info(
                "Diarize vote: pyannote=%d speakers, resemblyzer=%d → AGREE (conf=%.2f)",
                n_py, n_re, confidence,
            )
        else:
            confidence = 0.5
            logger.warning(
                "Diarize vote: pyannote=%d speakers ≠ resemblyzer=%d → DISAGREE (conf=%.2f), pick pyannote",
                n_py, n_re, confidence,
            )
        return pyannote_turns, confidence
    if pyannote_turns:
        logger.info("Diarize vote: only pyannote available (conf=0.7)")
        return pyannote_turns, 0.7
    if resemblyzer_turns:
        logger.warning("Diarize vote: pyannote down, only resemblyzer (conf=0.4)")
        return resemblyzer_turns, 0.4
    logger.error("Diarize vote: BOTH methods failed → no speaker info")
    return [], 0.0


def _run_diarization(
    audio_path: str, min_speakers: int, max_speakers: int,
) -> tuple[list[DiarizationTurn], float]:
    """Phase 3 — Ensemble diarization (pyannote + resemblyzer).

    Chạy 2 method song song khi có thể, vote kết quả + confidence. Trả
    (turns, diarize_confidence). Confidence được dùng tính sentence
    confidence ở Phase 10.

    Returns: (turns, confidence) — confidence 0-1.
    """
    import concurrent.futures

    # Run cả 2 song song để total time = max(2 method) thay vì sum
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f_py = executor.submit(_try_pyannote, audio_path, min_speakers, max_speakers)
        f_re = executor.submit(_try_resemblyzer, audio_path, min_speakers, max_speakers)
        py_turns = f_py.result(timeout=120)
        re_turns = f_re.result(timeout=120)

    return _vote_diarization(py_turns, re_turns)


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
    turns, diarize_confidence = _run_diarization(audio_path, min_speakers, max_speakers)
    stats["diarize_confidence"] = round(diarize_confidence, 2)
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

    # ── Phase 4b: Gender detection per speaker (4-feature classifier) ──
    # F0 + F0_std + spectral_centroid + formant_F1 → robust hơn F0-only.
    # Confidence < 0.7 → forced "unknown" để voice mapping cycle slot
    # thay vì guess sai (tránh case 2 nữ cùng pitch nhầm thành nam-nữ).
    t = time.time()
    speaker_genders: dict[str, str] = {}
    speaker_genders_full: dict[str, dict] = {}
    try:
        speaker_genders_full = detect_speaker_genders_with_confidence(
            audio_path, turns, speakers,
        )
        speaker_genders = {spk: info["gender"]
                          for spk, info in speaker_genders_full.items()}
    except Exception as e:
        logger.warning("Gender detection failed (%s) — all speakers='unknown'", e)
        speaker_genders = {spk: "unknown" for spk in speakers}
        speaker_genders_full = {spk: {"gender": "unknown", "confidence": 0.0}
                                 for spk in speakers}
    stats["gender_seconds"] = round(time.time() - t, 2)
    stats["genders"] = dict(speaker_genders)
    stats["gender_confidences"] = {
        spk: info.get("confidence", 0.0)
        for spk, info in speaker_genders_full.items()
    }

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
        speaker_genders={spk: speaker_genders.get(spk, "unknown") for spk in final_speakers},
    )
