"""Edge TTS service — free cloud TTS via Microsoft Edge, no GPU needed."""

import logging

import edge_tts

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
    """Generate TTS audio file using Edge TTS."""
    if not voice:
        voice = DEFAULT_VOICES.get(language, "en-US-BrianNeural")

    rate_pct = round((speed - 1.0) * 100)
    rate = f"{rate_pct:+d}%"

    logger.info("Edge TTS: voice=%s rate=%s text=%r", voice, rate, text[:60])
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(out_path)
    logger.info("Edge TTS saved: %s", out_path)


async def list_voices():
    """List all available Edge TTS voices."""
    return await edge_tts.list_voices()
