"""Speaker diarization + gender detection.

Uses pyannote/speaker-diarization-3.1 on vocals.wav to split audio by speaker.
Requires HF_TOKEN env var (the model is gated — user must accept license on HF).

Gender is inferred from pitch (F0) using autocorrelation.
"""

import logging
import os
import threading
from pathlib import Path
from typing import List, Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)

HF_TOKEN = os.getenv("HF_TOKEN", "")
DIARIZE_MODEL = os.getenv("DIARIZE_MODEL", "pyannote/speaker-diarization-3.1")


class DiarizationService:
    def __init__(self):
        self._lock = threading.Lock()
        self._pipeline = None
        self._loaded = False

    def _ensure_loaded(self):
        if self._loaded:
            return
        if not HF_TOKEN:
            raise RuntimeError(
                "HF_TOKEN env var required for pyannote diarization. "
                "Get a token at https://huggingface.co/settings/tokens, "
                "accept model license at https://hf.co/pyannote/speaker-diarization-3.1"
            )
        try:
            from pyannote.audio import Pipeline
        except ImportError as e:
            raise RuntimeError("pyannote.audio not installed. Run: pip install pyannote.audio") from e

        import torch
        logger.info("Loading %s ...", DIARIZE_MODEL)
        # pyannote 4.x: `use_auth_token` → `token`. Compat cả 2 version.
        try:
            self._pipeline = Pipeline.from_pretrained(DIARIZE_MODEL, token=HF_TOKEN)
        except TypeError:
            self._pipeline = Pipeline.from_pretrained(DIARIZE_MODEL, use_auth_token=HF_TOKEN)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._pipeline.to(torch.device(device))
        logger.info("Diarization pipeline ready on %s", device)
        self._loaded = True

    @staticmethod
    def _estimate_pitch(audio: np.ndarray, sr: int) -> float:
        """Rough F0 estimate via autocorrelation on a voiced segment."""
        if len(audio) < sr * 0.3:
            return 0.0
        # Use middle 2 seconds for stability
        mid = len(audio) // 2
        half = min(sr, mid)
        seg = audio[mid - half : mid + half]
        if seg.size == 0:
            return 0.0
        # Normalize
        seg = seg - seg.mean()
        if np.abs(seg).max() > 0:
            seg = seg / np.abs(seg).max()
        from scipy.signal import correlate
        ac = correlate(seg, seg, mode="full")[len(seg) - 1 :]
        ac = ac / (ac[0] + 1e-9)
        lag_min = int(sr / 400)   # 400 Hz ceiling
        lag_max = int(sr / 70)    # 70 Hz floor
        if lag_max >= len(ac):
            return 0.0
        peak_lag = np.argmax(ac[lag_min:lag_max]) + lag_min
        if peak_lag == 0:
            return 0.0
        return float(sr / peak_lag)

    @staticmethod
    def _gender_from_pitch(f0: float) -> str:
        if f0 <= 0:
            return "unknown"
        if f0 >= 165:
            return "female"
        if f0 >= 85:
            return "male"
        return "unknown"

    def diarize(self, audio_path: str, min_speakers: int = 1, max_speakers: int = 6) -> Dict:
        """Run speaker diarization on an audio file.

        Returns:
          {
            "turns": [(start, end, speaker_id)],
            "speakers": ["SPK1", "SPK2", ...],
            "speaker_genders": {"SPK1": "male", "SPK2": "female"},
            "speaker_pitches": {"SPK1": 128.5, "SPK2": 220.1},
          }

        speaker_id is normalized to SPK1/SPK2/... (1-indexed, alphabetically sorted).
        """
        with self._lock:
            self._ensure_loaded()

            logger.info("Diarizing %s (%d-%d speakers)", audio_path, min_speakers, max_speakers)
            diar = self._pipeline(
                audio_path,
                min_speakers=min_speakers,
                max_speakers=max_speakers,
            )

            # Collect raw turns sorted by start time
            raw = []
            for turn, _, label in diar.itertracks(yield_label=True):
                raw.append((turn.start, turn.end, label))

            # Normalize labels to SPK1, SPK2, ... in discovery order
            label_map = {}
            for _, _, label in raw:
                if label not in label_map:
                    label_map[label] = f"SPK{len(label_map) + 1}"

            turns = [(s, e, label_map[l]) for s, e, l in raw]
            speakers = list(label_map.values())

            # Gender detection: per speaker, stitch all their audio → pitch
            import soundfile as sf
            audio, sr = sf.read(audio_path)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            audio = audio.astype(np.float32)

            speaker_pitches = {}
            speaker_genders = {}
            for spk in speakers:
                segs = [(s, e) for s, e, l in turns if l == spk]
                if not segs:
                    continue
                # Take up to 4 seconds of this speaker for stability
                chunks = []
                total_sec = 0.0
                for s, e in segs:
                    if total_sec >= 4.0:
                        break
                    start = int(s * sr)
                    end = min(int(e * sr), len(audio))
                    chunks.append(audio[start:end])
                    total_sec += (end - start) / sr
                if not chunks:
                    continue
                combined = np.concatenate(chunks)
                f0 = self._estimate_pitch(combined, sr)
                gender = self._gender_from_pitch(f0)
                speaker_pitches[spk] = f0
                speaker_genders[spk] = gender
                logger.info("  %s: F0=%.0fHz → %s", spk, f0, gender)

            return {
                "turns": turns,
                "speakers": speakers,
                "speaker_genders": speaker_genders,
                "speaker_pitches": speaker_pitches,
            }

    @staticmethod
    def assign_speaker_to_segments(
        whisper_segments: List[Dict],
        turns: List[tuple],
    ) -> List[Dict]:
        """For each Whisper segment, find the speaker with max time overlap.

        Returns a copy with "speaker" field added.
        """
        out = []
        for seg in whisper_segments:
            seg_start = seg["start"]
            seg_end = seg["end"]
            best_speaker = None
            best_overlap = 0.0
            for t_start, t_end, spk in turns:
                overlap = max(0.0, min(seg_end, t_end) - max(seg_start, t_start))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_speaker = spk
            new_seg = dict(seg)
            new_seg["speaker"] = best_speaker
            out.append(new_seg)
        return out


# Singleton
diarize = DiarizationService()
