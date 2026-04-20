"""Video dubbing service — orchestrates STT → edit → TTS → export."""

import asyncio
import concurrent.futures
import json
import logging
import os
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

import ffmpeg
import numpy as np
import soundfile as sf

from app.config import DUBBING_DIR, VOICES_DIR, TTS_DEFAULT_GUIDANCE, TTS_DEFAULT_STEPS, IS_CUDA
from app.core.gpu_manager import gpu
from app.core.storage import load_voice
from app.services import whisper_svc, translate_svc, llm_translate_svc, edge_tts_svc, vocal_separator_svc, gemini_translate_svc, diarize_svc, resemblyzer_diarize_svc

logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────

def _detect_tts_engine() -> str:
    """Auto-detect best TTS engine: OmniVoice if installed, else Edge TTS."""
    try:
        import omnivoice
        return "omnivoice"
    except ImportError:
        logger.info("OmniVoice not installed, falling back to Edge TTS")
        return "edge"


# Default Vietnamese Edge TTS voices per gender
EDGE_VOICE_MALE_VI = "vi-VN-NamMinhNeural"
EDGE_VOICE_FEMALE_VI = "vi-VN-HoaiMyNeural"


def _pick_edge_voice_for_segment(seg: dict, project: dict) -> str | None:
    """Choose an Edge TTS voice for this segment.

    Priority:
      1. Project-wide override `edge_voice` (user-selected in UI)
      2. Per-segment speaker_gender from diarization → Vietnamese male/female preset
      3. None (Edge will use its default)
    """
    # User chose an explicit voice for the whole project
    if project.get("edge_voice"):
        return project["edge_voice"]

    # Auto per-speaker (currently only Vietnamese presets)
    gender = seg.get("speaker_gender")
    if (project.get("target_language") == "vietnamese" and gender):
        if gender == "female":
            return EDGE_VOICE_FEMALE_VI
        if gender == "male":
            return EDGE_VOICE_MALE_VI

    return None


_default_voice_cache = None

def _get_default_voice():
    """Load BLV_Bóng_Đá voice as default. Cached after first load."""
    global _default_voice_cache
    if _default_voice_cache is not None:
        return _default_voice_cache

    # Search for BLV voice in known locations
    import torch as _torch
    from omnivoice.models.omnivoice import VoiceClonePrompt
    _torch.serialization.add_safe_globals([VoiceClonePrompt])
    search_paths = [
        Path("/content/OmniVoice-master/voices/BLV_Bóng_Đá.pt"),
        Path(__file__).parent.parent.parent.parent / "OmniVoice-master" / "voices" / "BLV_Bóng_Đá.pt",
        VOICES_DIR / "BLV_Bóng_Đá.pt",
    ]
    for p in search_paths:
        if p.exists():
            _default_voice_cache = _torch.load(str(p), map_location="cpu", weights_only=True)
            logger.info("Loaded default voice: %s", p.name)
            return _default_voice_cache

    logger.warning("Default BLV voice not found, using no voice prompt")
    return None


def _extract_segment_audio(source_path: str, out_path: str, start: float, end: float):
    """Extract a time slice from an audio file using soundfile."""
    audio_np, sr = sf.read(source_path)
    start_sample = int(start * sr)
    end_sample = int(end * sr)
    segment = audio_np[start_sample:end_sample]
    if len(segment) < sr * 0.3:  # skip if < 0.3s
        raise ValueError(f"Segment too short: {end - start:.2f}s")
    sf.write(out_path, segment, sr)


import re as _re


def _split_long_segment(seg: dict, max_duration: float = 12.0) -> list[dict]:
    """Split a segment longer than max_duration into sub-segments.

    Strategy:
      1. If word-level timestamps available, find largest inter-word silence gap
         (≥50ms) and split there — most accurate, uses real speech boundaries.
      2. Else fall back to sentence-boundary regex with proportional time estimate.

    Recursively splits each piece until <= max_duration.
    """
    duration = seg["end"] - seg["start"]
    if duration <= max_duration:
        return [dict(seg)]

    words = seg.get("words") or []
    text = seg.get("text", "").strip()

    # ── Path A: word-level — find biggest silence gap ──
    if len(words) >= 4:
        gaps = []
        for i in range(1, len(words)):
            gap = words[i]["start"] - words[i - 1]["end"]
            gaps.append((gap, i))
        # Prefer largest gap, tie-break toward middle
        mid_time = seg["start"] + duration / 2
        gaps.sort(key=lambda g: (-g[0], abs(words[g[1]]["start"] - mid_time)))

        if gaps and gaps[0][0] >= 0.05:
            split_idx = gaps[0][1]
            left_words = words[:split_idx]
            right_words = words[split_idx:]
            left_text = "".join(w["word"] for w in left_words).strip()
            right_text = "".join(w["word"] for w in right_words).strip()
            if left_text and right_text:
                left_seg = {
                    "start": seg["start"],
                    "end": left_words[-1]["end"],
                    "text": left_text,
                    "words": left_words,
                }
                right_seg = {
                    "start": right_words[0]["start"],
                    "end": seg["end"],
                    "text": right_text,
                    "words": right_words,
                }
                return _split_long_segment(left_seg, max_duration) + \
                       _split_long_segment(right_seg, max_duration)

    # ── Path B: sentence boundary fallback ──
    if not text:
        return [dict(seg)]

    parts = _re.split(r"(?<=[.!?。！？])\s+", text)
    parts = [p.strip() for p in parts if p.strip()]

    # If no sentence break, force split by comma or half
    if len(parts) < 2:
        parts = _re.split(r"(?<=[,;，；])\s+", text)
        parts = [p.strip() for p in parts if p.strip()]

    if len(parts) < 2:
        # Still one chunk — split text in halves by word count
        words = text.split()
        mid = len(words) // 2
        if mid == 0:
            return [dict(seg)]
        parts = [" ".join(words[:mid]), " ".join(words[mid:])]

    # Estimate timestamps proportional to character count
    total_chars = sum(len(p) for p in parts) or 1
    subs = []
    cursor = seg["start"]
    for i, p in enumerate(parts):
        frac = len(p) / total_chars
        sub_dur = duration * frac
        sub_start = cursor
        sub_end = seg["end"] if i == len(parts) - 1 else cursor + sub_dur
        subs.append({
            "start": round(sub_start, 2),
            "end": round(sub_end, 2),
            "text": p,
        })
        cursor = sub_end

    # Recurse on each piece — proportional split may still leave one too long
    out = []
    for s in subs:
        if s["end"] - s["start"] > max_duration:
            out.extend(_split_long_segment(s, max_duration))
        else:
            out.append(s)
    return out


def _snap_segment_to_words(seg: dict, gap_threshold: float = 0.5,
                            keep_padding: float = 0.2) -> dict:
    """Tighten segment boundaries to actual first/last word times.

    Whisper VAD pads each segment by 200-400ms. With word timestamps we can
    snap start/end to real speech. But we keep `keep_padding` seconds of
    padding so TTS has natural room (avoids speedup pressure when text is
    slightly long for the slot).
    """
    words = seg.get("words") or []
    if not words:
        return dict(seg)

    snapped = dict(seg)
    speech_start = words[0]["start"]
    speech_end = words[-1]["end"]
    # Only snap if the silent padding is BIG enough to justify removing
    if speech_start - seg["start"] > gap_threshold:
        snapped["start"] = round(max(seg["start"], speech_start - keep_padding), 2)
    if seg["end"] - speech_end > gap_threshold:
        snapped["end"] = round(min(seg["end"], speech_end + keep_padding), 2)
    return snapped


def _split_all_long_segments(segments: list[dict], max_duration: float = 12.0) -> list[dict]:
    """Apply _split_long_segment to all segments."""
    out = []
    for seg in segments:
        out.extend(_split_long_segment(seg, max_duration=max_duration))
    return out


def _snap_all_to_words(segments: list[dict]) -> list[dict]:
    """Snap all segment boundaries to actual word timestamps."""
    return [_snap_segment_to_words(s) for s in segments]


def _merge_short_segments(segments: list[dict], min_duration: float = 2.5,
                           max_gap: float = 1.5, max_combined: float = 10.0) -> list[dict]:
    """Merge short segments with their neighbors for better dubbing timing.

    - Segments shorter than min_duration get merged with the next/prev segment
    - Only merge if the gap < max_gap seconds
    - Do NOT let combined segment exceed max_combined (otherwise TTS too long → speedup)
    """
    if not segments:
        return segments

    merged = [dict(segments[0])]

    for seg in segments[1:]:
        prev = merged[-1]
        prev_dur = prev["end"] - prev["start"]
        cur_dur = seg["end"] - seg["start"]
        gap = seg["start"] - prev["end"]
        combined_dur = seg["end"] - prev["start"]

        # Merge if: (prev short OR cur short) AND gap small AND combined not too long
        should_merge = (
            (prev_dur < min_duration or cur_dur < min_duration)
            and gap < max_gap
            and combined_dur <= max_combined
        )
        if should_merge:
            prev["end"] = seg["end"]
            prev["text"] = (prev["text"] + " " + seg["text"]).strip()
        else:
            merged.append(dict(seg))

    return merged


