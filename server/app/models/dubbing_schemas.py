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
    """Export settings — 5 params duy nhất sau cleanup Phase A.

    Audio mix architecture: pro_mix luôn dùng (sidechain ducking built-in).
    KHÔNG còn legacy ducking, KHÔNG còn monolithic original_audio params.

    Project meta là source of truth cho 4 params kia (keep_accompaniment,
    accompaniment_volume, keep_original_voice, original_voice_volume) —
    set qua /settings endpoint, override ở UI.
    """
    target_lufs: float = -16.0        # YouTube=-14, streaming=-16, conservative=-18
