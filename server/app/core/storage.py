"""File storage for voices (.pt) and audio output (.wav)."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import soundfile as sf
import torch

from app.config import AUDIO_OUTPUT_DIR, VOICES_DIR


# ── Audio output ─────────────────────────────────────
def save_audio(waveform, sample_rate: int) -> tuple[str, str]:
    """Save waveform tensor to WAV file. Returns (file_id, file_path)."""
    file_id = uuid.uuid4().hex[:12]
    filename = f"{file_id}.wav"
    path = AUDIO_OUTPUT_DIR / filename
    sf.write(str(path), waveform.cpu().numpy(), sample_rate)
    return file_id, str(path)


def get_audio_path(file_id: str) -> Optional[Path]:
    path = AUDIO_OUTPUT_DIR / f"{file_id}.wav"
    return path if path.exists() else None


# ── Voice storage ────────────────────────────────────
def _meta_path(voice_id: str) -> Path:
    return VOICES_DIR / f"{voice_id}.json"


def save_voice(voice_id: str, name: str, prompt, ref_text: str = None, tags: list = None):
    """Save voice prompt (.pt, optional) and metadata (.json)."""
    if prompt is not None:
        torch.save(prompt, VOICES_DIR / f"{voice_id}.pt")
    meta = {
        "id": voice_id,
        "name": name,
        "ref_text": ref_text,
        "tags": tags or [],
        "created_at": datetime.now().isoformat(),
        "has_prompt": prompt is not None,
    }
    _meta_path(voice_id).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def load_voice(voice_id: str):
    """Load voice prompt tensor."""
    path = VOICES_DIR / f"{voice_id}.pt"
    if not path.exists():
        return None
    return torch.load(str(path), weights_only=False)


def get_voice_meta(voice_id: str) -> Optional[dict]:
    path = _meta_path(voice_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_voices() -> List[dict]:
    """List all saved voices."""
    voices = []
    for f in sorted(VOICES_DIR.glob("*.json")):
        try:
            meta = json.loads(f.read_text(encoding="utf-8"))
            voices.append(meta)
        except Exception:
            continue
    return voices


def delete_voice(voice_id: str) -> bool:
    """Delete voice files (.pt + .json)."""
    pt = VOICES_DIR / f"{voice_id}.pt"
    meta = _meta_path(voice_id)
    deleted = False
    if pt.exists():
        pt.unlink()
        deleted = True
    if meta.exists():
        meta.unlink()
        deleted = True
    return deleted