def _trim_sparse_segments(segments: list[dict], max_speech_per_sec: float = 14.0) -> list[dict]:
    """Trim segments where text is too short for the duration (sparse speech).

    If a segment has duration 20s but text fits only 3s of speech (at 14 chars/sec),
    the extra 17s is likely silence in source audio. We shrink the segment end
    to what the text can fill (+ small buffer), letting natural silence fall
    in the gap between segments rather than inside a single segment.
    """
    out = []
    for seg in segments:
        text = seg.get("text", "").strip()
        duration = seg["end"] - seg["start"]
        # Estimated speech duration for this text (Vietnamese ~14 chars/sec)
        estimated_dur = max(1.0, len(text) / max_speech_per_sec)
        # If actual slot is much longer than estimated speech + 2s buffer → shrink
        if duration > estimated_dur * 2 + 2.0:
            new_dur = min(duration, estimated_dur * 1.5 + 1.0)
            new_seg = dict(seg)
            new_seg["end"] = round(seg["start"] + new_dur, 2)
            out.append(new_seg)
        else:
            out.append(dict(seg))
    return out


def _project_dir(project_id: str) -> Path:
    return DUBBING_DIR / project_id


def _segments_dir(project_id: str) -> Path:
    d = _project_dir(project_id) / "segments"
    d.mkdir(exist_ok=True)
    return d


def _meta_path(project_id: str) -> Path:
    return _project_dir(project_id) / "project.json"


def _save_meta(project: dict):
    path = _meta_path(project["id"])
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_meta(project_id: str) -> dict | None:
    path = _meta_path(project_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _fmt_time(seconds: float) -> str:
    m, s = divmod(seconds, 60)
    h, m = divmod(int(m), 60)
    return f"{h:02d}:{int(m):02d}:{s:05.2f}"


# ── Project CRUD ────────────────────────────────────

def create_project(video_data: bytes, video_filename: str,
                   target_language: str, voice_id: str = None,
                   source_language: str = "auto",
                   enable_dubbing: bool = True,
                   enable_subtitle: bool = False) -> dict:
    """Create dubbing project: save video, extract audio."""
    project_id = uuid.uuid4().hex[:12]
    pdir = _project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)

    # Save video
    video_path = pdir / "original.mp4"
    video_path.write_bytes(video_data)

    # Extract audio with ffmpeg
    audio_path = pdir / "original_audio.wav"
    try:
        (
            ffmpeg
            .input(str(video_path))
            .output(str(audio_path), acodec="pcm_s16le", ac=1, ar=16000)
            .overwrite_output()
            .run(quiet=True)
        )
    except ffmpeg.Error as e:
        shutil.rmtree(pdir, ignore_errors=True)
        raise ValueError(f"Failed to extract audio: {e}")

    # Get video duration
    try:
        probe = ffmpeg.probe(str(video_path))
        duration = float(probe["format"]["duration"])
    except Exception:
        duration = 0.0

    # Generate thumbnail (frame ở giây thứ 1, hoặc giữa video nếu ngắn hơn)
    try:
        thumb_path = pdir / "thumbnail.jpg"
        thumb_at = min(1.0, max(0.0, duration / 2)) if duration > 0 else 0
        (
            ffmpeg
            .input(str(video_path), ss=thumb_at)
            .output(str(thumb_path), vframes=1, **{"q:v": 4})
            .overwrite_output()
            .run(quiet=True)
        )
    except Exception as e:
        logger.warning("Thumbnail generation failed: %s", e)

    project = {
        "id": project_id,
        "status": "created",
        "source_language": None,
        "source_language_input": source_language,
        "target_language": target_language,
        "voice_id": voice_id,
        "tts_engine": _detect_tts_engine(),
        "edge_voice": None,    # Edge TTS voice name, auto-selected if None
        "enable_dubbing": enable_dubbing,
        "enable_subtitle": enable_subtitle,
        "subtitle_style": {
            "font_family": "Arial",
            "font_size": 24,
            "font_color": "#FFFFFF",
            "font_bold": False,
            "font_italic": False,
            "bg_color": "#000000",
            "bg_opacity": 0.6,
            "outline_color": "#000000",
            "outline_width": 2,
            "shadow_offset": 1,
            "position": "bottom",
            "margin_v": 30,
        },
        "segments": [],
        "video_filename": video_filename,
        "video_duration": round(duration, 2),
        "created_at": datetime.now().isoformat(),
    }
    _save_meta(project)
    logger.info("Dubbing project created: %s (%.1fs)", project_id, duration)
    return project


def get_project(project_id: str) -> dict | None:
    return _load_meta(project_id)


def list_projects() -> list[dict]:
    projects = []
    for d in sorted(DUBBING_DIR.iterdir()):
        if d.is_dir():
            meta = _load_meta(d.name)
            if meta:
                projects.append(meta)
    return projects


def delete_project(project_id: str) -> bool:
    pdir = _project_dir(project_id)
    if pdir.exists():
        shutil.rmtree(pdir)
        return True
    return False


# ── Vocal Separation ───────────────────────────────

def separate_vocals(project_id: str) -> dict:
    """Separate vocals from accompaniment (music/SFX) using Demucs."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    pdir = _project_dir(project_id)
    audio_path = pdir / "original_audio.wav"
    if not audio_path.exists():
        raise ValueError("Original audio not found")

    project["vocal_separation_status"] = "processing"
    _save_meta(project)

    try:
        result = vocal_separator_svc.separate(str(audio_path), str(pdir))
        project["vocal_separation_status"] = "done"
        project["has_accompaniment"] = True
        _save_meta(project)
        logger.info("Vocal separation done for project %s", project_id)
        return project
    except Exception as e:
        project["vocal_separation_status"] = "error"
        _save_meta(project)
        raise ValueError(f"Vocal separation failed: {e}")


def get_vocals_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "vocals.wav"
    return path if path.exists() else None


def get_accompaniment_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "accompaniment.wav"
    return path if path.exists() else None


# ── Transcribe ──────────────────────────────────────

def transcribe_project(project_id: str) -> dict:
    """Run Demucs (auto) → Whisper on vocals for cleaner transcription."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError(f"Project '{project_id}' not found")

    project["status"] = "transcribing"
    _save_meta(project)

    pdir = _project_dir(project_id)
    audio_path = str(pdir / "original_audio.wav")

    # Step 1: Auto-separate vocals (Demucs) if not already done
    # Transcribing on clean vocals gives much better accuracy
    if not vocal_separator_svc.is_separated(str(pdir)):
        try:
            logger.info("Auto-separating vocals before transcription (Demucs)...")
            vocal_separator_svc.separate(audio_path, str(pdir))
            project["has_accompaniment"] = True
            _save_meta(project)
        except Exception as e:
            logger.warning("Vocal separation failed, transcribing full audio: %s", e)

    # Step 2: Pre-amplify vocals (compressor + LUFS norm) so Whisper catches
    # quiet whispers / internal monologues that VAD would otherwise filter as silence.
    vocals_path = pdir / "vocals.wav"
    audio_to_transcribe = str(vocals_path) if vocals_path.exists() else audio_path

    if vocals_path.exists():
        try:
            from app.services.audio_mix_svc import normalize_for_stt
            normalized_path = pdir / "vocals_normalized.wav"
            normalize_for_stt(str(vocals_path), str(normalized_path))
            audio_to_transcribe = str(normalized_path)
            logger.info("Pre-amplified vocals for STT (catches quiet speech)")
        except Exception as e:
            logger.warning("STT pre-amp failed (%s), using raw vocals", e)

    logger.info("Transcribing: %s", audio_to_transcribe)

    src_lang = project.get("source_language_input", "auto")
    result = whisper_svc.transcribe(audio_to_transcribe, language=src_lang if src_lang != "auto" else None)

    raw_segs = result.get("segments", [])

    # Fallback: if Demucs vocals are too degraded and no segments detected,
    # retry on the original mixed audio
    if not raw_segs and audio_to_transcribe != audio_path:
        logger.warning("No segments from vocals.wav — retrying on original mixed audio")
        result = whisper_svc.transcribe(
            audio_path,
            language=src_lang if src_lang != "auto" else None,
        )
        raw_segs = result.get("segments", [])

    # Post-process pipeline (order matters — each step depends on prev):
    # 1. Snap each segment's start/end to actual word timestamps (remove VAD padding)
    snapped = _snap_all_to_words(raw_segs)
    snap_savings = sum(
        (raw["end"] - raw["start"]) - (s["end"] - s["start"])
        for raw, s in zip(raw_segs, snapped)
    )
    logger.info("Post-process: snap-to-words removed %.1fs of silent edges", snap_savings)

    # 2. Split segments > 12s using word-level silence gaps (real time, not estimate)
    split_segs = _split_all_long_segments(snapped, max_duration=12.0)
    logger.info("Post-process: %d segments after split-long (was %d snapped)",
                len(split_segs), len(snapped))

    # 3. Trim sparse-speech segments (text too short for slot duration)
    trimmed = _trim_sparse_segments(split_segs, max_speech_per_sec=14.0)
    logger.info("Post-process: %d segments after trim-sparse", len(trimmed))

    # 4. Merge adjacent short segments (< 2.5s, gap < 1.5s, combined <= 10s)
    merged = _merge_short_segments(trimmed, min_duration=2.5, max_gap=1.5, max_combined=10.0)
    logger.info("Post-process: %d segments after merge-short (final)", len(merged))

    # ── Diarization: gán speaker + gender cho từng segment ──
    # Default: Resemblyzer (no token, MIT, ~17MB).
    # If HF_TOKEN is set AND DIARIZE_BACKEND=pyannote → use pyannote (better quality).
    speaker_genders = {}
    diarize_backend = os.getenv("DIARIZE_BACKEND", "resemblyzer").lower()
    use_pyannote = diarize_backend == "pyannote" and os.getenv("HF_TOKEN")

    try:
        diar_audio = str(vocals_path) if vocals_path.exists() else audio_path
        if use_pyannote:
            logger.info("Diarization backend: pyannote (HF_TOKEN set)")
            diar_module = diarize_svc.diarize
        else:
            logger.info("Diarization backend: Resemblyzer (default, no token)")
            diar_module = resemblyzer_diarize_svc.diarize

        diar_result = diar_module.diarize(diar_audio, min_speakers=1, max_speakers=6)
        merged = diar_module.assign_speaker_to_segments(merged, diar_result["turns"])
        speaker_genders = diar_result.get("speaker_genders", {})
        logger.info("Diarization: %d speakers %s",
                    len(diar_result["speakers"]), speaker_genders)
    except Exception as e:
        logger.warning("Diarization skipped (%s) — segments will have speaker=None", e)

    segments = []
    for i, seg in enumerate(merged):
        segments.append({
            "id": uuid.uuid4().hex[:8],
            "index": i,
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "original_text": seg["text"],
            "translated_text": "",
            "speech_text": "",
            "emotion": "neutral",
            "voice_id": None,
            "speaker": seg.get("speaker"),
            "speaker_gender": speaker_genders.get(seg.get("speaker")) if seg.get("speaker") else None,
            "volume": 1.0,
            "fade_in": 0.0,
            "fade_out": 0.0,
            "status": "pending",
        })

    project["segments"] = segments
    project["source_language"] = result.get("language")
    project["speaker_genders"] = speaker_genders
    project["status"] = "editing"
    _save_meta(project)
    logger.info("Transcribed %d segments for project %s", len(segments), project_id)
    return project


