"""TTS business logic."""

import logging
import time

import torch

from app.config import TTS_DEFAULT_GUIDANCE, TTS_DEFAULT_STEPS
from app.core.gpu_manager import gpu
from app.core.storage import load_voice, save_audio

logger = logging.getLogger(__name__)

try:
    from omnivoice import OmniVoiceGenerationConfig
    OMNIVOICE_AVAILABLE = True
except ImportError:
    OmniVoiceGenerationConfig = None
    OMNIVOICE_AVAILABLE = False
    logger.warning("OmniVoice not installed — /api/v1/tts/generate will return error. "
                   "Install with: pip install -e /path/to/OmniVoice-master")


def generate(
    text: str,
    voice_id: str = None,
    language: str = None,
    speed: float = 1.0,
    num_step: int = None,
    guidance_scale: float = None,
    t_shift: float = None,
    layer_penalty_factor: float = None,
    position_temperature: float = None,
    class_temperature: float = None,
    denoise: bool = None,
    preprocess_prompt: bool = None,
    postprocess_output: bool = None,
    audio_chunk_duration: float = None,
    duration: float = None,
) -> dict:
    """Generate TTS audio. Returns {"audio_url", "duration", "sample_rate"}."""
    if not OMNIVOICE_AVAILABLE:
        # Generic message — không lộ tên model nội bộ ra UI.
        # Code "PREMIUM_TTS_UNAVAILABLE" để frontend phát hiện + gợi ý chuyển
        # sang Standard hoặc đổi server.
        raise RuntimeError(
            "PREMIUM_TTS_UNAVAILABLE: Giọng Premium chưa khả dụng trên server "
            "này. Hãy chuyển sang Standard (Edge) hoặc kết nối tới server có "
            "GPU để dùng Premium."
        )
    steps = num_step or TTS_DEFAULT_STEPS
    logger.info("TTS generate: text=%r voice=%s steps=%d", text[:50], voice_id, steps)

    t0 = time.time()

    # Load saved voice if provided
    voice_prompt = None
    if voice_id:
        voice_prompt = load_voice(voice_id)
        if voice_prompt is None:
            raise ValueError(f"Voice '{voice_id}' not found")

    # Build generation config with all provided params
    config_kwargs = {
        "num_step": steps,
        "guidance_scale": guidance_scale if guidance_scale is not None else TTS_DEFAULT_GUIDANCE,
    }
    if t_shift is not None:
        config_kwargs["t_shift"] = t_shift
    if layer_penalty_factor is not None:
        config_kwargs["layer_penalty_factor"] = layer_penalty_factor
    if position_temperature is not None:
        config_kwargs["position_temperature"] = position_temperature
    if class_temperature is not None:
        config_kwargs["class_temperature"] = class_temperature
    if denoise is not None:
        config_kwargs["denoise"] = denoise
    if preprocess_prompt is not None:
        config_kwargs["preprocess_prompt"] = preprocess_prompt
    if postprocess_output is not None:
        config_kwargs["postprocess_output"] = postprocess_output
    if audio_chunk_duration is not None:
        config_kwargs["audio_chunk_duration"] = audio_chunk_duration

    gen_config = OmniVoiceGenerationConfig(**config_kwargs)

    kwargs = {"generation_config": gen_config}
    if language:
        kwargs["language"] = language
    if duration:
        kwargs["duration"] = duration
    elif speed and speed != 1.0:
        kwargs["speed"] = speed

    waveform = gpu.generate_tts(text, voice_prompt=voice_prompt, **kwargs)

    # Trim leading/trailing silence — OmniVoice thường để khoảng lặng
    # ~0.3-0.5s đầu/cuối do voice prompt + padding generation. User cảm
    # giác audio "khởi động chậm" → cắt cho gọn, vẫn chừa 30ms đệm để
    # không bị clip mở miệng đầu câu.
    waveform = trim_silence(waveform, gpu.sampling_rate)  # dùng default -50dB / 80ms

    file_id, file_path = save_audio(waveform, gpu.sampling_rate)
    duration = waveform.shape[-1] / gpu.sampling_rate
    elapsed = time.time() - t0

    logger.info("TTS done in %.1fs, duration=%.1fs, file=%s", elapsed, duration, file_id)

    return {
        "audio_url": f"/api/v1/tts/audio/{file_id}",
        "duration": round(duration, 2),
        "sample_rate": gpu.sampling_rate,
    }


def trim_silence(waveform, sample_rate, threshold_db=-50, pad_ms=80):
    """Cắt khoảng lặng đầu + cuối waveform.

    waveform: torch.Tensor shape [..., T] (mono hoặc multi-ch). Trả về
    cùng shape, đã trim. Threshold: -50 dB so với peak (chỉ cắt khoảng
    cực lặng, giữ lại phụ âm yếu như s/f/th). Pad: giữ thêm pad_ms ms
    ở mỗi đầu để không bị clip mở miệng đầu câu / đuôi từ.

    Default cũ -40dB / 30ms cắt quá sát → user nghe bị "đứt đầu đuôi".
    Default mới -50dB / 80ms thoáng hơn, vẫn cắt được khoảng lặng dài.
    """
    try:
        if waveform is None or not isinstance(waveform, torch.Tensor):
            return waveform
        x = waveform
        if x.dim() > 1:
            mag = x.abs().mean(dim=tuple(range(x.dim() - 1)))
        else:
            mag = x.abs()
        if mag.numel() == 0:
            return waveform
        peak = float(mag.max().item())
        if peak <= 0:
            return waveform
        thresh = peak * (10 ** (threshold_db / 20.0))  # -40dB → peak * 0.01
        nonsilent = (mag > thresh).nonzero(as_tuple=False).flatten()
        if nonsilent.numel() == 0:
            return waveform  # toàn bộ là silent — không động vào
        pad = int(sample_rate * pad_ms / 1000)
        start = max(0, int(nonsilent[0].item()) - pad)
        end = min(mag.numel(), int(nonsilent[-1].item()) + pad + 1)
        return x[..., start:end].contiguous()
    except Exception as e:
        logger.warning("trim_silence failed, returning original: %s", e)
        return waveform
