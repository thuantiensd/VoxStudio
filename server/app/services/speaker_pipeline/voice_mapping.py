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
    speaker_genders: Optional[dict[str, str]] = None,
) -> dict[str, str]:
    """Map mỗi stable speaker_id → voice_id.

    UI convention (slotGenderHint trong page.tsx):
      - Slot 0 → giọng NAM
      - Slot 1 → giọng NỮ
      - Slot 2,3,4 → bất kỳ

    Logic ưu tiên (per spec — bán-auto: user pick voice slots upfront, pipeline
    auto-route speakers theo gender):

      1. user_overrides[speaker_id] (priority cao nhất — UI tương lai)
      2. Nếu có speaker_genders + voice_slots:
         - Speaker male → slot 0 (nếu non-empty), nếu không → slot "any" còn trống
         - Speaker female → slot 1 (nếu non-empty), nếu không → slot "any"
         - Mỗi slot chỉ assign cho 1 speaker (tránh dồn cùng giọng).
      3. Fallback (no gender info or speaker exhausted slots):
         - Cycle qua slots theo thứ tự xuất hiện.
      4. default_voice nếu có.
      5. "" → backend tự pick.
    """
    overrides = user_overrides or {}
    genders = speaker_genders or {}
    n_slots = len(voice_slots)

    result: dict[str, str] = {}
    used_slots: set[int] = set()

    # Pass 1: explicit user overrides
    for spk in speakers:
        if spk in overrides and overrides[spk]:
            result[spk] = overrides[spk]

    # Pass 2: gender-aware match (slot 0=nam, slot 1=nữ)
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
            g = genders.get(spk, "unknown")
            if g not in ("male", "female"):
                continue
            # Tìm slot match gender, chưa dùng, slot value non-empty
            for i, sg in enumerate(slot_genders):
                if i in used_slots or sg != g:
                    continue
                if i < n_slots and voice_slots[i]:
                    result[spk] = voice_slots[i]
                    used_slots.add(i)
                    break

    # Pass 3: speaker còn sót → slot "any" hoặc cycle
    for i, spk in enumerate(speakers):
        if spk in result:
            continue
        # Tìm slot "any" (index ≥ 2) chưa dùng + non-empty
        assigned = False
        for j in range(2, n_slots):
            if j in used_slots:
                continue
            if voice_slots[j]:
                result[spk] = voice_slots[j]
                used_slots.add(j)
                assigned = True
                break
        if assigned:
            continue
        # Cycle qua tất cả slot non-empty (ngay cả slot đã used — chấp nhận trùng)
        non_empty = [v for v in voice_slots if v]
        if non_empty:
            result[spk] = non_empty[i % len(non_empty)]
            continue
        if default_voice:
            result[spk] = default_voice
        else:
            result[spk] = ""

    logger.info("Voice mapping (genders=%s): %s", genders, result)
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