# ── Translate ──────────────────────────────────────

def translate_project(project_id: str, use_llm: bool = False, engine: str = "google") -> dict:
    """Auto-translate all segments to target language.

    Args:
        engine: "google" (default) or "gemini" (context-aware film translation)
        use_llm: if True and engine="google", polish with Qwen LLM
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError(f"Project '{project_id}' not found")

    target_lang = project["target_language"]
    source_lang = project.get("source_language") or "auto"

    if engine == "gemini" and gemini_translate_svc.is_available():
        # Gemini: context-aware film translation with pronouns + emotion
        logger.info("Translating %d segments with Gemini (context-aware)...", len(project["segments"]))
        results = gemini_translate_svc.translate_segments(
            project["segments"], target_lang, source_lang,
        )
        for seg, result in zip(project["segments"], results):
            if result["translated_text"]:
                seg["translated_text"] = result["translated_text"]
                seg["speech_text"] = result["speech_text"] or result["translated_text"]
                seg["emotion"] = result.get("emotion", "neutral")
        method = "Gemini"
    elif engine == "qwen":
        # Qwen: full local translation + emotion (no internet needed)
        logger.info("Translating %d segments with Qwen (local LLM)...", len(project["segments"]))
        results = llm_translate_svc.translate_segments(
            project["segments"], target_lang, source_lang,
        )
        for seg, result in zip(project["segments"], results):
            if result["translated_text"]:
                seg["translated_text"] = result["translated_text"]
                seg["speech_text"] = result["speech_text"] or result["translated_text"]
                seg["emotion"] = result.get("emotion", "neutral")
        method = "Qwen"
    else:
        # Google Translate + optional Qwen LLM polish
        texts = [seg["original_text"] for seg in project["segments"]]
        logger.info("Step 1: Google Translate %d segments...", len(texts))
        translated = translate_svc.translate_batch(texts, target_lang, source_lang)

        for seg, trans in zip(project["segments"], translated):
            if trans:
                seg["translated_text"] = trans
                seg["speech_text"] = trans
                seg["emotion"] = "neutral"

        if use_llm and IS_CUDA:
            logger.info("Step 2: Qwen polish (emotion + pauses) with duration hints...")
            try:
                durations = [seg["end"] - seg["start"] for seg in project["segments"]]
                polished = llm_translate_svc.polish_for_speech(translated, target_lang, durations=durations)
                for seg, result in zip(project["segments"], polished):
                    if result.get("speech_text"):
                        seg["speech_text"] = result["speech_text"]
                        seg["emotion"] = result.get("emotion", "neutral")
            except Exception as e:
                logger.warning("Qwen polish failed, using Google Translate only: %s", e)
        elif use_llm and not IS_CUDA:
            logger.info("Skipping Qwen polish (no CUDA, model too heavy for MPS/CPU)")
        method = "Google + Qwen" if (use_llm and IS_CUDA) else "Google"

    _save_meta(project)
    logger.info("Translated %d segments for project %s → %s (%s)",
                len(project["segments"]), project_id, target_lang, method)
    return project


# ── Segment CRUD ────────────────────────────────────

def update_segment(project_id: str, seg_id: str, update: dict) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    # Fields that can be set to None (to reset to project default)
    nullable_fields = {"voice_id"}

    for seg in project["segments"]:
        if seg["id"] == seg_id:
            for k, v in update.items():
                if k in seg and (v is not None or k in nullable_fields):
                    seg[k] = v
            _save_meta(project)
            return project
    raise ValueError(f"Segment '{seg_id}' not found")


def delete_segment(project_id: str, seg_id: str) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    project["segments"] = [s for s in project["segments"] if s["id"] != seg_id]
    # Re-index
    for i, seg in enumerate(project["segments"]):
        seg["index"] = i
    _save_meta(project)

    # Remove audio file if exists
    audio = _segments_dir(project_id) / f"{seg_id}.wav"
    if audio.exists():
        audio.unlink()

    return project


def split_segment(project_id: str, seg_id: str, split_at: float) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    new_segments = []
    for seg in project["segments"]:
        if seg["id"] == seg_id:
            if split_at <= seg["start"] or split_at >= seg["end"]:
                raise ValueError("split_at must be between start and end")

            # First half
            seg1 = {**seg, "id": uuid.uuid4().hex[:8], "end": round(split_at, 2)}
            # Second half
            seg2 = {**seg, "id": uuid.uuid4().hex[:8], "start": round(split_at, 2),
                     "translated_text": "", "speech_text": "", "emotion": "neutral",
                     "status": "pending"}
            new_segments.extend([seg1, seg2])
        else:
            new_segments.append(seg)

    for i, s in enumerate(new_segments):
        s["index"] = i

    project["segments"] = new_segments
    _save_meta(project)
    return project


def merge_segments(project_id: str, seg_ids: list[str]) -> dict:
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    to_merge = [s for s in project["segments"] if s["id"] in seg_ids]
    if len(to_merge) < 2:
        raise ValueError("Need at least 2 segments to merge")

    to_merge.sort(key=lambda s: s["start"])
    merged = {
        "id": uuid.uuid4().hex[:8],
        "index": 0,
        "start": to_merge[0]["start"],
        "end": to_merge[-1]["end"],
        "original_text": " ".join(s["original_text"] for s in to_merge),
        "translated_text": " ".join(s["translated_text"] for s in to_merge if s["translated_text"]),
        "speech_text": " ".join(s.get("speech_text", "") for s in to_merge if s.get("speech_text")),
        "emotion": to_merge[0].get("emotion", "neutral"),
        "voice_id": to_merge[0].get("voice_id"),
        "volume": to_merge[0]["volume"],
        "fade_in": to_merge[0]["fade_in"],
        "fade_out": to_merge[-1]["fade_out"],
        "status": "pending",
    }

    merge_set = set(seg_ids)
    new_segments = []
    inserted = False
    for seg in project["segments"]:
        if seg["id"] in merge_set:
            if not inserted:
                new_segments.append(merged)
                inserted = True
        else:
            new_segments.append(seg)

    for i, s in enumerate(new_segments):
        s["index"] = i

    project["segments"] = new_segments
    _save_meta(project)

    # Clean up old audio files
    for sid in seg_ids:
        f = _segments_dir(project_id) / f"{sid}.wav"
        if f.exists():
            f.unlink()

    return project


# ── Generate TTS ────────────────────────────────────

def generate_segment(project_id: str, seg_id: str) -> dict:
    """Generate TTS audio for one segment with duration matching."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    seg = next((s for s in project["segments"] if s["id"] == seg_id), None)
    if not seg:
        raise ValueError(f"Segment '{seg_id}' not found")

    # Use speech_text for TTS (has pauses/rewrites), fall back to translated_text
    tts_text = (seg.get("speech_text") or seg["translated_text"] or "").strip()
    if not tts_text:
        raise ValueError("No translated text for this segment")

    seg["status"] = "generating"
    _save_meta(project)

    target_duration = seg["end"] - seg["start"]
    tts_engine = project.get("tts_engine", "edge")
    out_path = _segments_dir(project_id) / f"{seg_id}.wav"

    try:
        if tts_engine == "edge":
            # ── Edge TTS with smart speed matching ──
            seg_dir = _segments_dir(project_id)
            mp3_path = seg_dir / f"{seg_id}.mp3"
            # Auto per-speaker voice based on diarization gender
            edge_voice = _pick_edge_voice_for_segment(seg, project)
            lang = project["target_language"] or "vietnamese"

            # Pass 1: generate at 1x
            _edge_generate_sync(tts_text, str(mp3_path), language=lang,
                                voice=edge_voice, speed=1.0)
            _mp3_to_wav(mp3_path, out_path)

            audio_np, sr = sf.read(str(out_path))
            actual_dur = len(audio_np) / sr
            ratio = actual_dur / target_duration if target_duration > 0 else 1.0

            # Pass 2: if too far off, re-generate with native speed
            if abs(ratio - 1.0) > SPEED_TOLERANCE:
                edge_speed = max(MIN_EDGE_SPEED, min(MAX_EDGE_SPEED, ratio))
                mp3_v2 = seg_dir / f"{seg_id}_v2.mp3"
                _edge_generate_sync(tts_text, str(mp3_v2), language=lang,
                                    voice=edge_voice, speed=edge_speed)
                _mp3_to_wav(mp3_v2, out_path)
                audio_np, sr = sf.read(str(out_path))
                actual_dur = len(audio_np) / sr
                ratio = actual_dur / target_duration if target_duration > 0 else 1.0

            # Fine-tune with atempo
            if actual_dur > 0 and abs(ratio - 1.0) > 0.03:
                stretched = seg_dir / f"{seg_id}_stretched.wav"
                _atempo_stretch(out_path, stretched, ratio)
                audio_np, sr = sf.read(str(stretched))
                stretched.unlink(missing_ok=True)

        else:
            # ── OmniVoice (local GPU) ──
            voice_prompt = None

            # Use saved voice or default BLV voice
            voice_id = seg.get("voice_id") or project.get("voice_id")
            if voice_id:
                voice_prompt = load_voice(voice_id)
            else:
                # Auto-load default BLV voice from OmniVoice-master/voices/
                voice_prompt = _get_default_voice()

            from omnivoice import OmniVoiceGenerationConfig
            # Match TTS preview params (no duration constraint, default guidance) —
            # forcing `duration=` + high guidance_scale was producing choppy/muddy voice
            gen_config = OmniVoiceGenerationConfig(
                num_step=TTS_DEFAULT_STEPS,
                guidance_scale=TTS_DEFAULT_GUIDANCE,
            )
            kwargs = {"generation_config": gen_config}
            if project["target_language"]:
                kwargs["language"] = project["target_language"]

            waveform = gpu.generate_tts(tts_text, voice_prompt=voice_prompt, **kwargs)
            sr = gpu.sampling_rate
            audio_np = waveform.cpu().numpy()

            # ── Auto-align: ONLY speed up if TTS is too long for slot ──
            # Atempo < 1.0 (slowing down short TTS) muddies the voice; instead
            # just let silence fill the gap naturally. Only compress when needed
            # to prevent overlap with next segment.
            actual_dur = len(audio_np) / sr
            if target_duration > 0 and actual_dur > target_duration * 1.15:
                ratio = actual_dur / target_duration
                # Cap at 1.3x — beyond that atempo creates "rushed/chipmunk" artifact.
                # If still too long, accept slight overlap into next segment.
                ratio_clamped = min(1.3, ratio)
                logger.info("OmniVoice speed-up: actual=%.2fs target=%.2fs ratio=%.2f (capped=%.2f)",
                            actual_dur, target_duration, ratio, ratio_clamped)
                seg_dir = _segments_dir(project_id)
                raw_wav = seg_dir / f"{seg_id}_raw.wav"
                stretched_wav = seg_dir / f"{seg_id}_stretched.wav"
                sf.write(str(raw_wav), audio_np, sr)
                try:
                    _atempo_stretch(raw_wav, stretched_wav, ratio_clamped)
                    audio_np, sr = sf.read(str(stretched_wav))
                finally:
                    raw_wav.unlink(missing_ok=True)
                    stretched_wav.unlink(missing_ok=True)
            elif actual_dur < target_duration * 0.9:
                logger.info("OmniVoice short-fill: actual=%.2fs target=%.2fs (silence padding)",
                            actual_dur, target_duration)

        # Apply volume
        if seg.get("volume", 1.0) != 1.0:
            audio_np = audio_np * seg["volume"]

        # Apply fade in/out
        if seg.get("fade_in", 0) > 0:
            fade_samples = min(int(seg["fade_in"] * sr), len(audio_np))
            audio_np[:fade_samples] *= np.linspace(0, 1, fade_samples)

        if seg.get("fade_out", 0) > 0:
            fade_samples = min(int(seg["fade_out"] * sr), len(audio_np))
            audio_np[-fade_samples:] *= np.linspace(1, 0, fade_samples)

        # Save final wav
        sf.write(str(out_path), audio_np, sr)

        seg["status"] = "done"
        _save_meta(project)
        logger.info("Generated segment %s (%.1fs) via %s", seg_id, target_duration, tts_engine)

    except Exception as e:
        seg["status"] = "error"
        _save_meta(project)
        import traceback
        logger.error("Generate segment %s FAILED (engine=%s): %s\n%s",
                     seg_id, tts_engine, e, traceback.format_exc())
        raise ValueError(f"Generation failed: {e}")

    return project


