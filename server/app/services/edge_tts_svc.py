"""Edge TTS service — free cloud TTS via Microsoft Edge, no GPU needed."""

import logging
import os
import tempfile

import edge_tts

from app.services import text_markup_svc

logger = logging.getLogger(__name__)

# Default voices per language
DEFAULT_VOICES = {
    "vietnamese": "vi-VN-NamMinhNeural",
    "english": "en-US-BrianNeural",
    "chinese": "zh-CN-YunxiNeural",
    "japanese": "ja-JP-KeitaNeural",
    "korean": "ko-KR-InJoonNeural",
    "french": "fr-FR-HenriNeural",
    "spanish": "es-ES-AlvaroNeural",
    "german": "de-DE-ConradNeural",
    "portuguese": "pt-BR-AntonioNeural",
    "russian": "ru-RU-DmitryNeural",
    "thai": "th-TH-PremwadeeNeural",
    "hindi": "hi-IN-MadhurNeural",
}


async def generate(text: str, out_path: str, language: str = "vietnamese",
                   voice: str = None, speed: float = 1.0):
    """Generate TTS audio file using Edge TTS.

    Hỗ trợ pause markers [pause:Nms] / [p:Ns] — split text → generate từng
    chunk → concat MP3 với silence MP3 chèn giữa.
    """
    if not voice:
        voice = DEFAULT_VOICES.get(language, "en-US-BrianNeural")

    rate_pct = round((speed - 1.0) * 100)
    rate = f"{rate_pct:+d}%"

    chunks = text_markup_svc.parse_markers(text)
    has_pause = len(chunks) > 1 or (chunks and chunks[0][1] > 0)

    if not has_pause:
        # Flow đơn giản — không có marker
        logger.info("Edge TTS: voice=%s rate=%s text=%r", voice, rate, text[:60])
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        await communicate.save(out_path)
        logger.info("Edge TTS saved: %s", out_path)
        return

    # Multi-chunk với pause: generate từng phần ra file tạm rồi concat MP3
    # bằng ffmpeg. Edge TTS output mp3 → ffmpeg concat dễ.
    logger.info("Edge TTS multi-chunk: voice=%s rate=%s chunks=%d", voice, rate, len(chunks))
    import ffmpeg
    tmp_files = []
    try:
        for i, (chunk_text, pause_ms) in enumerate(chunks):
            if chunk_text:
                tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
                tmp.close()
                tmp_files.append(tmp.name)
                communicate = edge_tts.Communicate(chunk_text, voice, rate=rate)
                await communicate.save(tmp.name)
            if pause_ms > 0:
                # Generate silence MP3 (24kHz mono ~ Edge default sample rate)
                tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
                tmp.close()
                tmp_files.append(tmp.name)
                duration_s = pause_ms / 1000.0
                (
                    ffmpeg.input(f"anullsrc=channel_layout=mono:sample_rate=24000",
                                 f="lavfi", t=duration_s)
                    .output(tmp.name, acodec="libmp3lame", **{"q:a": 4})
                    .overwrite_output()
                    .run(quiet=True)
                )
        # Concat all MP3 files
        if not tmp_files:
            raise ValueError("Không có nội dung để generate")
        concat_list = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8",
        )
        for f in tmp_files:
            concat_list.write(f"file '{f}'\n")
        concat_list.close()
        try:
            (
                ffmpeg.input(concat_list.name, f="concat", safe=0)
                .output(out_path, acodec="copy")
                .overwrite_output()
                .run(quiet=True)
            )
        finally:
            os.unlink(concat_list.name)
        logger.info("Edge TTS multi-chunk saved: %s", out_path)
    finally:
        for f in tmp_files:
            try: os.unlink(f)
            except Exception: pass


async def list_voices():
    """List all available Edge TTS voices."""
    return await edge_tts.list_voices()
