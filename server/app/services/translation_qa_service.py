"""Translation QA Service (Phase 10 audit refactor).

Post-translation quality checks + conservative auto-fix policy.

4 checks (per spec Phase 13):

  Check 1: Pronoun mismatch với character profile
    LOCKED + high conf character: subject-position pronoun phải match gender.
    Sử dụng position-based heuristic (Option A — không cần dep mới).

  Check 2: Cross-batch pronoun consistency
    Cùng cặp character A→B: xưng hô trong batch 1 vs batch N phải nhất quán.
    Storage: aggregate pronoun pairs across translation history → detect drift.

  Check 3: Low ownership_confidence segments không over-gendered
    Segment có ownership_confidence < OWNERSHIP_LOW (0.50) → translation
    KHÔNG nên ép anh/em/cô/chị subject-position.

  Check 4: Unknown gender không bị ép gendered
    Character với gender = "unknown" → translation không có subject-position
    gendered pronoun (anh/em/cô/chị).

Auto-fix policy:
  confidence ≥ 0.90 → rewrite pattern-based (high confidence).
  0.60 ≤ confidence < 0.90 → neutral_safe_rewrite (conservative).
  confidence < 0.60 → keep original + log warning only.

Conservative bias (per Phase 10 spec):
  Thà under-detect (miss real issues, chờ user review) hơn over-trigger
  (auto-fix sai). Auto-fix CHỈ khi confidence ≥ 0.90.

Public API:
  run_translation_qa(segments, registry, *, prev_qa_history=None)
      → QAResult
"""
from __future__ import annotations

import logging
from collections import Counter, defaultdict
from typing import Optional

from app.config import GENDER_HIGH, OWNERSHIP_LOW
from app.models.character_schemas import (
    CharacterProfile,
    CharacterRegistry,
    TranslationWarning,
)
from app.services.translation_character_helper import (
    _FEMALE_GENDERED_WORDS,
    _MALE_GENDERED_WORDS,
    _classify_pronoun_position,
    classify_translation_note_for_segment,
    detect_self_reference_pronoun_violation,
    neutral_safe_rewrite,
)

logger = logging.getLogger(__name__)


# ── Confidence tiers cho auto-fix ─────────────────────────────────
AUTOFIX_HIGH_CONFIDENCE = 0.90
AUTOFIX_MEDIUM_CONFIDENCE = 0.60


# ── Check 1: Pronoun mismatch với character profile ───────────────

def _check1_pronoun_mismatch(
    seg: dict,
    profile: CharacterProfile,
) -> tuple[Optional[TranslationWarning], Optional[str]]:
    """Detect locked+high conf char với subject pronoun ngược gender.

    Returns: (warning_or_None, rewrite_text_or_None).
    """
    if not (profile.locked and profile.gender_confidence >= GENDER_HIGH):
        return (None, None)
    if profile.gender not in ("male", "female"):
        return (None, None)

    text = (seg.get("translated_text") or "").strip()
    if not text:
        return (None, None)

    violation = detect_self_reference_pronoun_violation(
        text, expected_gender=profile.gender,
    )
    if not violation:
        return (None, None)

    # High confidence — pattern match exact + locked char → auto-fix
    rewrite_conf = AUTOFIX_HIGH_CONFIDENCE
    suggested = neutral_safe_rewrite(text)
    if suggested == text:
        # Couldn't rewrite confidently → keep original, just warn
        rewrite_conf = 0.0

    warning = TranslationWarning(
        segment_id=seg.get("index", seg.get("id", "?")),
        character_id=profile.character_id,
        issue="locked_character_gender_violated",
        original_translation=text,
        corrected_translation=suggested if rewrite_conf >= AUTOFIX_HIGH_CONFIDENCE else None,
        auto_fixed=rewrite_conf >= AUTOFIX_HIGH_CONFIDENCE,
    )
    return (warning, suggested if rewrite_conf >= AUTOFIX_HIGH_CONFIDENCE else None)


# ── Check 2: Cross-batch pronoun consistency ──────────────────────