def generate_all(project_id: str):
    """Generate TTS for all segments using batch pipeline for Edge TTS."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    tts_engine = project.get("tts_engine", "edge")

    if tts_engine == "edge":
        yield from _generate_all_batched(project_id, project)
    else:
        yield from _generate_all_single(project_id, project)


def _generate_all_single(project_id: str, project: dict):
    """Original per-segment generation (for VoxLocal/OmniVoice)."""
    segments = [s for s in project["segments"]
                if (s.get("speech_text") or s["translated_text"] or "").strip()]
    total = len(segments)

    for i, seg in enumerate(segments):
        if seg["status"] == "done":
            yield {"current": i + 1, "total": total, "segment_id": seg["id"], "status": "skipped"}
            continue
        try:
            generate_segment(project_id, seg["id"])
            yield {"current": i + 1, "total": total, "segment_id": seg["id"], "status": "done"}
        except Exception as e:
            yield {"current": i + 1, "total": total, "segment_id": seg["id"],
                   "status": "error", "error": str(e)}


# ── Batch TTS Pipeline (Edge TTS) ─────────────────

MAX_BATCH_DURATION = 30.0   # Max seconds per batch
MAX_BATCH_SEGMENTS = 8      # Max segments per batch
MIN_SEGMENT_GAP = 2.0       # If gap > this, start new batch


def _group_segments_into_batches(segments: list[dict]) -> list[list[dict]]:
    """Group consecutive segments into batches for natural TTS.

    Rules:
    - Combine adjacent segments until batch duration > MAX_BATCH_DURATION
    - Or segment count > MAX_BATCH_SEGMENTS
    - Or gap between segments > MIN_SEGMENT_GAP (scene change)
    """
    batches = []
    current_batch = []

    def seg_speaker(s):
        # Group by (speaker, gender) so each batch uses one Edge voice
        return (s.get("speaker"), s.get("speaker_gender"))

    for seg in segments:
        text = (seg.get("speech_text") or seg["translated_text"] or "").strip()
        if not text:
            continue

        if not current_batch:
            current_batch.append(seg)
            continue

        prev = current_batch[-1]
        gap = seg["start"] - prev["end"]
        batch_duration = seg["end"] - current_batch[0]["start"]

        # Start new batch if: too long, too many segments, big gap, or speaker change
        if (batch_duration > MAX_BATCH_DURATION
                or len(current_batch) >= MAX_BATCH_SEGMENTS
                or gap > MIN_SEGMENT_GAP
                or seg_speaker(seg) != seg_speaker(prev)):
            batches.append(current_batch)
            current_batch = [seg]
        else:
            current_batch.append(seg)

    if current_batch:
        batches.append(current_batch)

    return batches


def _edge_generate_sync(text: str, out_path: str, language: str,
                        voice: str = None, speed: float = 1.0):
    """Run async edge_tts.generate in a separate thread (safe from FastAPI loop)."""
    def _run():
        asyncio.run(
            edge_tts_svc.generate(text, out_path, language=language,
                                  voice=voice, speed=speed)
        )
    with concurrent.futures.ThreadPoolExecutor() as pool:
        pool.submit(_run).result()


def _mp3_to_wav(mp3_path: Path, wav_path: Path, sr: int = 24000):
    """Convert mp3 → wav via ffmpeg."""
    (
        ffmpeg.input(str(mp3_path))
        .output(str(wav_path), acodec="pcm_s16le", ac=1, ar=sr)
        .overwrite_output()
        .run(quiet=True)
    )
    mp3_path.unlink(missing_ok=True)


def _atempo_stretch(in_path: Path, out_path: Path, tempo: float):
    """Time-stretch audio with ffmpeg atempo (handles 0.5-2.0 range by chaining)."""
    filters = []
    t = tempo
    while t > 2.0:
        filters.append("atempo=2.0")
        t /= 2.0
    while t < 0.5:
        filters.append("atempo=0.5")
        t *= 2.0
    filters.append(f"atempo={t:.4f}")

    (
        ffmpeg.input(str(in_path))
        .output(str(out_path), af=",".join(filters),
                acodec="pcm_s16le", ac=1, ar=24000)
        .overwrite_output()
        .run(quiet=True)
    )


SPEED_TOLERANCE = 0.15  # 15% — within this, only use atempo fine-tune
MAX_EDGE_SPEED = 2.0    # Edge TTS max rate
MIN_EDGE_SPEED = 0.5    # Edge TTS min rate


def _generate_all_batched(project_id: str, project: dict):
    """Batch TTS → continuous dubbed track.

    1. Group segments into batches
    2. Generate combined TTS per batch with smart speed matching
    3. Place each batch at the correct time position in a full-length track
    4. Save as dubbed_track.wav — one continuous file, no choppiness
    """
    segments = project["segments"]
    batches = _group_segments_into_batches(segments)
    total = sum(len(b) for b in batches)
    done_count = 0

    target_lang = project.get("target_language") or "vietnamese"
    seg_dir = _segments_dir(project_id)
    sr = 24000

    # Full track: silence array covering entire video duration
    video_duration = project.get("video_duration", 0)
    if video_duration <= 0:
        # Estimate from last segment
        video_duration = max((s["end"] for s in segments), default=60)
    track_samples = int(video_duration * sr) + sr  # +1s buffer
    full_track = np.zeros(track_samples, dtype=np.float64)

    for batch_idx, batch in enumerate(batches):
        # Skip if all done
        if all(s["status"] == "done" for s in batch):
            for s in batch:
                done_count += 1
                yield {"current": done_count, "total": total,
                       "segment_id": s["id"], "status": "skipped"}
            # Still load existing batch audio into track if available
            _load_existing_into_track(full_track, batch, seg_dir, sr)
            continue

        try:
            # ── Step 1: Combine text ──
            combined_parts = []
            for s in batch:
                text = (s.get("speech_text") or s["translated_text"] or "").strip()
                combined_parts.append(text)
            combined_text = "... ".join(combined_parts)

            batch_start = batch[0]["start"]
            batch_end = batch[-1]["end"]
            target_duration = batch_end - batch_start

            # Per-batch voice: pick based on the batch's speaker/gender
            edge_voice = _pick_edge_voice_for_segment(batch[0], project)

            batch_mp3 = seg_dir / f"_batch_{batch_idx}.mp3"
            batch_wav = seg_dir / f"_batch_{batch_idx}.wav"

            # ── Step 2: Generate at 1x speed ──
            _edge_generate_sync(combined_text, str(batch_mp3),
                                language=target_lang, voice=edge_voice, speed=1.0)
            _mp3_to_wav(batch_mp3, batch_wav)

            batch_audio, _ = sf.read(str(batch_wav))
            actual_duration = len(batch_audio) / sr
            speed_ratio = actual_duration / target_duration if target_duration > 0 else 1.0

            logger.info("Batch %d: target=%.1fs, actual=%.1fs, ratio=%.2f",
                        batch_idx + 1, target_duration, actual_duration, speed_ratio)

            # ── Step 3: Re-generate with native speed if needed ──
            if abs(speed_ratio - 1.0) > SPEED_TOLERANCE:
                edge_speed = max(MIN_EDGE_SPEED, min(MAX_EDGE_SPEED, speed_ratio))
                logger.info("Batch %d: re-gen at %.2fx native speed", batch_idx + 1, edge_speed)
                batch_mp3_v2 = seg_dir / f"_batch_{batch_idx}_v2.mp3"
                _edge_generate_sync(combined_text, str(batch_mp3_v2),
                                    language=target_lang, voice=edge_voice,
                                    speed=edge_speed)
                _mp3_to_wav(batch_mp3_v2, batch_wav)
                batch_audio, _ = sf.read(str(batch_wav))
                actual_duration = len(batch_audio) / sr
                speed_ratio = actual_duration / target_duration if target_duration > 0 else 1.0

            # ── Step 4: Fine-tune with atempo ──
            if actual_duration > 0 and abs(speed_ratio - 1.0) > 0.03:
                stretched_wav = seg_dir / f"_batch_{batch_idx}_final.wav"
                _atempo_stretch(batch_wav, stretched_wav, speed_ratio)
                batch_audio, _ = sf.read(str(stretched_wav))
                stretched_wav.unlink(missing_ok=True)

            batch_wav.unlink(missing_ok=True)

            # ── Step 5: Place batch audio at correct position in full track ──
            start_sample = int(batch_start * sr)
            end_sample = start_sample + len(batch_audio)
            # Ensure we don't overflow
            if end_sample > len(full_track):
                full_track = np.pad(full_track, (0, end_sample - len(full_track)))
            full_track[start_sample:start_sample + len(batch_audio)] += batch_audio

            # Also save individual segment files (for preview in Voice Settings)
            for s in batch:
                s["status"] = "done"
                done_count += 1
                yield {"current": done_count, "total": total,
                       "segment_id": s["id"], "status": "done"}

            _save_meta(project)
            logger.info("Batch %d done: %d segments, %.1fs",
                        batch_idx + 1, len(batch), target_duration)

        except Exception as e:
            logger.error("Batch %d failed: %s", batch_idx + 1, e)
            for s in batch:
                if s["status"] != "done":
                    s["status"] = "error"
                    done_count += 1
                    yield {"current": done_count, "total": total,
                           "segment_id": s["id"], "status": "error", "error": str(e)}
            _save_meta(project)

    # ── Step 6: Save full dubbed track ──
    track_path = _project_dir(project_id) / "dubbed_track.wav"
    # Normalize to prevent clipping
    peak = np.max(np.abs(full_track))
    if peak > 0.95:
        full_track = full_track * (0.95 / peak)
    sf.write(str(track_path), full_track.astype(np.float32), sr)
    logger.info("Dubbed track saved: %s (%.1fs)", track_path, len(full_track) / sr)


def _load_existing_into_track(full_track: np.ndarray, batch: list[dict],
                               seg_dir: Path, sr: int):
    """Load previously generated batch audio into the full track (for skipped batches)."""
    # Try to find any existing segment audio and place it
    for s in batch:
        wav_path = seg_dir / f"{s['id']}.wav"
        if wav_path.exists():
            audio, _ = sf.read(str(wav_path))
            start = int(s["start"] * sr)
            end = start + len(audio)
            if end <= len(full_track):
                full_track[start:end] += audio


def get_segment_audio_path(project_id: str, seg_id: str) -> Path | None:
    path = _segments_dir(project_id) / f"{seg_id}.wav"
    return path if path.exists() else None


# ── Export Video ────────────────────────────────────

def _apply_ducking(bgm: np.ndarray, dubbed: np.ndarray, sr: int,
                   duck_level: float = 0.15, attack: float = 0.05,
                   release: float = 0.3) -> np.ndarray:
    """Apply smart audio ducking — reduce BGM volume when dubbed voice is present.

    Uses an envelope follower with attack/release smoothing:
    - When voice detected → BGM fades down to duck_level
    - When voice stops → BGM fades back up (release time)
    """
    # Handle stereo BGM → convert to mono for processing, remix later
    bgm_stereo = None
    if bgm.ndim == 2:
        bgm_stereo = bgm.copy()
        bgm = np.mean(bgm, axis=1)
    if dubbed.ndim == 2:
        dubbed = np.mean(dubbed, axis=1)

    # Ensure same length
    max_len = max(len(bgm), len(dubbed))
    if len(bgm) < max_len:
        bgm = np.pad(bgm, (0, max_len - len(bgm)))
    if len(dubbed) < max_len:
        dubbed = np.pad(dubbed, (0, max_len - len(dubbed)))
    if bgm_stereo is not None:
        if len(bgm_stereo) < max_len:
            bgm_stereo = np.pad(bgm_stereo, ((0, max_len - len(bgm_stereo)), (0, 0)))

    # Create voice presence envelope from dubbed audio
    envelope = np.abs(dubbed).astype(np.float64)

    # Smooth with attack/release follower
    attack_coeff = np.exp(-1.0 / (sr * max(attack, 0.001)))
    release_coeff = np.exp(-1.0 / (sr * max(release, 0.01)))
    smoothed = np.zeros_like(envelope)
    for i in range(1, len(envelope)):
        if envelope[i] > smoothed[i - 1]:
            smoothed[i] = attack_coeff * smoothed[i - 1] + (1 - attack_coeff) * envelope[i]
        else:
            smoothed[i] = release_coeff * smoothed[i - 1] + (1 - release_coeff) * envelope[i]

    # Normalize envelope to 0-1
    peak = np.max(smoothed)
    if peak > 0:
        smoothed = smoothed / peak

    # Apply gain curve: 1.0 when no voice → duck_level when voice present
    gain = 1.0 - smoothed * (1.0 - duck_level)

    # Apply ducking to stereo or mono BGM
    if bgm_stereo is not None:
        ducked_bgm = bgm_stereo * gain[:, np.newaxis]
        # Mix: stereo BGM + mono dubbed (broadcast to both channels)
        mixed = ducked_bgm + dubbed[:, np.newaxis]
    else:
        ducked_bgm = bgm * gain
        mixed = ducked_bgm + dubbed
    # Normalize to prevent clipping
    mix_peak = np.max(np.abs(mixed))
    if mix_peak > 0.95:
        mixed = mixed * (0.95 / mix_peak)

    return mixed.astype(np.float32)


def export_video(project_id: str, keep_original_audio: bool = False,
                 original_audio_volume: float = 0.1,
                 enable_ducking: bool = True, duck_level: float = 0.15,
                 duck_attack: float = 0.05, duck_release: float = 0.3,
                 use_pro_mix: bool = True, target_lufs: float = -16.0) -> str:
    """Assemble dubbed audio and/or burn subtitles based on project toggles.

    use_pro_mix=True (default): use pedalboard + LUFS chain for broadcast-quality mix.
    Falls back to legacy envelope-follower ducking if pro_mix fails.
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    project["status"] = "exporting"
    _save_meta(project)

    pdir = _project_dir(project_id)
    video_path = pdir / "original.mp4"
    export_path = pdir / "export.mp4"
    do_dubbing = project.get("enable_dubbing", True)
    do_subtitle = project.get("enable_subtitle", False)
    aspect_ratio = project.get("aspect_ratio", "original")
    trim_s = project.get("trim_start", 0)
    trim_e = project.get("trim_end", project["video_duration"])

    try:
        # ── Step 1: Prepare dubbed audio if enabled ──
        dubbed_audio_path = None
        if do_dubbing:
            sr = gpu.sampling_rate
            video_duration = project["video_duration"]
            total_samples = int(video_duration * sr)
            full_audio = np.zeros(total_samples, dtype=np.float32)

            # Prefer the continuous dubbed_track.wav produced by batch mode (Edge TTS)
            dubbed_track_path = pdir / "dubbed_track.wav"
            if dubbed_track_path.exists():
                track_audio, track_sr = sf.read(str(dubbed_track_path), dtype="float32")
                if track_audio.ndim > 1:
                    track_audio = track_audio.mean(axis=1)
                # Resample if sr differs
                if track_sr != sr:
                    from scipy.signal import resample
                    track_audio = resample(
                        track_audio, int(len(track_audio) * sr / track_sr)
                    ).astype(np.float32)
                # Fit to target length
                copy_len = min(len(track_audio), total_samples)
                full_audio[:copy_len] = track_audio[:copy_len]
                logger.info("Export using dubbed_track.wav (%.1fs)", copy_len / sr)
            else:
                # Fallback: build from individual segment files (per-segment TTS mode)
                for seg in project["segments"]:
                    seg_audio_path = _segments_dir(project_id) / f"{seg['id']}.wav"
                    if not seg_audio_path.exists():
                        continue
                    seg_audio, _ = sf.read(str(seg_audio_path), dtype="float32")
                    start_sample = int(seg["start"] * sr)
                    end_sample = start_sample + len(seg_audio)
                    end_sample = min(end_sample, total_samples)
                    seg_len = end_sample - start_sample
                    if seg_len > 0:
                        full_audio[start_sample:end_sample] += seg_audio[:seg_len]
                logger.info("Export built full_audio from %d individual segment files",
                            len(project["segments"]))

            if keep_original_audio:
                # Use accompaniment (no vocals) if available, otherwise full original
                accomp_path = pdir / "accompaniment.wav"
                orig_audio_path = pdir / "original_audio.wav"
                bg_path = accomp_path if accomp_path.exists() else orig_audio_path
                if bg_path.exists():
                    bg_audio, bg_sr = sf.read(str(bg_path), dtype="float32")
                    if len(bg_audio) != total_samples:
                        from scipy.signal import resample
                        bg_audio = resample(bg_audio, total_samples).astype(np.float32)

                    if enable_ducking and accomp_path.exists():
                        # Professional mix chain: voice EQ + sidechain compressor
                        # + LUFS normalize. Falls back to legacy envelope follower
                        # if pedalboard unavailable or errors.
                        used_pro = False
                        if use_pro_mix:
                            try:
                                from app.services.audio_mix_svc import pro_mix
                                logger.info("Applying PRO audio mix (LUFS target=%.1f)", target_lufs)
                                # bg_audio may be stereo; reduce to mono for pro_mix
                                bg_mono = bg_audio.mean(axis=1) if bg_audio.ndim > 1 else bg_audio
                                full_audio = pro_mix(
                                    voice=full_audio,
                                    bgm=bg_mono,
                                    sr=sr,
                                    target_lufs=target_lufs,
                                )
                                used_pro = True
                            except Exception as e:
                                logger.warning("Pro mix failed, falling back to envelope ducking: %s", e)

                        if not used_pro:
                            logger.info("Applying legacy audio ducking (level=%.2f, attack=%.2f, release=%.2f)",
                                        duck_level, duck_attack, duck_release)
                            full_audio = _apply_ducking(
                                bg_audio, full_audio, sr,
                                duck_level=duck_level,
                                attack=duck_attack,
                                release=duck_release,
                            )
                    else:
                        # Simple mix (fallback)
                        mix_len = min(len(full_audio), len(bg_audio))
                        vol = original_audio_volume if not accomp_path.exists() else min(original_audio_volume * 3, 1.0)
                        full_audio[:mix_len] += bg_audio[:mix_len] * vol

            dubbed_audio_path = pdir / "dubbed_audio.wav"
            sf.write(str(dubbed_audio_path), full_audio, sr)

        # ── Step 2: Generate ASS subtitle if enabled ──
        ass_path = None
        if do_subtitle:
            generate_ass(project_id, use_translated=True)
            ass_path = pdir / "subtitles.ass"

        # ── Step 3: Build ffmpeg command with trim + crop ──
        has_trim = trim_s > 0 or trim_e < project["video_duration"]
        input_kwargs = {}
        if has_trim:
            input_kwargs["ss"] = trim_s
            input_kwargs["to"] = trim_e
        video_in = ffmpeg.input(str(video_path), **input_kwargs)

        # Build crop filter for aspect ratio
        crop_ratios = {"16:9": (16, 9), "9:16": (9, 16), "4:5": (4, 5), "1:1": (1, 1)}
        needs_crop = aspect_ratio in crop_ratios
        needs_encode = needs_crop or do_subtitle  # crop/subtitle requires re-encode

        def apply_video_filters(stream):
            """Apply crop + subtitle filters to video stream."""
            if needs_crop:
                tw, th = crop_ratios[aspect_ratio]
                # Crop to target aspect ratio centered
                stream = stream.filter(
                    "crop",
                    f"min(iw\\,ih*{tw}/{th})", f"min(ih\\,iw*{th}/{tw})",
                    f"(iw-min(iw\\,ih*{tw}/{th}))/2", f"(ih-min(ih\\,iw*{th}/{tw}))/2",
                )
            if do_subtitle and ass_path:
                stream = stream.filter("ass", str(ass_path))
            return stream

        # Audio input
        if do_dubbing and dubbed_audio_path:
            # Trim the dubbed audio too
            audio_kwargs = {}
            if has_trim:
                audio_kwargs["ss"] = trim_s
                audio_kwargs["to"] = trim_e
            audio_in = ffmpeg.input(str(dubbed_audio_path), **audio_kwargs)
            audio_stream = audio_in.audio
        else:
            audio_stream = video_in.audio

        if do_dubbing or do_subtitle or needs_crop:
            video_stream = apply_video_filters(video_in.video)
            vcodec = "libx264" if needs_encode else "copy"
            (
                ffmpeg
                .output(video_stream, audio_stream, str(export_path),
                        vcodec=vcodec, acodec="aac", strict="experimental")
                .overwrite_output()
                .run(quiet=True)
            )
        elif has_trim:
            # Trim only, no other processing
            (
                ffmpeg
                .output(video_in.video, video_in.audio, str(export_path),
                        vcodec="copy", acodec="copy")
                .overwrite_output()
                .run(quiet=True)
            )
        else:
            raise ValueError("No dubbing, subtitle, crop, or trim enabled")

    except ffmpeg.Error as e:
        project["status"] = "error"
        _save_meta(project)
        raise ValueError(f"Export failed: {e}")

    project["status"] = "done"
    _save_meta(project)
    logger.info("Exported video: %s (dubbing=%s, subtitle=%s)", export_path, do_dubbing, do_subtitle)
    return str(export_path)


