"""Video dubbing service — orchestrates STT → edit → TTS → export."""

import asyncio
import concurrent.futures
import json
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path

import ffmpeg
import numpy as np
import soundfile as sf

from app.config import DUBBING_DIR, VOICES_DIR, TTS_DEFAULT_GUIDANCE, TTS_DEFAULT_STEPS, IS_CUDA
from app.core.gpu_manager import gpu
from app.core.storage import load_voice
from app.services import whisper_svc, translate_svc, llm_translate_svc, edge_tts_svc, vocal_separator_svc, gemini_translate_svc

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


def _merge_short_segments(segments: list[dict], min_duration: float = 1.5, max_gap: float = 1.0) -> list[dict]:
    """Merge short segments with their neighbors for better dubbing timing.

    - Segments shorter than min_duration get merged with the next/prev segment
    - Only merge if the gap between segments is < max_gap seconds
    """
    if not segments:
        return segments

    merged = [dict(segments[0])]

    for seg in segments[1:]:
        prev = merged[-1]
        prev_dur = prev["end"] - prev["start"]
        cur_dur = seg["end"] - seg["start"]
        gap = seg["start"] - prev["end"]

        # Merge if: previous too short, or current too short, AND gap is small
        if (prev_dur < min_duration or cur_dur < min_duration) and gap < max_gap:
            prev["end"] = seg["end"]
            prev["text"] = (prev["text"] + " " + seg["text"]).strip()
        else:
            merged.append(dict(seg))

    return merged


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

    # Step 2: Transcribe on vocals.wav (cleaner) or fallback to original
    vocals_path = pdir / "vocals.wav"
    audio_to_transcribe = str(vocals_path) if vocals_path.exists() else audio_path
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

    # Post-process: merge short segments (< 1.5s) with neighbors
    merged = _merge_short_segments(raw_segs, min_duration=1.5, max_gap=1.0)

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
            "volume": 1.0,
            "fade_in": 0.0,
            "fade_out": 0.0,
            "status": "pending",
        })

    project["segments"] = segments
    project["source_language"] = result.get("language")
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
            edge_voice = project.get("edge_voice")
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
            gen_config = OmniVoiceGenerationConfig(
                num_step=TTS_DEFAULT_STEPS,
                guidance_scale=3.0 if voice_prompt else TTS_DEFAULT_GUIDANCE,
            )
            kwargs = {"generation_config": gen_config, "duration": target_duration}
            if project["target_language"]:
                kwargs["language"] = project["target_language"]

            waveform = gpu.generate_tts(tts_text, voice_prompt=voice_prompt, **kwargs)
            sr = gpu.sampling_rate
            audio_np = waveform.cpu().numpy()

            # ── Auto-align: stretch/compress to match target_duration ──
            actual_dur = len(audio_np) / sr
            if target_duration > 0 and actual_dur > 0.1:
                ratio = actual_dur / target_duration
                # Only stretch when noticeably off (>5%), clamp to reasonable range
                if abs(ratio - 1.0) > 0.05:
                    ratio_clamped = max(0.7, min(1.5, ratio))
                    logger.info("OmniVoice align: actual=%.2fs target=%.2fs ratio=%.2f (clamped=%.2f)",
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

        # Start new batch if: too long, too many segments, or big gap
        if (batch_duration > MAX_BATCH_DURATION
                or len(current_batch) >= MAX_BATCH_SEGMENTS
                or gap > MIN_SEGMENT_GAP):
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

    edge_voice = project.get("edge_voice")
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
                 duck_attack: float = 0.05, duck_release: float = 0.3) -> str:
    """Assemble dubbed audio and/or burn subtitles based on project toggles."""
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
                        # Smart ducking: reduce BGM when dubbed voice plays
                        logger.info("Applying audio ducking (level=%.2f, attack=%.2f, release=%.2f)",
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
    back_color = _hex_to_ass_color(style.get("bg_color", "#000000"), style.get("bg_opacity", 0.6))
    outline_w = style.get("outline_width", 2)
    shadow = style.get("shadow_offset", 1)
    margin_v = style.get("margin_v", 30)

    # Alignment: bottom=2, top=8, center=5
    alignment = {"bottom": 2, "top": 8, "center": 5}.get(style.get("position", "bottom"), 2)

    header = f"""[Script Info]
Title: VoxStudio Subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},{italic},0,0,100,100,0,0,1,{outline_w},{shadow},{alignment},20,20,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    for seg in project["segments"]:
        text = seg["translated_text"] if use_translated and seg["translated_text"].strip() else seg["original_text"]
        if not text.strip():
            continue
        start = _fmt_time(seg["start"])
        end = _fmt_time(seg["end"])
        # ASS uses H:MM:SS.cc format
        start_ass = start[1:]  # remove leading 0 from hours → "H:MM:SS.cc"
        end_ass = end[1:]
        clean_text = text.strip().replace("\n", "\\N")
        events.append(f"Dialogue: 0,{start_ass},{end_ass},Default,,0,0,0,,{clean_text}")

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


# ── Auto-Dub Pipeline ─────────────────────────────

def auto_dub(project_id: str, engine: str = "google"):
    """Full pipeline: Demucs → Faster-Whisper → Translate → TTS → Export.

    Yields progress updates as dicts for SSE streaming.
    """
    project = _load_meta(project_id)
    if not project:
        raise ValueError("Project not found")

    steps = [
        ("transcribing", "Đang nhận diện giọng nói (Demucs + Whisper)..."),
        ("translating", "Đang dịch thuật..."),
        ("generating_tts", "Đang tạo giọng lồng tiếng..."),
        ("exporting", "Đang xuất video..."),
    ]

    try:
        # Step 1: Transcribe (includes auto Demucs separation)
        yield {"step": "transcribing", "label": steps[0][1], "progress": 5}
        transcribe_project(project_id)
        yield {"step": "transcribing", "label": steps[0][1], "progress": 30}

        # Step 2: Translate (Google) + Rewrite (Qwen)
        yield {"step": "translating", "label": "Đang dịch thuật (Google Translate)...", "progress": 35}
        translate_project(project_id, engine="google")
        # Qwen rewrite: only on CUDA (7B model too heavy for MPS/CPU)
        if IS_CUDA:
            yield {"step": "translating", "label": "Đang viết lại lời thoại (Qwen AI)...", "progress": 42}
            try:
                project = _load_meta(project_id)
                translated = [seg.get("translated_text", "") for seg in project["segments"]]
                # Pass segment durations so Qwen fits output to original timing
                durations = [seg["end"] - seg["start"] for seg in project["segments"]]
                target_lang = project["target_language"]
                polished = llm_translate_svc.polish_for_speech(translated, target_lang, durations=durations)
                for seg, result in zip(project["segments"], polished):
                    if result.get("speech_text"):
                        seg["speech_text"] = result["speech_text"]
                        seg["emotion"] = result.get("emotion", "neutral")
                _save_meta(project)
                logger.info("Qwen rewrote %d segments with duration-aware word budget", len(polished))
            except Exception as e:
                logger.warning("Qwen rewrite failed, using Google Translate only: %s", e)
            finally:
                # Free ~5-6GB VRAM — Qwen not needed for TTS/export phases
                yield {"step": "translating", "label": "Giải phóng VRAM (Qwen)...", "progress": 48}
                gpu.unload_llm()
        else:
            logger.info("Skipping Qwen rewrite (no CUDA). Using Google Translate only.")
        yield {"step": "translating", "label": "Dịch thuật hoàn tất!", "progress": 50}

        # Step 3: Generate TTS for all segments
        yield {"step": "generating_tts", "label": steps[2][1], "progress": 55}
        tts_progress = list(generate_all(project_id))
        total_segs = len(tts_progress) if tts_progress else 1
        for i, p in enumerate(tts_progress):
            pct = 55 + int((i + 1) / total_segs * 30)  # 55% → 85%
            yield {"step": "generating_tts", "label": steps[2][1], "progress": pct,
                   "detail": f"{i+1}/{total_segs}"}

        # Step 4: Export video with ducking
        yield {"step": "exporting", "label": steps[3][1], "progress": 88}
        export_video(project_id, keep_original_audio=True, enable_ducking=True)

        # Step 5: Free TTS VRAM (ready for next project or voice test)
        gpu._log_vram("end of pipeline (before TTS unload)")
        gpu.unload_tts()
        gpu._log_vram("end of pipeline (after TTS unload)")

        yield {"step": "done", "label": "Hoàn tất!", "progress": 100}

    except Exception as e:
        logger.error("Auto-dub failed at pipeline: %s", e)
        yield {"step": "error", "label": f"Lỗi: {e}", "progress": -1}
