"""Phase 12 — Voice mapping (speaker_id → voice_id).

TUYỆT ĐỐI không dùng gender. Thay vào đó:

  1. User-explicit mapping (per-project): persist trong project meta
     {speaker_id: voice_id} — UI cho phép user gán/đổi.

  2. Auto-default: nếu user chưa map, dùng voice_slots theo thứ tự xuất hiện
     của speakers (SPEAKER_00 → slot 0, SPEAKER_01 → slot 1, ...).

  3. Fallback nếu hết slot: default voice của target language.

KHÔNG suy luận male/female để pick voice — speaker là 1 ID, voice là 1
ID, mapping là user choice (hoặc thứ tự xuất hiện).
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def build_speaker_voice_map(
    speakers: list[str],
    voice_slots: list[str],
    user_overrides: Optional[dict[str, str]] = None,
    default_voice: Optional[str] = None,
) -> dict[str, str]:
    """Map mỗi stable speaker_id → voice_id.

    Args:
      speakers: list speaker IDs theo thứ tự xuất hiện
                ["SPEAKER_00", "SPEAKER_01", ...]
      voice_slots: voices user pick từ UI (theo index)
                   ["edge_vi_namminh", "edge_vi_hoaimy", ...]
      user_overrides: per-speaker user override {speaker_id: voice_id}
                      → có priority cao nhất
      default_voice: voice fallback cuối cùng

    Returns: {speaker_id: voice_id}

    Logic:
      For each speaker (in order):
        if user_overrides có speaker_id → use override
        elif voice_slots[i] có giá trị → use slot i
        elif default_voice → use default
        else → ""  # backend tự pick default theo target_lang
    """
    overrides = user_overrides or {}
    result: dict[str, str] = {}
    for i, spk in enumerate(speakers):
        if spk in overrides and overrides[spk]:
            result[spk] = overrides[spk]
            continue
        if i < len(voice_slots) and voice_slots[i]:
            result[spk] = voice_slots[i]
            continue
        # Cycle through slots if more speakers than slots
        if voice_slots:
            non_empty = [v for v in voice_slots if v]
            if non_empty:
                result[spk] = non_empty[i % len(non_empty)]
                continue
        if default_voice:
            result[spk] = default_voice
        else:
            result[spk] = ""  # let downstream pick default
    logger.info("Voice mapping: %s", result)
    return result


def get_voice_for_sentence(
    speaker_id: Optional[str],
    voice_map: dict[str, str],
    default_voice: Optional[str] = None,
) -> Optional[str]:
    """Resolve voice cho sentence's speaker.

    None speaker → default. Speaker không trong map → default.
    """
    if speaker_id and speaker_id in voice_map and voice_map[speaker_id]:
        return voice_map[speaker_id]
    return default_voice
