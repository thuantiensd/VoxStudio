"""SRT-driven TTS — generate audio track aligned với timestamp SRT.

User flow: upload SRT trong TTS tab → mỗi cue dùng Edge TTS → mix vào 1
audio file duy nhất, đúng timestamp. Silence giữa các cue.

Khác biệt với dubbing pipeline:
- Không cần video, không cần demucs/whisper/translate
- Không apply studio mix (voice EQ + RMS norm) — giữ tone Edge TTS gốc
- Per-cue speed-adjust + atempo stretch để fit (start, end) window
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

from app.services import edge_tts_svc

logger = logging.getLogger(__name__)

SR = 24000
MAX_PARALLEL = 4          # Edge TTS network-bound — 4 workers đủ
MAX_EDGE_SPEED = 1.5      # Edge native re-gen ceiling
MAX_ATEMPO = 1.25         # ffmpeg fine-tune ceiling (chất lượng vẫn ổn)
SPEED_TOLERANCE = 0.05    # bỏ qua mismatch <5%


def _edge_generate_sync(text: str, out_path: str, *, language: str,
                        voice: Optional[str], speed: float = 1.0) -> None:
    """Sync wrapper cho edge_tts_svc.generate (async)."""
    asyncio.run(
        edge_tts_svc.generate(text, out_path, language=language,
                              voice=voice, speed=speed),
    )


def _mp3_to_wav(mp3: Path, wav: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(mp3), "-acodec", "pcm_s16le",
         "-ac", "1", "-ar", str(SR), str(wav)],
        check=True, capture_output=True,
    )


def _atempo_stretch(src: Path, dst: Path, factor: float) -> None:
    """Time-stretch wav qua ffmpeg atempo. atempo range 0.5-100 nhưng
    chuỗi atempo tối ưu trong [0.5, 2.0]. Cap factor ở MAX_ATEMPO để
    không méo voice."""
    factor = max(0.5, min(MAX_ATEMPO, factor))
    if abs(factor - 1.0) < 0.01:
        # No-op stretch — copy
        import shutil
        shutil.copy(src, dst)
        return
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-filter:a", f"atempo={factor}",
         "-acodec", "pcm_s16le", "-ar", str(SR), "-ac", "1", str(dst)],
        check=True, capture_output=True,
    )


def _process_cue(
    cue_idx: int, cue: dict, work_dir: Path, *,
    voice: Optional[str], language: str,
) -> dict:
    """Generate Edge TTS cho 1 cue + fit vào (start, end) window.

    Returns {idx, start, audio: np.ndarray, ok, error?}.
    """
    text = (cue.get("text") or "").strip()
    start = float(cue.get("start", 0))
    end = float(cue.get("end", start))
    duration = max(0.3, end - start)

    if not text:
        return {"idx": cue_idx, "start": start,
                "audio": np.zeros(int(duration * SR), dtype=np.float32),
                "ok": True}

    try:
        mp3 = work_dir / f"cue_{cue_idx}.mp3"
        wav = work_dir / f"cue_{cue_idx}.wav"

        # 1. Edge TTS at 1.0x
        _edge_generate_sync(text, str(mp3), language=language, voice=voice, speed=1.0)
        _mp3_to_wav(mp3, wav)
        audio, _ = sf.read(str(wav))
        actual = len(audio) / SR
        ratio = actual / duration if duration > 0 else 1.0

        # 2. Nếu quá dài → re-gen với speed cao hơn (Edge native, chất tốt hơn atempo)
        if ratio > 1.0 + SPEED_TOLERANCE:
            edge_speed = max(1.0, min(MAX_EDGE_SPEED, ratio))
            _edge_generate_sync(text, str(mp3), language=language,
                                voice=voice, speed=edge_speed)
            _mp3_to_wav(mp3, wav)
            audio, _ = sf.read(str(wav))
            actual = len(audio) / SR
            ratio = actual / duration if duration > 0 else 1.0

        # 3. Vẫn dài → atempo fine-tune
        if ratio > 1.0 + SPEED_TOLERANCE:
            stretched = work_dir / f"cue_{cue_idx}_str.wav"
            _atempo_stretch(wav, stretched, ratio)
            audio, _ = sf.read(str(stretched))
            stretched.unlink(missing_ok=True)
            actual = len(audio) / SR

        # 4. Nếu vẫn vượt → hard-trim với fade-out (clip thay vì để overflow lan cue sau)
        max_samples = int(min(actual, duration * 1.15) * SR)
        if len(audio) > max_samples:
            fade = min(int(0.05 * SR), max_samples // 4)
            audio = audio[:max_samples].copy()
            if fade > 0:
                env = np.linspace(1.0, 0.0, fade, dtype=np.float32)
                audio[-fade:] *= env

        mp3.unlink(missing_ok=True)
        wav.unlink(missing_ok=True)
        return {"idx": cue_idx, "start": start, "audio": audio, "ok": True}

    except Exception as e:
        logger.warning("Cue %d fail: %s", cue_idx, e)
        return {"idx": cue_idx, "start": start, "ok": False, "error": str(e),
                "audio": np.zeros(int(duration * SR), dtype=np.float32)}


def generate_from_cues(
    cues: list[dict], *,
    voice: Optional[str] = None,
    language: str = "vietnamese",
    out_wav: Path,
) -> dict:
    """Generate audio track từ list SRT cues.

    Args:
        cues: list[{start: float (sec), end: float, text: str}]
        out_wav: path để ghi wav output

    Returns: {duration, sample_rate, n_cues, n_errors}
    """
    if not cues:
        raise ValueError("Không có cue nào để xử lý.")

    total_dur = max(c.get("end", 0) for c in cues) + 1.0  # +1s buffer cuối
    track = np.zeros(int(total_dur * SR), dtype=np.float64)

    work_dir = Path(tempfile.mkdtemp(prefix="srt_tts_"))
    n_errors = 0
    try:
        # Parallel TTS — Edge network-bound, 4 workers concurrent giảm ~70% thời gian
        with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(cues))) as ex:
            futures = [
                ex.submit(_process_cue, i, c, work_dir,
                          voice=voice, language=language)
                for i, c in enumerate(cues)
            ]
            results = []
            for fut in as_completed(futures):
                r = fut.result()
                if not r.get("ok"):
                    n_errors += 1
                results.append(r)

        # Sequential placement — overlap detection (cue sau đè lên cue trước nếu overlap)
        results.sort(key=lambda r: r["idx"])
        for r in results:
            audio = r["audio"]
            if audio is None or len(audio) == 0:
                continue
            offset = int(r["start"] * SR)
            end_pos = offset + len(audio)
            # Resize track nếu cần (cue cuối vượt buffer)
            if end_pos > len(track):
                track = np.pad(track, (0, end_pos - len(track) + SR))
            # Mix bằng max-magnitude để overlap không dập âm
            existing = track[offset:end_pos]
            track[offset:end_pos] = np.where(
                np.abs(audio) > np.abs(existing), audio, existing,
            )

        # Normalize peak để không bị clip
        peak = float(np.max(np.abs(track)))
        if peak > 0.95:
            track *= 0.95 / peak

        sf.write(str(out_wav), track.astype(np.float32), SR)
        return {
            "duration": round(len(track) / SR, 2),
            "sample_rate": SR,
            "n_cues": len(cues),
            "n_errors": n_errors,
        }
    finally:
        # Cleanup tmp dir
        for f in work_dir.glob("*"):
            f.unlink(missing_ok=True)
        try:
            work_dir.rmdir()
        except OSError:
            pass


def parse_srt(content: str) -> list[dict]:
    """Parse SRT/VTT text → list[{start, end, text}]. Robust với WEBVTT
    header, BOM, blank lines."""
    import re
    text = content.lstrip("﻿").strip()
    # Bỏ WEBVTT header nếu có
    text = re.sub(r"^WEBVTT[^\n]*\n+", "", text)

    cues = []
    # Pattern: timestamp line "00:01:23,456 --> 00:01:25,789" với , hoặc .
    block_pattern = re.compile(
        r"(?:\d+\s*\n)?"                                # optional index
        r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*"
        r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})[^\n]*\n"
        r"((?:.+(?:\n|$))+?)"
        r"(?=\n|\Z)",
        re.MULTILINE,
    )
    for m in block_pattern.finditer(text):
        h1, m1, s1, ms1, h2, m2, s2, ms2, body = m.groups()
        start = int(h1) * 3600 + int(m1) * 60 + int(s1) + int(ms1.ljust(3, '0')) / 1000
        end = int(h2) * 3600 + int(m2) * 60 + int(s2) + int(ms2.ljust(3, '0')) / 1000
        clean = re.sub(r"<[^>]+>", "", body)        # HTML tags
        clean = re.sub(r"\{\\[^}]+\}", "", clean)   # ASS overrides
        clean = clean.strip()
        if clean and end > start:
            cues.append({"start": start, "end": end, "text": clean})
    return cues
