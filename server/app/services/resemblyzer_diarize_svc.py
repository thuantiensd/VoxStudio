"""Speaker diarization using Resemblyzer (lightweight, no token, MIT license).

Replaces pyannote.audio (gated, requires HF_TOKEN) with a fully self-contained
pipeline:

    silero-vad → speech regions → sliding window → Resemblyzer embedding
        → AgglomerativeClustering → speaker labels
        → assign to Whisper segments by max-overlap

Model size: ~17MB (vs pyannote ~1GB). Quality: 80-90% pyannote, plenty for
auto male/female voice routing in dubbing.
"""

import logging
import os
import threading
from typing import List, Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)


class ResemblyzerDiarizer:
    """Lazy-loaded Resemblyzer + clustering, thread-safe."""

    def __init__(self):
        self._lock = threading.Lock()
        self._encoder = None
        self._loaded = False

    def _ensure_loaded(self):
        if self._loaded:
            return
        try:
            from resemblyzer import VoiceEncoder
        except ImportError as e:
            raise RuntimeError("Resemblyzer not installed. Run: pip install resemblyzer") from e

        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("Loading Resemblyzer voice encoder on %s ...", device)
        self._encoder = VoiceEncoder(device)
        self._loaded = True
        logger.info("Resemblyzer ready (model ~17MB)")

    @staticmethod
    def _estimate_pitch(audio: np.ndarray, sr: int) -> float:
        """Rough F0 estimate via autocorrelation on a voiced segment."""
        if len(audio) < sr * 0.3:
            return 0.0
        mid = len(audio) // 2
        half = min(sr, mid)
        seg = audio[mid - half : mid + half]
        if seg.size == 0:
            return 0.0
        seg = seg - seg.mean()
        peak = float(np.abs(seg).max())
        if peak > 0:
            seg = seg / peak
        from scipy.signal import correlate
        ac = correlate(seg, seg, mode="full")[len(seg) - 1:]
        ac = ac / (ac[0] + 1e-9)
        lag_min = int(sr / 400)
        lag_max = int(sr / 70)
        if lag_max >= len(ac):
            return 0.0
        peak_lag = int(np.argmax(ac[lag_min:lag_max])) + lag_min
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

    def _detect_speech_regions(self, audio: np.ndarray, sr: int) -> List[tuple]:
        """Use silero-vad to find speech regions. Returns [(start_s, end_s), ...]."""
        try:
            from silero_vad import load_silero_vad, get_speech_timestamps
            import torch
        except ImportError:
            # Fallback: use full audio as 1 region
            return [(0.0, len(audio) / sr)]

        model = load_silero_vad()
        # silero expects 16kHz tensor
        if sr != 16000:
            from scipy.signal import resample
            audio_16k = resample(audio, int(len(audio) * 16000 / sr))
        else:
            audio_16k = audio
        wav_t = torch.from_numpy(audio_16k.astype(np.float32))
        ts = get_speech_timestamps(wav_t, model, sampling_rate=16000,
                                    min_speech_duration_ms=300,
                                    min_silence_duration_ms=400)
        regions = [(t["start"] / 16000, t["end"] / 16000) for t in ts]
        if not regions:
            regions = [(0.0, len(audio) / sr)]
        return regions

    def diarize(self, audio_path: str, min_speakers: int = 1, max_speakers: int = 6) -> Dict:
        """Run diarization on an audio file.

        Returns:
          {
            "turns": [(start, end, speaker_id)],
            "speakers": ["SPK1", "SPK2", ...],
            "speaker_genders": {"SPK1": "male", ...},
            "speaker_pitches": {"SPK1": 128.5, ...},
          }
        """
        with self._lock:
            self._ensure_loaded()

            import soundfile as sf
            audio, sr = sf.read(audio_path)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            audio = audio.astype(np.float32)

            # 1. Detect speech regions
            regions = self._detect_speech_regions(audio, sr)
            logger.info("VAD detected %d speech regions", len(regions))

            # 2. For each region, slide window 1.5s and extract embedding
            from resemblyzer import preprocess_wav
            window_s = 1.5
            hop_s = 0.75
            embeddings = []
            window_times = []  # (start_s, end_s) per embedding

            for region_start, region_end in regions:
                t = region_start
                while t + window_s <= region_end + 0.1:
                    end_t = min(t + window_s, region_end)
                    start_sample = int(t * sr)
                    end_sample = int(end_t * sr)
                    if end_sample - start_sample < int(sr * 0.5):
                        break
                    chunk = audio[start_sample:end_sample]
                    # Resemblyzer expects 16kHz
                    if sr != 16000:
                        from scipy.signal import resample
                        chunk = resample(chunk, int(len(chunk) * 16000 / sr)).astype(np.float32)
                    chunk = preprocess_wav(chunk, source_sr=16000)
                    if len(chunk) >= 16000 * 0.3:
                        emb = self._encoder.embed_utterance(chunk)
                        embeddings.append(emb)
                        window_times.append((t, end_t))
                    t += hop_s

            if not embeddings:
                logger.warning("No embeddings extracted — single speaker fallback")
                return {
                    "turns": [(0.0, len(audio) / sr, "SPK1")],
                    "speakers": ["SPK1"],
                    "speaker_genders": {"SPK1": "unknown"},
                    "speaker_pitches": {},
                }

            embeddings = np.array(embeddings)

            # 3. Cluster embeddings
            n_emb = len(embeddings)
            est_n_speakers = self._estimate_n_speakers(embeddings, min_speakers, max_speakers)
            logger.info("Clustering %d embeddings into %d speakers", n_emb, est_n_speakers)

            from sklearn.cluster import AgglomerativeClustering
            clusterer = AgglomerativeClustering(
                n_clusters=est_n_speakers,
                metric="cosine",
                linkage="average",
            )
            labels = clusterer.fit_predict(embeddings)

            # 4. Build turns: assign each window's speaker, then merge adjacent same-speaker
            # Map cluster id → "SPK1", "SPK2", ... in order of appearance
            label_map = {}
            for lbl in labels:
                if lbl not in label_map:
                    label_map[lbl] = f"SPK{len(label_map) + 1}"

            turns = []
            for (start, end), lbl in zip(window_times, labels):
                spk = label_map[lbl]
                if turns and turns[-1][2] == spk and start - turns[-1][1] < 0.5:
                    # Merge with previous turn
                    turns[-1] = (turns[-1][0], end, spk)
                else:
                    turns.append((start, end, spk))

            speakers = list(label_map.values())

            # 5. Gender per speaker via pitch
            speaker_pitches = {}
            speaker_genders = {}
            for spk in speakers:
                spk_chunks = []
                total = 0.0
                for s, e, l in turns:
                    if l == spk and total < 4.0:
                        start_sample = int(s * sr)
                        end_sample = min(int(e * sr), len(audio))
                        spk_chunks.append(audio[start_sample:end_sample])
                        total += (end_sample - start_sample) / sr
                if not spk_chunks:
                    continue
                combined = np.concatenate(spk_chunks)
                f0 = self._estimate_pitch(combined, sr)
                speaker_pitches[spk] = f0
                speaker_genders[spk] = self._gender_from_pitch(f0)
                logger.info("  %s: F0=%.0fHz → %s", spk, f0, speaker_genders[spk])

            return {
                "turns": turns,
                "speakers": speakers,
                "speaker_genders": speaker_genders,
                "speaker_pitches": speaker_pitches,
            }

    @staticmethod
    def _estimate_n_speakers(embeddings: np.ndarray,
                              min_n: int = 1, max_n: int = 6) -> int:
        """Estimate optimal number of speakers via silhouette score."""
        n = len(embeddings)
        if n <= max(min_n, 2):
            return min(min_n, n)

        from sklearn.cluster import AgglomerativeClustering
        from sklearn.metrics import silhouette_score

        upper = min(max_n, n - 1)
        if upper < 2:
            return 1

        best_score = -1.0
        best_n = min_n
        for k in range(max(min_n, 2), upper + 1):
            try:
                clusterer = AgglomerativeClustering(
                    n_clusters=k, metric="cosine", linkage="average"
                )
                labels = clusterer.fit_predict(embeddings)
                if len(set(labels)) < 2:
                    continue
                score = silhouette_score(embeddings, labels, metric="cosine")
                if score > best_score:
                    best_score = score
                    best_n = k
            except Exception:
                continue
        # Require minimum silhouette for multi-speaker decision
        if best_score < 0.05:
            return 1
        return best_n

    @staticmethod
    def assign_speaker_to_segments(whisper_segments: List[Dict],
                                    turns: List[tuple]) -> List[Dict]:
        """For each Whisper segment, find speaker with max time overlap."""
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
diarize = ResemblyzerDiarizer()