# ── Subtitle Generation ────────────────────────────

def _hex_to_ass_color(hex_color: str, opacity: float = 1.0) -> str:
    """Convert #RRGGBB + opacity to ASS color &HAABBGGRR."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    a = int((1 - opacity) * 255)
    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}"


def generate_srt(project_id: str, use_translated: bool = True) -> str:
    """Generate SRT subtitle content."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    lines = []
    for i, seg in enumerate(project["segments"]):
        text = seg["translated_text"] if use_translated and seg["translated_text"].strip() else seg["original_text"]
        if not text.strip():
            continue
        start = _fmt_time(seg["start"]).replace(".", ",")
        end = _fmt_time(seg["end"]).replace(".", ",")
        lines.append(f"{i + 1}")
        lines.append(f"{start} --> {end}")
        lines.append(text.strip())
        lines.append("")

    content = "\n".join(lines)
    srt_path = _project_dir(project_id) / "subtitles.srt"
    srt_path.write_text(content, encoding="utf-8")
    return content


def generate_ass(project_id: str, use_translated: bool = True) -> str:
    """Generate ASS subtitle with styling."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    style = project.get("subtitle_style", {})
    font = style.get("font_family", "Arial")
    size = style.get("font_size", 24)
    bold = -1 if style.get("font_bold", False) else 0
    italic = -1 if style.get("font_italic", False) else 0
    primary_color = _hex_to_ass_color(style.get("font_color", "#FFFFFF"))
    outline_color = _hex_to_ass_color(style.get("outline_color", "#000000"))
    bg_opacity = style.get("bg_opacity", 0.6)
    back_color = _hex_to_ass_color(style.get("bg_color", "#000000"), bg_opacity)
    outline_w = style.get("outline_width", 2)
    shadow = style.get("shadow_offset", 1)
    margin_v = style.get("margin_v", 30)

    # BorderStyle=3 (opaque box) khi user muốn nền mờ, khớp với CSS preview.
    # BorderStyle=1 (outline+shadow) khi không có nền.
    border_style = 3 if bg_opacity > 0.01 else 1

    # Khi có nền (BorderStyle=3), tham số Outline không còn là độ rộng stroke
    # mà là padding của hộp nền quanh chữ. Preview CSS dùng padding ~0.2em
    # trên/dưới → quy đổi sang px theo font size để ASS render giống hệt.
    if border_style == 3:
        outline_w = max(2, round(size * 0.22))

    # Alignment: bottom=2, top=8, center=5
    alignment = {"bottom": 2, "top": 8, "center": 5}.get(style.get("position", "bottom"), 2)

    # PlayRes phải khớp độ phân giải video thật để Fontsize/MarginV giống preview.
    video_w, video_h = 1920, 1080
    try:
        probe = ffmpeg.probe(str(_project_dir(project_id) / "original.mp4"))
        for s in probe.get("streams", []):
            if s.get("codec_type") == "video":
                video_w = int(s.get("width") or 1920)
                video_h = int(s.get("height") or 1080)
                break
    except Exception as e:
        logger.warning("ffprobe for ASS PlayRes failed: %s", e)

    header = f"""[Script Info]
