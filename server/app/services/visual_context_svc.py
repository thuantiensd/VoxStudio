"""Visual context service — Phase 1 (Standard).

Sample 8 keyframes từ video → 1 VLM call → JSON context.
Output feed Pass-0 (audio analyze) làm ground truth → giảm đoán mò.

Public API:
  analyze_video(video_path, engine, api_key, model=None, source_lang="auto") → dict
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Sample positions theo % của video (đầu/giữa/cuối + intermediate)
DEFAULT_SAMPLE_POSITIONS = [0.05, 0.15, 0.30, 0.45, 0.55, 0.70, 0.85, 0.95]


def _ffprobe_duration(video_path: Path) -> float:
    """Get video duration seconds. Raise nếu fail."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(video_path)],
            capture_output=True, text=True, check=True, timeout=30,
        )
        return float(out.stdout.strip())
    except Exception as e:
        raise RuntimeError(f"ffprobe fail trên {video_path}: {e}") from e


def extract_keyframes(
    video_path: Path,
    output_dir: Path,
    positions: list[float] = None,
    max_width: int = 768,
) -> list[Path]:
    """Extract keyframes từ video tại các vị trí % (0.0-1.0).

    Args:
      video_path: file mp4/mkv/...
      output_dir: thư mục lưu JPG (sẽ tạo nếu chưa có)
      positions: list[float 0-1]; default 8 vị trí spread
      max_width: resize để giảm size (VLM không cần 4K)

    Returns: list[Path] tới các file JPG đã extract.
    """
    if positions is None:
        positions = DEFAULT_SAMPLE_POSITIONS

    output_dir.mkdir(parents=True, exist_ok=True)
    duration = _ffprobe_duration(video_path)
    if duration < 1.0:
        raise RuntimeError(f"Video quá ngắn ({duration:.1f}s), không extract được")

    frame_paths = []
    for i, pos in enumerate(positions):
        t = pos * duration
        out_path = output_dir / f"frame_{i+1:02d}.jpg"
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error",
                 "-ss", f"{t:.2f}", "-i", str(video_path),
                 "-vframes", "1",
                 "-vf", f"scale='min({max_width},iw)':-2",  # resize keep aspect
                 "-q:v", "5",  # quality JPG (1=best, 31=worst)
                 str(out_path)],
                check=True, timeout=30,
            )
            if out_path.exists() and out_path.stat().st_size > 0:
                frame_paths.append(out_path)
        except Exception as e:
            logger.warning("Extract frame at %.2fs fail: %s", t, e)
            continue

    if len(frame_paths) < 3:
        raise RuntimeError(f"Chỉ extract được {len(frame_paths)}/{len(positions)} frames")

    logger.info("Visual: extracted %d keyframes từ %s (duration=%.1fs)",
                 len(frame_paths), video_path.name, duration)
    return frame_paths


def analyze_video(
    video_path: Path,
    engine: str,
    api_key: str,
    model: str | None = None,
    source_lang: str = "auto",
    keep_frames: bool = False,
) -> dict:
    """Full visual context pipeline: extract → VLM → return JSON.

    Args:
      video_path: source video
      engine: gemini/openai/claude
      api_key: BYOK
      model: optional (default = rẻ nhất từ VISION_MODELS)
      source_lang: ngôn ngữ phim
      keep_frames: True → giữ frames; False → xoá sau khi xong

    Returns: dict {genre, register, scene_summary, characters[], relationships[]}
             hoặc {} nếu fail (caller fallback Pass-0 không visual).
    """
    if not video_path.exists():
        logger.warning("Visual: video không tồn tại %s", video_path)
        return {}
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        logger.warning("Visual: thiếu ffmpeg/ffprobe — skip")
        return {}

    tmpdir = Path(tempfile.mkdtemp(prefix="voxstudio_frames_"))
    try:
        frame_paths = extract_keyframes(video_path, tmpdir)
        if not frame_paths:
            return {}

        from app.services.llm import run_visual_analyze
        result = run_visual_analyze(
            engine=engine,
            frame_paths=frame_paths,
            source_lang=source_lang,
            api_key=api_key,
            model=model,
        )
        return result or {}
    except Exception as e:
        logger.warning("Visual analyze fail: %s", e)
        return {}
    finally:
        if not keep_frames:
            try:
                shutil.rmtree(tmpdir, ignore_errors=True)
            except Exception:
                pass
