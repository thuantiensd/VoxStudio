"""VoxStudio speaker analysis pipeline (production-ready).

12-phase pipeline để output JSON editable với stable speaker IDs xuyên
suốt video, không dùng gender classifier.

Public API:
    from app.services.speaker_pipeline import analyze_speakers
    result = analyze_speakers(audio_path, language="vi")
    json_data = result.to_json()
"""
from .orchestrator import analyze_speakers
from .types import (
    AssignedWord,
    DiarizationTurn,
    OverlapRegion,
    SpeakerEmbedding,
    SpeakerPipelineResult,
    SpeakerSentence,
    TranscribedSegment,
    TranscribedWord,
)
from .voice_mapping import build_speaker_voice_map, get_voice_for_sentence

__all__ = [
    "analyze_speakers",
    "build_speaker_voice_map",
    "get_voice_for_sentence",
    "DiarizationTurn",
    "OverlapRegion",
    "SpeakerEmbedding",
    "SpeakerPipelineResult",
    "SpeakerSentence",
    "AssignedWord",
    "TranscribedSegment",
    "TranscribedWord",
]