def _aggregate_pair_pronouns(
    segments: list[dict],
    registry: CharacterRegistry,
) -> dict[tuple[str, str], Counter]:
    """Aggregate subject-position pronouns per (speaker_char, addressee_char) pair.

    Heuristic: nếu seg.character_id = A và text bắt đầu với pronoun gendered
    (anh/em/cô/chị/etc.), assume self-ref (gọi mình). Đếm subject pronoun
    distribution per character → detect drift across "batches" (we treat
    every N consecutive segments as a batch).

    Returns: dict[(speaker_char_id, "_self_"), Counter(pronoun → count)]
      hoặc dict[(speaker_char_id, addressee_char_id), Counter] (Phase 12 extends).

    Phase 10 simplification: chỉ track self-reference pronoun distribution per
    char. Cross-pair tracking deferred (cần dialog turn analysis).
    """
    pair_counter: dict[tuple[str, str], Counter] = defaultdict(Counter)
    all_gendered = _MALE_GENDERED_WORDS + _FEMALE_GENDERED_WORDS

    import re as _re
    for seg in segments:
        cid = seg.get("character_id")
        if not cid or cid not in registry.characters:
            continue
        text = (seg.get("translated_text") or "").strip()
        if not text:
            continue

        # Find first subject-position pronoun
        for word in all_gendered:
            pattern = _re.compile(rf"\b{word}\b", _re.IGNORECASE)
            m = pattern.search(text)
            if m:
                position = _classify_pronoun_position(text, m.group(), m.start())
                if position == "subject":
                    pair_counter[(cid, "_self_")][word.lower()] += 1
                    break  # 1 subject pronoun per segment
    return pair_counter


def _check2_cross_batch_drift(
    segments: list[dict],
    registry: CharacterRegistry,
    *,
    batch_size: int = 20,
) -> list[TranslationWarning]:
    """Detect khi cùng character thay đổi self-reference pronoun across batches.

    Ví dụ: batch 1 dùng "anh" cho CHAR_001, batch 3 đổi sang "ngươi" → drift.

    Conservative: chỉ flag khi 2 batches dùng pronoun semantically khác nhau
    (vd "anh" ↔ "hắn" vs "anh" ↔ "chàng" — cùng nam, KHÔNG flag).
    """
    warnings: list[TranslationWarning] = []
    # Split segments thành batches theo timeline order
    batches = [
        segments[i:i + batch_size]
        for i in range(0, len(segments), batch_size)
    ]
    if len(batches) < 2:
        return warnings  # cần ≥ 2 batches để detect drift

    # Per character: pronoun distribution per batch
    per_batch_pronouns: dict[str, list[Counter]] = defaultdict(list)
    for batch in batches:
        batch_counter = _aggregate_pair_pronouns(batch, registry)
        for (cid, _), pronoun_counts in batch_counter.items():
            per_batch_pronouns[cid].append(pronoun_counts)

    for cid, batch_counters in per_batch_pronouns.items():
        if len(batch_counters) < 2:
            continue
        # Get dominant pronoun per batch (mode)
        dominants: list[str] = []
        for bc in batch_counters:
            if bc:
                dominants.append(bc.most_common(1)[0][0])
        if len(set(dominants)) <= 1:
            continue  # consistent — skip

        # Group dominants by gender — drift OK trong cùng gender, FLAG cross-gender
        male_set = set(_MALE_GENDERED_WORDS)
        gender_of: list[str] = []
        for d in dominants:
            if d in male_set:
                gender_of.append("male")
            else:
                gender_of.append("female")
        if len(set(gender_of)) > 1:
            # Cross-gender drift → flag
            warnings.append(TranslationWarning(
                segment_id=f"{cid}_drift_aggregate",
                character_id=cid,
                issue="batch_pronoun_drift",
                original_translation=f"batch pronouns: {dominants}",
                corrected_translation=None,
                auto_fixed=False,
            ))
    return warnings


# ── Check 3: Low ownership segments không over-gendered ───────────

def _check3_low_ownership_over_gendered(
    seg: dict,
    profile: Optional[CharacterProfile],
) -> tuple[Optional[TranslationWarning], Optional[str]]:
    """Segment có ownership_confidence < LOW + translation force gendered
    subject pronoun → flag + conservative neutral rewrite."""
    own_conf = float(seg.get("ownership_confidence") or 1.0)
    if own_conf >= OWNERSHIP_LOW:
        return (None, None)

    text = (seg.get("translated_text") or "").strip()
    if not text:
        return (None, None)

    # Check subject-position gendered pronoun present
    import re as _re
    all_gendered = _MALE_GENDERED_WORDS + _FEMALE_GENDERED_WORDS
    for word in all_gendered:
        pattern = _re.compile(rf"\b{word}\b", _re.IGNORECASE)
        for m in pattern.finditer(text):
            position = _classify_pronoun_position(text, m.group(), m.start())
            if position == "subject":
                # Force gendered subject on low-ownership seg → warning
                rewritten = neutral_safe_rewrite(text)
                will_autofix = (
                    rewritten != text and own_conf < 0.30  # very low → fix
                )
                warning = TranslationWarning(
                    segment_id=seg.get("index", seg.get("id", "?")),
                    character_id=profile.character_id if profile else None,
                    issue="ownership_low_neutral_forced",
                    original_translation=text,
                    corrected_translation=rewritten if will_autofix else None,
                    auto_fixed=will_autofix,
                )
                return (warning, rewritten if will_autofix else None)
    return (None, None)