Title: VoxStudio Subtitles
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},{italic},0,0,100,100,0,0,{border_style},{outline_w},{shadow},{alignment},20,20,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    # Custom overrides — drag position, rotation từ preview
    cx = style.get("custom_x")
    cy = style.get("custom_y")
    rot_val = float(style.get("rotation", 0.0) or 0.0)
    max_width_pct = style.get("max_width_pct")

    overrides = ""
    if cx is not None and cy is not None:
        px = round(cx / 100 * video_w, 1)
        py = round(cy / 100 * video_h, 1)
        overrides += f"\\pos({px},{py})"
    if abs(rot_val) > 0.1:
        overrides += f"\\frz{round(-rot_val, 1)}"  # ASS xoay ngược chiều CSS
    override_tag = ("{" + overrides + "}") if overrides else ""

    # MarginL/R per-dialogue để wrap text theo max_width_pct
    if isinstance(max_width_pct, (int, float)) and 10 <= max_width_pct <= 100:
        margin_side = int(round(video_w * (1 - max_width_pct / 100) / 2))
    else:
        margin_side = 0  # 0 = dùng Style default (20)

    for seg in project["segments"]:
        text = seg["translated_text"] if use_translated and seg["translated_text"].strip() else seg["original_text"]
        if not text.strip():
            continue
        start = _fmt_time(seg["start"])
        end = _fmt_time(seg["end"])
        start_ass = start[1:]
        end_ass = end[1:]
        clean_text = text.strip().replace("\n", "\\N")
        events.append(
            f"Dialogue: 0,{start_ass},{end_ass},Default,,{margin_side},{margin_side},0,,{override_tag}{clean_text}"
        )

    content = header + "\n".join(events) + "\n"
    ass_path = _project_dir(project_id) / "subtitles.ass"
    ass_path.write_text(content, encoding="utf-8")
    return content


