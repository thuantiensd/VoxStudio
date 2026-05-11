"""Voice mapping: speaker_id → voice_id.

UI convention:
  voice_slots[0] = giọng NAM
  voice_slots[1] = giọng NỮ
  voice_slots[2-4] = bất kỳ

Logic ưu tiên:
  1. user_overrides[speaker_id] — explicit user choice
  2. gender match (confidence ≥ threshold) — nam→slot 0, nữ→slot 1
  3. cycle non-empty slot — đảm bảo dùng đúng voice user chọn,
     không leak default voice ngoài
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def build_voice_map(
    speakers: list[str],
    voice_slots: list[str],
    speaker_genders: Optional[dict[str, dict]] = None,
    user_overrides: Optional[dict[str, str]] = None,
    confidence_threshold: float = 0.7,
) -> dict[str, str]:
    """Map speaker_id → voice_id.

    Args:
      speakers: stable speaker IDs từ WhisperX
      voice_slots: voice user chọn ["voice_male", "voice_female", ...]
      speaker_genders: từ gender_detect.detect_gender_per_speaker
                       {speaker_id: {gender, confidence, features}}
      user_overrides: explicit {speaker_id: voice_id} từ FE review UI
      confidence_threshold: gender conf < threshold → cycle thay strict match

    Returns: {speaker_id: voice_id}
    """
    overrides = user_overrides or {}
    genders = speaker_genders or {}
    n_slots = len(voice_slots)

    result: dict[str, str] = {}
    used_slots: set[int] = set()

    # Pass 1: explicit user override
    for spk in speakers:
        if spk in overrides and overrides[spk]:
            result[spk] = overrides[spk]

    # Pass 2: gender match (chỉ khi confidence ≥ threshold)
    if genders:
        slot_genders = []
        for i in range(n_slots):
            if i == 0:
                slot_genders.append("male")
            elif i == 1:
                slot_genders.append("female")
            else:
                slot_genders.append("any")

        for spk in speakers:
            if spk in result:
                continue
            info = genders.get(spk, {})
            g = info.get("gender", "unknown")
            conf = info.get("confidence", 0.0)
            if g not in ("male", "female"):
                continue
            if conf < confidence_threshold:
                logger.info("%s gender=%s conf=%.2f < %.2f → skip strict, cycle",
                            spk, g, conf, confidence_threshold)
                continue
            for i, sg in enumerate(slot_genders):
                if i in used_slots or sg != g:
                    continue
                if i < n_slots and voice_slots[i]:
                    result[spk] = voice_slots[i]
                    used_slots.add(i)
                    break

    # Pass 3: cycle remaining slots (ưu tiên slot CHƯA DÙNG)
    for i, spk in enumerate(speakers):
        if spk in result:
            continue
        # Tìm slot bất kỳ chưa dùng + non-empty
        assigned = False
        for j in range(n_slots):
            if j in used_slots:
                continue
            if voice_slots[j]:
                result[spk] = voice_slots[j]
                used_slots.add(j)
                assigned = True
                break
        if assigned:
            continue
        # Hết slot trống → cycle qua non-empty (chấp nhận trùng)
        non_empty = [v for v in voice_slots if v]
        if non_empty:
            result[spk] = non_empty[i % len(non_empty)]
        else:
            result[spk] = ""

    logger.info("Voice map: %s (genders=%s)", result,
                {k: v.get("gender") for k, v in genders.items()})
    return result


def get_voice_for_segment(
    seg: dict, voice_map: dict[str, str], default_voice: Optional[str] = None,
) -> Optional[str]:
    """Resolve voice cho 1 segment. seg.speaker → voice_map → default."""
    spk = seg.get("speaker")
    if spk and spk in voice_map and voice_map[spk]:
        return voice_map[spk]
    return default_voice
