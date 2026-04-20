"""Dubbing project schemas."""

from typing import List, Optional

from pydantic import BaseModel


class SubtitleStyle(BaseModel):
    font_family: str = "Arial"
    font_size: int = 24
    font_color: str = "#FFFFFF"
    font_bold: bool = False
    font_italic: bool = False
    bg_color: str = "#000000"
    bg_opacity: float = 0.6
    outline_color: str = "#000000"
    outline_width: int = 2
    shadow_offset: int = 1
    position: str = "bottom"  # top | center | bottom
    margin_v: int = 30
    # Custom overrides (khi user drag/scale/rotate text trên preview)
    custom_x: Optional[float] = None         # % horizontal, 0-100
    custom_y: Optional[float] = None         # % vertical, 0-100
    max_width_pct: Optional[float] = None    # % của width video (wrap vùng text)
    rotation: float = 0.0                    # độ


class DubbingSegment(BaseModel):
    id: str
    index: int
    start: float
    end: float
    original_text: str
    translated_text: str = ""
    volume: float = 1.0
    fade_in: float = 0.0
    fade_out: float = 0.0
    status: str = "pending"  # pending | generating | done | error


class DubbingProject(BaseModel):
    id: str
    status: str  # created | transcribing | editing | generating | exporting | done | error
    source_language: Optional[str] = None
    source_language_input: str = "auto"  # user-selected: "auto" or specific language
    target_language: str
    voice_id: Optional[str] = None
    enable_dubbing: bool = True
    enable_subtitle: bool = False
    subtitle_style: SubtitleStyle = SubtitleStyle()
    segments: List[DubbingSegment] = []
    video_filename: str
    video_duration: float = 0.0
    created_at: str


class SegmentUpdate(BaseModel):
    translated_text: Optional[str] = None
    speech_text: Optional[str] = None
    emotion: Optional[str] = None
    voice_id: Optional[str] = None
    start: Optional[float] = None
    end: Optional[float] = None
    volume: Optional[float] = None
    fade_in: Optional[float] = None
    fade_out: Optional[float] = None


class SplitRequest(BaseModel):
    split_at: float  # seconds


class MergeRequest(BaseModel):
    segment_ids: List[str]


class ReorderRequest(BaseModel):
    segment_ids: List[str]


class ExportOptions(BaseModel):
    keep_original_audio: bool = False
    original_audio_volume: float = 0.1
    enable_ducking: bool = True       # Smart audio ducking — reduce BGM when voice plays
    duck_level: float = 0.15          # BGM volume when voice is present (0.0-1.0) [legacy]
    duck_attack: float = 0.05         # Ducking attack time in seconds [legacy]
    duck_release: float = 0.3         # Ducking release time in seconds [legacy]
    use_pro_mix: bool = True          # Use professional pedalboard chain (recommended)
    target_lufs: float = -16.0        # YouTube=-14, most streaming=-16, conservative=-18