def update_subtitle_style(project_id: str, style: dict) -> dict:
    """Update subtitle styling."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")
    project["subtitle_style"] = {**project.get("subtitle_style", {}), **style}
    _save_meta(project)
    return project


def update_project_settings(project_id: str, settings: dict) -> dict:
    """Update project toggles/settings."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")
    allowed = {"enable_dubbing", "enable_subtitle", "target_language", "voice_id", "source_language_input", "tts_engine", "edge_voice", "aspect_ratio", "trim_start", "trim_end"}
    nullable = {"edge_voice", "voice_id"}
    for k, v in settings.items():
        if k in allowed and (v is not None or k in nullable):
            project[k] = v
    # Allow restoring segments (for undo/redo)
    if "segments" in settings and isinstance(settings["segments"], list):
        project["segments"] = settings["segments"]
    _save_meta(project)
    return project


def get_subtitle_path(project_id: str, fmt: str = "srt") -> Path | None:
    path = _project_dir(project_id) / f"subtitles.{fmt}"
    return path if path.exists() else None


def get_dubbed_track_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "dubbed_track.wav"
    return path if path.exists() else None


def get_export_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "export.mp4"
    return path if path.exists() else None


def get_video_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "original.mp4"
    return path if path.exists() else None


def get_thumbnail_path(project_id: str) -> Path | None:
    path = _project_dir(project_id) / "thumbnail.jpg"
    return path if path.exists() else None


# ── Auto-Dub Pipeline ─────────────────────────────

def _chunk_sentences_timed(text: str):
    """Chia text dài thành các câu nhỏ, mỗi câu <= ~45 ký tự.
    Trả về list[str]. Không có dấu chấm thì split theo mệnh đề/từ."""
    import re
    CHUNK = 45
    WORDS = 7
    sents = [s.strip() for s in re.split(r'(?<=[.!?。！？…])\s+|\n+', text) if s.strip()]
    out = []
    for s in sents:
        if len(s) <= CHUNK:
            out.append(s); continue
        clauses = [c.strip() for c in re.split(r'(?<=[,;:—–])\s+', s) if c.strip()]
        for c in clauses:
            if len(c) <= CHUNK:
                out.append(c); continue
            if re.search(r'\s', c):
                words = c.split()
                for i in range(0, len(words), WORDS):
                    out.append(' '.join(words[i:i+WORDS]))
            else:
                for i in range(0, len(c), 20):
                    out.append(c[i:i+20])
    return out


def auto_chunk_project_segments(project_id: str) -> dict:
    """Tách mỗi segment thành nhiều sub-segment theo CÂU, time chia tỷ lệ
    độ dài ký tự. Gọi sau translate_project. Mỗi câu nhỏ = 1 segment backend
    riêng → export sẽ burn từng câu đúng khoảng thời gian của riêng nó."""
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")
    new_segments = []
    for seg in project.get("segments", []):
        text = (seg.get("translated_text") or "").strip()
        chunks = _chunk_sentences_timed(text) if text else []
        if len(chunks) <= 1:
            new_segments.append(seg)
            continue
        total_chars = sum(len(c) for c in chunks)
        dur = max(0.1, seg["end"] - seg["start"])
        elapsed = 0
        for i, ch in enumerate(chunks):
            frac_start = elapsed / total_chars
            elapsed += len(ch)
            frac_end = elapsed / total_chars
            sub_start = round(seg["start"] + frac_start * dur, 2)
            sub_end = round(seg["start"] + frac_end * dur, 2)
            new_segments.append({
                **seg,
                "id": uuid.uuid4().hex[:8],
                "start": sub_start,
                "end": sub_end,
                "translated_text": ch,
                "speech_text": ch,
                # Reset TTS status vì text thay đổi
                "status": "pending",
            })
    for i, s in enumerate(new_segments):
        s["index"] = i
    project["segments"] = new_segments
    _save_meta(project)
    logger.info("Auto-chunked segments → %d sub-segments", len(new_segments))
    return project


def _run_step_with_progress(func, args, kwargs, start_pct, end_pct, label,
                             estimated_sec=30):
    """Chạy `func(*args, **kwargs)` trong 1 thread, vừa chạy vừa yield tick
    tiến trình (theo thời gian thực nội suy giữa start_pct và end_pct).

    Trả về generator. Item cuối có `_result` chứa kết quả func, hoặc
    `_error` chứa exception (caller tự raise).
    """
    import threading, time
    box = {}
    def run():
        try:
            box["result"] = func(*args, **kwargs)
        except Exception as e:
            box["error"] = e
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    t0 = time.time()
    while thread.is_alive():
        elapsed = time.time() - t0
        # Nội suy CHẬM DẦN (ease-out) để khi estimate hết mà vẫn chưa xong,
        # thanh không bị cắm ở 95% mà tiếp tục bò rất chậm về gần cuối.
        if estimated_sec > 0 and elapsed < estimated_sec:
            frac = elapsed / estimated_sec
        else:
            # Vượt estimate: creep chậm từ 0.95 → 0.99
            overshoot = elapsed - estimated_sec
            frac = 0.95 + 0.04 * (1 - 1 / (1 + overshoot / 10))
        frac = min(0.99, frac)
        cur = start_pct + (end_pct - start_pct) * frac
        yield {"step": "progress", "label": label, "progress": round(cur, 1)}
        time.sleep(0.25)  # tick 4 lần/giây cho thanh bò mượt
    thread.join()
    if "error" in box:
        yield {"step": "error", "label": str(box["error"]), "progress": -1}
        return
    yield {"step": "progress", "label": label, "progress": end_pct,
           "_result": box.get("result")}