# ── Check 4: Unknown gender không bị ép gendered ──────────────────

def _has_other_gendered_pronoun_nearby(
    text: str, exclude_match_index: int, exclude_pronoun: str,
) -> bool:
    """Phase 11 fix Check 4 false positive: detect khi text chứa ANOTHER
    gendered pronoun ở object/addressee position → subject pronoun có thể
    là 3rd person reference (không phải self-ref).

    Ví dụ: "Cô đợi anh ấy" — subject "Cô" + object "anh ấy" (có "ấy" marker
    cho 3rd person) → "Cô" cũng có thể là "she" (3rd person), không phải
    "I/me" self-reference. Conservative: KHÔNG auto-fix.

    Returns: True nếu có 1 gendered pronoun KHÁC trong text (NOT subject).
    """
    import re as _re
    all_gendered = _MALE_GENDERED_WORDS + _FEMALE_GENDERED_WORDS
    for word in all_gendered:
        if word.lower() == exclude_pronoun.lower():
            # Skip same word — only check OTHER pronouns
            pass
        pattern = _re.compile(rf"\b{word}\b", _re.IGNORECASE)
        for m in pattern.finditer(text):
            if m.start() == exclude_match_index:
                continue  # same occurrence
            # Check this other pronoun is NOT subject
            position = _classify_pronoun_position(text, m.group(), m.start())
            if position in ("object", "addressee"):
                # Strong indicator that text discusses multiple people
                # → original subject could also be 3rd person reference.
                return True
            # Check for "ấy" 3rd person marker right after this pronoun
            after = text[m.end():m.end() + 6].lstrip()
            if after.lower().startswith("ấy"):
                return True
    return False


def _check4_unknown_gender_forced(
    seg: dict,
    profile: Optional[CharacterProfile],
) -> tuple[Optional[TranslationWarning], Optional[str]]:
    """Char có gender unknown nhưng translation dùng subject gendered pronoun.

    Phase 11 fix (Phase 10 review item):
      - Subject pronoun + ANOTHER gendered pronoun (object/addressee, or
        with "ấy" marker) → AMBIGUOUS 3rd person possible → warning only,
        KHÔNG auto-fix (avoid semantic-breaking rewrite "Cô đợi anh ấy"
        → "Tôi đợi anh ấy").
      - Subject pronoun + no other gendered pronoun → likely self-ref →
        auto-fix neutral.
    """
    if profile is None or profile.gender != "unknown":
        return (None, None)
    text = (seg.get("translated_text") or "").strip()
    if not text:
        return (None, None)

    import re as _re
    all_gendered = _MALE_GENDERED_WORDS + _FEMALE_GENDERED_WORDS
    for word in all_gendered:
        pattern = _re.compile(rf"\b{word}\b", _re.IGNORECASE)
        for m in pattern.finditer(text):
            position = _classify_pronoun_position(text, m.group(), m.start())
            if position != "subject":
                continue

            # Phase 11 refinement: check for AMBIGUOUS 3rd-person context
            is_ambiguous = _has_other_gendered_pronoun_nearby(
                text, m.start(), m.group(),
            )

            if is_ambiguous:
                # Conservative: keep original, warning only (low tier)
                # — "Cô đợi anh ấy" could be 3rd-person "she waits for him",
                # rewrite to "Tôi đợi anh ấy" would change semantic.
                warning = TranslationWarning(
                    segment_id=seg.get("index", seg.get("id", "?")),
                    character_id=profile.character_id,
                    issue="ambiguous_pronoun",
                    original_translation=text,
                    corrected_translation=None,
                    auto_fixed=False,
                )
                return (warning, None)

            # Likely self-reference — auto-fix to neutral
            rewritten = neutral_safe_rewrite(text)
            will_autofix = (rewritten != text)
            warning = TranslationWarning(
                segment_id=seg.get("index", seg.get("id", "?")),
                character_id=profile.character_id,
                issue="gender_unknown_forced_safe",
                original_translation=text,
                corrected_translation=rewritten if will_autofix else None,
                auto_fixed=will_autofix,
            )
            return (warning, rewritten if will_autofix else None)
    return (None, None)


