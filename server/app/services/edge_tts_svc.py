"""Edge TTS service — free cloud TTS via Microsoft Edge, no GPU needed."""

import logging

import edge_tts

logger = logging.getLogger(__name__)

# Default voices per language. Hỗ trợ cả ISO code (vi, en, zh...) và full
# name (vietnamese, english...) — FE đôi khi gửi 1 trong 2 dạng.
DEFAULT_VOICES = {
    "vietnamese": "vi-VN-NamMinhNeural",
    "vi":         "vi-VN-NamMinhNeural",
    "english":    "en-US-BrianNeural",
    "en":         "en-US-BrianNeural",
    "chinese":    "zh-CN-YunxiNeural",
    "zh":         "zh-CN-YunxiNeural",
    "japanese":   "ja-JP-KeitaNeural",
    "ja":         "ja-JP-KeitaNeural",
    "korean":     "ko-KR-InJoonNeural",
    "ko":         "ko-KR-InJoonNeural",
    "french":     "fr-FR-HenriNeural",
    "fr":         "fr-FR-HenriNeural",
    "spanish":    "es-ES-AlvaroNeural",
    "es":         "es-ES-AlvaroNeural",
    "german":     "de-DE-ConradNeural",
    "de":         "de-DE-ConradNeural",
    "portuguese": "pt-BR-AntonioNeural",
    "pt":         "pt-BR-AntonioNeural",
    "russian":    "ru-RU-DmitryNeural",
    "ru":         "ru-RU-DmitryNeural",
    "thai":       "th-TH-PremwadeeNeural",
    "th":         "th-TH-PremwadeeNeural",
    "hindi":      "hi-IN-MadhurNeural",
    "hi":         "hi-IN-MadhurNeural",
    "indonesian": "id-ID-ArdiNeural",
    "id":         "id-ID-ArdiNeural",
    "italian":    "it-IT-DiegoNeural",
    "it":         "it-IT-DiegoNeural",
}


async def generate(text: str, out_path: str, language: str = "vietnamese",
                   voice: str = None, speed: float = 1.0):
    """Generate TTS audio file using Edge TTS."""
    if not voice:
        lang_key = (language or "").strip().lower()
        voice = DEFAULT_VOICES.get(lang_key, "en-US-BrianNeural")
        if voice == "en-US-BrianNeural" and lang_key not in ("english", "en", ""):
            logger.warning("Edge TTS: không có mapping cho language=%r → fallback English. "
                           "Thêm vào DEFAULT_VOICES nếu cần.", language)

    rate_pct = round((speed - 1.0) * 100)
    rate = f"{rate_pct:+d}%"

    logger.info("Edge TTS: voice=%s rate=%s text=%r", voice, rate, text[:60])
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(out_path)
    logger.info("Edge TTS saved: %s", out_path)


async def list_voices():
    """List all available Edge TTS voices."""
    return await edge_tts.list_voices()