# ── Cancellation registry ─────────────────────────────────────────────
# Client bấm huỷ → gọi request_cancel(project_id) → auto_dub kiểm tra
# giữa các bước + trong vòng lặp TTS và thoát sớm.
_cancel_flags: dict[str, threading.Event] = {}
_cancel_lock = threading.Lock()


def request_cancel(project_id: str) -> bool:
    with _cancel_lock:
        ev = _cancel_flags.get(project_id)
        if ev is None:
            ev = threading.Event()
            _cancel_flags[project_id] = ev
        ev.set()
    return True


def is_canceled(project_id: str) -> bool:
    with _cancel_lock:
        ev = _cancel_flags.get(project_id)
    return bool(ev and ev.is_set())


def _reset_cancel(project_id: str):
    with _cancel_lock:
        _cancel_flags.pop(project_id, None)


class _Canceled(Exception):
    pass


def auto_dub(project_id: str, engine: str = "google"):
    """Full pipeline: Demucs → Faster-Whisper → Translate → TTS → Export.

    Respects project toggles:
      - enable_dubbing=False → skip TTS step entirely
      - enable_subtitle=False → don't burn subtitle in export
    Yields progress updates as dicts for SSE streaming.
    Mỗi step chạy trong thread riêng, tick tiến trình mỗi 0.5s để UI thấy
    thanh progress bò đều, không phải step-jump.
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    do_dubbing = project.get("enable_dubbing", True)
    do_subtitle = project.get("enable_subtitle", False)

    if not do_dubbing and not do_subtitle:
        yield {"step": "error", "label": "Bật Lồng tiếng hoặc Phụ đề trước khi chạy.", "progress": -1}
        return

    # Reset cờ huỷ cho lần chạy mới
    _reset_cancel(project_id)

    def _check_cancel():
        if is_canceled(project_id):
            raise _Canceled()

    steps = [
        ("transcribing", "Đang nhận diện giọng nói..."),
        ("translating", "Đang dịch thuật..."),
        ("generating_tts", "Đang lồng tiếng..."),
        ("exporting", "Đang xuất video..."),
    ]

    # Tính range động: phân bổ % cho các bước sẽ chạy, tổng 0→100 mượt.
    # Trọng số (tương đối theo thời gian thực tế): transcribe 30, translate 15,
    # chunk 3, tts 40 (chỉ khi do_dubbing), export 12.
    weights = {
        "transcribe": 30,
        "translate": 15,
        "chunk": 3,
        "tts": 40 if do_dubbing else 0,
        "export": 12,
    }
    total_w = sum(weights.values())
    cursor = 0.0
    def _range(key):
        nonlocal cursor
        start = cursor
        cursor += (weights[key] / total_w) * 100
        return (round(start, 1), round(cursor, 1))
    r_trans  = _range("transcribe")
    r_transl = _range("translate")
    r_chunk  = _range("chunk")
    r_tts    = _range("tts") if weights["tts"] > 0 else None
    r_export = _range("export")

    try:
        _check_cancel()
        # Step 1: Transcribe
        for tick in _run_step_with_progress(
            transcribe_project, [project_id], {},
            start_pct=r_trans[0], end_pct=r_trans[1],
            label=steps[0][1], estimated_sec=45,
        ):
            _check_cancel()
            if tick.get("step") == "error":
                yield tick
                return
            if "_result" not in tick:
                yield {"step": "transcribing", **{k: v for k, v in tick.items() if k != "step"}}

        _check_cancel()
        # Step 2: Translate
        for tick in _run_step_with_progress(
            translate_project, [project_id], {"engine": "google"},
            start_pct=r_transl[0], end_pct=r_transl[1],
            label="Đang dịch thuật...", estimated_sec=20,
        ):
            if tick.get("step") == "error":
                yield tick
                return
            if "_result" not in tick:
                yield {"step": "translating", **{k: v for k, v in tick.items() if k != "step"}}
        # Qwen rewrite: only on CUDA (7B model too heavy for MPS/CPU)
        if IS_CUDA:
            yield {"step": "translating", "label": "Đang tinh chỉnh lời thoại...", "progress": 42}
            try:
                project = _load_meta(project_id)
                translated = [seg.get("translated_text", "") for seg in project["segments"]]
                durations = [seg["end"] - seg["start"] for seg in project["segments"]]
                speaker_ids = [seg.get("speaker") for seg in project["segments"]]
                speaker_genders = project.get("speaker_genders", {})
                target_lang = project["target_language"]
                polished = llm_translate_svc.polish_for_speech(
                    translated, target_lang,
                    durations=durations,
                    speaker_ids=speaker_ids,
                    speaker_genders=speaker_genders,
                )
                for seg, result in zip(project["segments"], polished):
                    if result.get("speech_text"):
                        seg["speech_text"] = result["speech_text"]
                        seg["emotion"] = result.get("emotion", "neutral")
                _save_meta(project)
                logger.info("Qwen rewrote %d segments with duration + speaker context",
                            len(polished))
            except Exception as e:
                logger.warning("Qwen rewrite failed, using Google Translate only: %s", e)
            finally:
                # Free ~5-6GB VRAM — Qwen not needed for TTS/export phases
                yield {"step": "translating", "label": "Đang dọn bộ nhớ...",
                       "progress": r_transl[1]}
                gpu.unload_llm()
        else:
            logger.info("Skipping Qwen rewrite (no CUDA). Using Google Translate only.")
        yield {"step": "translating", "label": "Dịch thuật hoàn tất!", "progress": r_transl[1]}

        # Step 2.5: Auto-chunk
        yield {"step": "chunking", "label": "Chia nhỏ phụ đề theo từng câu...",
               "progress": r_chunk[0]}
        try:
            auto_chunk_project_segments(project_id)
        except Exception as e:
            logger.warning("auto_chunk_project_segments failed: %s", e)
        yield {"step": "chunking", "label": "Chia nhỏ phụ đề theo từng câu...",
               "progress": r_chunk[1]}

        # Step 3: Generate TTS — stream + tick giữa các segment
        if do_dubbing and r_tts:
            import threading, time
            project = _load_meta(project_id)
            total_segs = max(1, len(project.get("segments", [])))
            yield {"step": "generating_tts", "label": steps[2][1], "progress": r_tts[0],
                   "detail": f"0/{total_segs}"}

            counter = {"done": 0, "error": None, "finished": False}

            def tts_runner():
                try:
                    for _ in generate_all(project_id):
                        counter["done"] += 1
                except Exception as e:
                    counter["error"] = e
                finally:
                    counter["finished"] = True

            thread = threading.Thread(target=tts_runner, daemon=True)
            thread.start()
            t_last = time.time()
            last_done = 0
            seg_est = 8.0  # dự đoán 8s/segment, cập nhật theo thực tế
            while not counter["finished"]:
                if is_canceled(project_id):
                    raise _Canceled()
                now = time.time()
                done = counter["done"]
                # Cập nhật seg_est theo segment vừa xong
                if done > last_done:
                    seg_est = max(2.0, (now - t_last) / (done - last_done))
                    t_last = now
                    last_done = done
                # Nội suy trong phạm vi segment kế tiếp
                frac_seg = min(1.0, (now - t_last) / max(1.0, seg_est))
                virtual = done + frac_seg * 0.95
                pct = r_tts[0] + min(1.0, virtual / total_segs) * (r_tts[1] - r_tts[0])
                yield {"step": "generating_tts", "label": steps[2][1],
                       "progress": round(pct, 1),
                       "detail": f"{done}/{total_segs}"}
                time.sleep(0.25)
            thread.join()
            if counter["error"]:
                yield {"step": "error", "label": str(counter["error"]), "progress": -1}
                return
            yield {"step": "generating_tts", "label": steps[2][1],
                   "progress": r_tts[1], "detail": f"{total_segs}/{total_segs}"}
        else:
            # Không có bước TTS → không emit gì (range đã = 0)
            logger.info("Skip TTS step (enable_dubbing=false)")

        _check_cancel()
        # Step 4: Export
        for tick in _run_step_with_progress(
            export_video, [project_id], {
                "keep_original_audio": not do_dubbing,
                "enable_ducking": do_dubbing,
            },
            start_pct=r_export[0], end_pct=r_export[1],
            label=steps[3][1], estimated_sec=15,
        ):
            _check_cancel()
            if tick.get("step") == "error":
                yield tick
                return
            if "_result" not in tick:
                yield {"step": "exporting", **{k: v for k, v in tick.items() if k != "step"}}

        # Step 5: Free TTS VRAM (ready for next project or voice test)
        gpu._log_vram("end of pipeline (before TTS unload)")
        gpu.unload_tts()
        gpu._log_vram("end of pipeline (after TTS unload)")

        yield {"step": "done", "label": "Hoàn tất!", "progress": 100}

    except _Canceled:
        logger.info("Auto-dub canceled by user: %s", project_id)
        yield {"step": "canceled", "label": "Đã huỷ", "progress": -1}
    except Exception as e:
        logger.error("Auto-dub failed at pipeline: %s", e)
        yield {"step": "error", "label": f"Lỗi: {e}", "progress": -1}
    finally:
        _reset_cancel(project_id)
