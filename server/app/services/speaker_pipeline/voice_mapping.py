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
    gender_confidences: Optional[dict[str, float]] = None,
    confidence_threshold: float = 0.7,
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
    confs = gender_confidences or {}
    n_slots = len(voice_slots)

    result: dict[str, str] = {}
    used_slots: set[int] = set()

    # Slot gender convention: slot 0 = nam, slot 1 = nữ, slot 2+ = any.
    # Khai báo ngoài Pass 2 để Pass 3 access được (cho gender match reuse).
    slot_genders: list[str] = []
    for i in range(n_slots):
        if i == 0:
            slot_genders.append("male")
        elif i == 1:
            slot_genders.append("female")
        else:
            slot_genders.append("any")

    # Pass 1: explicit user overrides
    for spk in speakers:
        if spk in overrides and overrides[spk]:
            result[spk] = overrides[spk]

    # Pass 2: gender-aware match (slot 0=nam, slot 1=nữ) — CHỈ khi confidence
    # ≥ threshold. Confidence thấp → skip pass này, để Pass 3 cycle slot
    # (an toàn hơn guess sai).
    if genders:
        for spk in speakers:
            if spk in result:
                continue
            g = genders.get(spk, "unknown")
            if g not in ("male", "female"):
                continue
            # Confidence cao → strict match. Confidence thấp → SOFT match
            # (vẫn ưu tiên slot match gender, KHÔNG cycle về slot 0 mặc định —
            # vì cycle hay làm female speaker đọc bằng giọng nam).
            spk_conf = confs.get(spk, 1.0)
            is_low_conf = spk_conf < confidence_threshold

            matched = False
            for i, sg in enumerate(slot_genders):
                if i in used_slots or sg != g:
                    continue
                if i < n_slots and voice_slots[i]:
                    result[spk] = voice_slots[i]
                    used_slots.add(i)
                    matched = True
                    if is_low_conf:
                        logger.info(
                            "Speaker %s gender=%s conf=%.2f < %.2f LOW conf — vẫn dùng "
                            "slot gender-match %d (avoid male voice for female speaker)",
                            spk, g, spk_conf, confidence_threshold, i,
                        )
                    break
            if not matched and is_low_conf:
                logger.info(
                    "Speaker %s gender=%s conf=%.2f thấp + không có slot match → cycle",
                    spk, g, spk_conf,
                )

    # Pass 3: speaker còn sót — ƯU TIÊN GENDER MATCH ngay cả khi slot đã
    # dùng. Nguyên tắc: thà 2 char cùng gender share voice slot, còn hơn
    # đẩy char vào slot SAI gender.
    #
    # Thứ tự ưu tiên:
    #   3a. Unused slot matching gender (rare — Pass 2 đã ăn hết)
    #   3b. **Used slot matching gender (REUSE)** ← MỚI: tránh wrong gender
    #   3c. Unused slot any gender
    #   3d. Cycle qua tất cả slot (last resort)
    for i, spk in enumerate(speakers):
        if spk in result:
            continue
        g = genders.get(spk, "unknown")

        # 3a. Unused slot match gender
        assigned = False
        if g in ("male", "female"):
            for j, sg in enumerate(slot_genders):
                if j in used_slots or sg != g:
                    continue
                if j < n_slots and voice_slots[j]:
                    result[spk] = voice_slots[j]
                    used_slots.add(j)
                    assigned = True
                    break
        if assigned:
            continue

        # 3b. USED slot match gender (REUSE) — quan trọng để tránh wrong gender.
        # Vd: 3 chars [female, male, female] + 2 slots [nam, nữ] → char_02
        # female sẽ reuse slot 1 (nữ) thay vì rơi sang slot 0 (nam).
        if g in ("male", "female"):
            for j, sg in enumerate(slot_genders):
                if sg != g:
                    continue
                if j < n_slots and voice_slots[j]:
                    result[spk] = voice_slots[j]
                    assigned = True
                    logger.info(
                        "Speaker %s (gender=%s) reuse slot %d (cùng gender) "
                        "thay vì cycle wrong gender",
                        spk, g, j,
                    )
                    break
        if assigned:
            continue

        # 3c. Unused slot bất kỳ (gender không match, nhưng còn slot trống)
        for j in range(n_slots):
            if j in used_slots:
                continue
            if voice_slots[j]:
                result[spk] = voice_slots[j]
                used_slots.add(j)
                assigned = True
                logger.warning(
                    "Speaker %s gender=%s không có slot match → dùng slot %d "
                    "(wrong gender — voice slots có thể thiếu)",
                    spk, g, j,
                )
                break
        if assigned:
            continue

        # 3d. Last resort — cycle qua tất cả slot non-empty
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