# ── Main entry ────────────────────────────────────────────────────

def run_translation_qa(
    segments: list[dict],
    registry: Optional[CharacterRegistry],
    *,
    batch_size: int = 20,
) -> dict:
    """Run 4 QA checks + auto-fix policy.

    Args:
      segments: list seg with translated_text + character_id (+ ownership_confidence).
      registry: from Phase 5, có thể None (face-only path → skip most checks).
      batch_size: for cross-batch drift check.

    Returns:
      {
        "warnings": list[TranslationWarning],
        "rewrites": dict[segment_id, new_text],
        "stats": {
          "total_segments": int,
          "checks_run": 4,
          "issues_found": int,
          "auto_fixed": int,
          "kept_original_due_to_low_confidence": int,
        }
      }
    """
    warnings: list[TranslationWarning] = []
    rewrites: dict = {}
    issues_found = 0
    auto_fixed_count = 0
    kept_original_count = 0

    if not segments:
        return {
            "warnings": [], "rewrites": {},
            "stats": {
                "total_segments": 0, "checks_run": 4,
                "issues_found": 0, "auto_fixed": 0,
                "kept_original_due_to_low_confidence": 0,
            },
        }

    # Per-segment checks (1, 3, 4)
    for seg in segments:
        cid = seg.get("character_id")
        profile = None
        if registry is not None and cid and cid in registry.characters:
            profile = registry.characters[cid]

        # Check 1: locked + high conf pronoun mismatch
        if profile:
            w1, fix1 = _check1_pronoun_mismatch(seg, profile)
            if w1:
                warnings.append(w1)
                issues_found += 1
                if fix1 is not None:
                    rewrites[seg.get("index", seg.get("id"))] = fix1
                    auto_fixed_count += 1
                else:
                    kept_original_count += 1

        # Check 3: low ownership + over-gendered
        w3, fix3 = _check3_low_ownership_over_gendered(seg, profile)
        if w3:
            warnings.append(w3)
            issues_found += 1
            if fix3 is not None:
                # Don't overwrite if check 1 already fixed
                key = seg.get("index", seg.get("id"))
                if key not in rewrites:
                    rewrites[key] = fix3
                    auto_fixed_count += 1
            else:
                kept_original_count += 1

        # Check 4: unknown gender forced
        if profile:
            w4, fix4 = _check4_unknown_gender_forced(seg, profile)
            if w4:
                warnings.append(w4)
                issues_found += 1
                if fix4 is not None:
                    key = seg.get("index", seg.get("id"))
                    if key not in rewrites:
                        rewrites[key] = fix4
                        auto_fixed_count += 1
                else:
                    kept_original_count += 1

    # Check 2: cross-batch drift (batch-level)
    if registry is not None and len(segments) > batch_size:
        drift_warnings = _check2_cross_batch_drift(
            segments, registry, batch_size=batch_size,
        )
        warnings.extend(drift_warnings)
        issues_found += len(drift_warnings)
        # Drift is aggregate — no per-seg rewrite, just warn
        kept_original_count += len(drift_warnings)

    logger.info(
        "translation_qa: %d segments · %d issues · %d auto-fixed · "
        "%d kept original (low confidence)",
        len(segments), issues_found, auto_fixed_count, kept_original_count,
    )

    return {
        "warnings": warnings,
        "rewrites": rewrites,
        "stats": {
            "total_segments": len(segments),
            "checks_run": 4,
            "issues_found": issues_found,
            "auto_fixed": auto_fixed_count,
            "kept_original_due_to_low_confidence": kept_original_count,
        },
    }


def apply_qa_rewrites(
    segments: list[dict],
    rewrites: dict,
    *,
    text_field: str = "translated_text",
    speech_field: str = "speech_text",
) -> int:
    """Apply auto-fix rewrites in-place. Returns count applied."""
    applied = 0
    for seg in segments:
        key = seg.get("index", seg.get("id"))
        if key in rewrites:
            new_text = rewrites[key]
            seg[text_field] = new_text
            seg[speech_field] = new_text
            applied += 1
    return applied
