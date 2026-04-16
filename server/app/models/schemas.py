"""Request / Response schemas."""

from typing import List, Optional

from pydantic import BaseModel


# ── TTS ──────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[float] = 1.0
    num_step: Optional[int] = None
    guidance_scale: Optional[float] = None
    t_shift: Optional[float] = None
    layer_penalty_factor: Optional[float] = None
    position_temperature: Optional[float] = None
    class_temperature: Optional[float] = None
    denoise: Optional[bool] = None
    preprocess_prompt: Optional[bool] = None
    postprocess_output: Optional[bool] = None
    audio_chunk_duration: Optional[float] = None
    duration: Optional[float] = None


class TTSResponse(BaseModel):
    audio_url: str
    duration: float
    sample_rate: int


# ── Voice ────────────────────────────────────────────
class VoiceInfo(BaseModel):
    id: str
    name: str
    language: Optional[str] = None
    tags: List[str] = []
    created_at: str
    ref_text: Optional[str] = None


class VoiceCloneRequest(BaseModel):
    name: str
    ref_text: Optional[str] = None
    tags: List[str] = []


class VoiceListResponse(BaseModel):
    voices: List[VoiceInfo]
    total: int


# ── Transcribe ───────────────────────────────────────
class Segment(BaseModel):
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    text: str
    language: Optional[str] = None
    segments: List[Segment] = []


class DetectLanguageResponse(BaseModel):
    language: str
