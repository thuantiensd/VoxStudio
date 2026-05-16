"""Translation character helper (Phase 9 + 11 refactor).

Phase 11 NOTE: function `build_registry_block_for_translate(project)` đã
được move từ `dubbing_svc` xuống đây để giảm dep weight cho test env (pod
fresh thiếu ffmpeg-python sẽ vẫn run helper unit tests OK).

Utilities cho character-aware translation flow. Tách khỏi gemini_translate_svc
/ cloud_translate_svc / llm_translate_svc để 3 engines đều consume cùng API.

Public:
  build_character_registry_prompt_block(registry) → str
      Format CharacterRegistry → prompt text cho LLM (gender, role, lines,
      relationship hints).

  gather_translation_context(segments, batch_indices, window) → list[dict]
      Lấy `window` segments trước + sau batch làm REFERENCE-ONLY context
      (không yêu cầu dịch lại). LLM dùng để hiểu pronoun flow.

  parse_llm_translation_note(raw) → str
      Whitelist validator. Returns 1 trong VALID_TRANSLATION_NOTES, default
      "ok" nếu LLM hallucinate.

  validate_locked_character_translations(segments, registry) → list[TranslationWarning]
      Post-translation QA: detect khi LLM thay đổi gender/pronoun cho
      character có `locked=True` + gender_confidence >= GENDER_HIGH.

  classify_translation_note_for_segment(segment, character_profile,
                                        ownership_tier) → TranslationNote
      Suggest note theo segment + character state (cho fallback khi LLM
      KHÔNG trả note).
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from app.config import GENDER_HIGH
from app.models.character_schemas import (
    VALID_TRANSLATION_NOTES,
    CharacterProfile,
    CharacterRegistry,
    TranslationWarning,
)

logger = logging.getLogger(__name__)


# ── Prompt block builder ──────────────────────────────────────────

def build_character_registry_prompt_block(
    registry: Optional[CharacterRegistry],
    *,
    include_locked_marker: bool = True,
    chars_meta: Optional[dict] = None,
) -> str:
    """Format CharacterRegistry → human-readable prompt block cho LLM.

    Args:
      registry: từ Phase 5 build_character_registry, có thể None.
      include_locked_marker: emit "[LOCKED]" tag cho char có locked=True.
      chars_meta: optional dict[raw_speaker, {character_name, age, role}]
        từ Pass-0 LLM analyze — merge name/age vào prompt nếu match qua
        source_speakers.

    Returns: prompt text, "" nếu registry rỗng.

    Format example:
      CHARACTER REGISTRY (use for consistent xưng hô):
      - CHAR_000 [Wang Wei, male, gender_confidence=0.92, role=protagonist, lines=120]
      - CHAR_001 [Lin Xiao, female, gender_confidence=0.88, role=love_interest, lines=85]
      - CHAR_002 [unknown, gender_confidence=0.0, lines=12] — neutral-safe required
    """
    if registry is None or not registry.characters:
        return ""

    chars_meta = chars_meta or {}
    # Reverse map raw_speaker → chars_meta entry
    spk_to_meta = chars_meta if isinstance(chars_meta, dict) else {}

    lines = ["CHARACTER REGISTRY (use for consistent xưng hô):"]
    sorted_chars = sorted(
        registry.characters.items(),
        key=lambda kv: (-kv[1].line_count, kv[0]),
    )
    for cid, profile in sorted_chars:
        # Try get character_name + role từ chars_meta via source_speakers
        name = None
        role = None
        for raw_spk in profile.source_speakers:
            entry = spk_to_meta.get(raw_spk) if isinstance(spk_to_meta, dict) else None
            if isinstance(entry, dict):
                name = name or entry.get("character_name") or None
                role = role or entry.get("role") or None
                if name and role:
                    break

        parts: list[str] = []
        if name:
            parts.append(name)
        parts.append(profile.gender if profile.gender else "unknown")
        parts.append(f"gender_confidence={profile.gender_confidence:.2f}")
        if role:
            parts.append(f"role={role}")
        parts.append(f"lines={profile.line_count}")

        locked_tag = " [LOCKED]" if (include_locked_marker and profile.locked) else ""
        rule_hint = ""
        if profile.gender == "unknown" or profile.gender_confidence < 0.60:
            rule_hint = " — neutral-safe required"
        elif profile.gender_confidence < GENDER_HIGH:
            rule_hint = " — medium confidence, prefer profile but allow neutral if ambiguous"
        elif profile.locked:
            rule_hint = " — locked, do NOT change gender/pronoun"

        lines.append(f"- {cid}{locked_tag} [{', '.join(parts)}]{rule_hint}")

    # Possible merges hint
    if registry.possible_merges:
        lines.append("")
        lines.append("POSSIBLE MERGES (chars có thể là cùng nhân vật, treat consistently):")
        for pm in registry.possible_merges[:5]:  # cap 5 to avoid prompt bloat
            lines.append(
                f"- {' ↔ '.join(pm.characters)} (sim={pm.similarity:.2f}, "
                f"evidences={pm.evidences_count})"
            )

    lines.append("")
    lines.append("RULES:")
    lines.append(
        f"- gender_confidence >= {GENDER_HIGH}: follow profile gender strictly "
        "(use correct anh/em/cô/chị)."
    )
    lines.append(
        "- 0.60 <= gender_confidence < 0.80: use profile but allow neutral "
        "Vietnamese (tôi/cậu) if ambiguous."
    )
    lines.append(
        "- gender_confidence < 0.60 or unknown: use neutral-safe Vietnamese "
        "(tôi/cậu/người đó). Do NOT invent anh/em/cô/chị."
    )
    lines.append("- LOCKED characters: gender + pronoun MUST match profile.")
    lines.append(
        "- Don't invent xưng hô if source language is genuinely ambiguous."
    )

    return "\n".join(lines)


# ── Context window for batch ──────────────────────────────────────

def gather_translation_context(
    segments: list[dict],
    batch_indices: list[int],
    window: int = 3,
) -> tuple[list[dict], list[dict]]:
    """Get `window` segments before + after batch as reference-only context.

    LLM sẽ thấy context để hiểu pronoun flow nhưng KHÔNG dịch lại.

    Args:
      segments: full segment list (already translated or not — we just read text).
      batch_indices: indices của batch hiện tại trong segments list (sorted asc).
      window: số segment trước + sau batch.

    Returns: (context_before, context_after). Mỗi list ≤ window items.
    """
    if not batch_indices or not segments:
        return ([], [])
    first = batch_indices[0]
    last = batch_indices[-1]
    before = segments[max(0, first - window):first]
    after = segments[last + 1:last + 1 + window]
    return (before, after)


def format_context_block(
    context_before: list[dict],
    context_after: list[dict],
    *,
    text_field: str = "original_text",
) -> str:
    """Format context segments thành prompt block.

    LLM treats these as REFERENCE ONLY — không trả translation cho các segments này.
    """
    if not context_before and not context_after:
        return ""
    lines = ["CONTEXT (REFERENCE ONLY — do NOT translate these, just understand pronoun flow):"]
    if context_before:
        lines.append("--- before batch ---")
        for s in context_before:
            cid = s.get("character_id") or s.get("speaker") or "?"
            txt = (s.get(text_field) or "").strip()
            lines.append(f"  [{cid}] {txt}")
    if context_after:
        lines.append("--- after batch ---")
        for s in context_after:
            cid = s.get("character_id") or s.get("speaker") or "?"
            txt = (s.get(text_field) or "").strip()
            lines.append(f"  [{cid}] {txt}")
    return "\n".join(lines)


# ── LLM translation_note validation ───────────────────────────────

def parse_llm_translation_note(raw: Optional[str]) -> str:
    """Validate LLM-returned translation_note vs whitelist.

    Returns 1 trong VALID_TRANSLATION_NOTES. Invalid input → "ok" + log warning.
    Empty/None → "ok" silently (LLM didn't return note).
    """
    if not raw or not isinstance(raw, str):
        return "ok"
    normalized = raw.strip().lower()
    if normalized in VALID_TRANSLATION_NOTES:
        return normalized
    # Try removing common LLM prefix/suffix noise
    cleaned = re.sub(r"[^a-z_]", "", normalized)
    if cleaned in VALID_TRANSLATION_NOTES:
        return cleaned
    logger.warning(
        "Phase 9: LLM returned invalid translation_note %r — fallback 'ok'",
        raw[:60],
    )
    return "ok"


def classify_translation_note_for_segment(
    segment: dict,
    character_profile: Optional[CharacterProfile],
    *,
    ownership_tier: Optional[str] = None,
) -> str:
    """Compute expected translation_note dựa trên segment + character state.

    Dùng làm DEFAULT khi LLM không trả note (fallback). Cũng dùng làm
    EXPECTED note để compare với LLM output (QA — Phase 10).

    Logic:
      - char gender unknown or conf < 0.60 → "neutral_safe_due_to_low_gender_confidence"
      - ownership_tier == "low" → "neutral_safe_due_to_low_ownership_confidence"
      - char gender_confidence >= GENDER_HIGH → "follows_character_profile"
      - else → "ok"
    """
    if character_profile is None:
        return "ok"

    gc = character_profile.gender_confidence
    g = character_profile.gender

    if g == "unknown" or gc < 0.60:
        return "neutral_safe_due_to_low_gender_confidence"

    if ownership_tier == "low":
        return "neutral_safe_due_to_low_ownership_confidence"

    if gc >= GENDER_HIGH:
        return "follows_character_profile"

    return "ok"


# ── Locked character QA ───────────────────────────────────────────

# Patterns to detect gender-specific Vietnamese pronouns in translation
# (used for verifying LOCKED characters' gender consistency).
_MALE_PRONOUNS = re.compile(
    r"\b(anh|chú|cậu|ông|chàng|hắn|cha|bố|ba)\b",
    re.IGNORECASE,
)
_FEMALE_PRONOUNS = re.compile(
    r"\b(cô|chị|bà|nàng|cô\s+ấy|mẹ|má|dì)\b",
    re.IGNORECASE,
)


# ── Phase 10: Subject-position pronoun detection (Option A) ───────
# Heuristic: pronoun ở vị trí SUBJECT (chủ ngữ) → self-reference candidate.
# Pronoun ở OBJECT/ADDRESSEE position → khác character (không phải self-ref).
#
# Quy tắc subject position trong tiếng Việt:
#   1. Token đầu câu (sau ".!?\n" hoặc câu mở đầu) là chủ ngữ.
#   2. Sau "Tôi/Tớ/Ta + verb là/làm" — đây là self-identification context.
#   3. Trước verb chính của câu — heuristic word-distance.
#
# Object/addressee position:
#   1. Sau verb (đi/đến/về/gặp/nói/hỏi/...).
#   2. Sau preposition (với/cho/về/đến/cho/của).
#   3. Sau vocative "ơi, à, ạ" (kêu gọi).
#
# Trade-off: Position-based đơn giản, KHÔNG phải parser thật.
# 80-90% accuracy cho phim drama VN, đủ cho conservative auto-fix.

_SENTENCE_BOUNDARY = re.compile(r"[.!?\n]+\s*")

_MALE_GENDERED_WORDS: tuple[str, ...] = (
    "anh", "chú", "cậu", "ông", "chàng", "hắn", "cha", "bố", "ba",
)
_FEMALE_GENDERED_WORDS: tuple[str, ...] = (
    "cô", "chị", "bà", "nàng", "mẹ", "má", "dì",
)

# Vocative / addressee particles → token trước/sau hay là addressee
_VOCATIVE_PARTICLES = re.compile(r"\b(ơi|à|ạ|nhé|nha)\b", re.IGNORECASE)

# Verbs sau đó hay là object position
_COMMON_VERBS = re.compile(
    r"\b(đi|đến|về|gặp|nói|hỏi|nhìn|thấy|yêu|ghét|hiểu|đợi|tin|nhớ|"
    r"chờ|tìm|cứu|giúp|hỏng|làm)\b",
    re.IGNORECASE,
)

# Prepositions sau đó token là object
_PREPOSITIONS = re.compile(
    r"\b(với|cho|về|đến|của|từ|qua|cùng|theo|vì|do)\b",
    re.IGNORECASE,
)


def _classify_pronoun_position(
    text: str, pronoun: str, match_start: int,
) -> str:
    """Classify pronoun position: "subject" / "object" / "addressee" / "unknown".

    Position-based heuristic:
      - subject:   đầu câu (≤3 từ từ boundary), không sau verb/preposition.
      - addressee: trước/sau vocative particle (ơi/à/ạ).
      - object:    sau verb hoặc preposition.
      - unknown:   không match rule nào.
    """
    # Find sentence boundary trước pronoun
    text_before = text[:match_start]
    sentence_start = 0
    for m in _SENTENCE_BOUNDARY.finditer(text_before):
        sentence_start = m.end()
    sentence_segment_before = text[sentence_start:match_start].strip()

    # Check addressee — vocative particle gần (trong cùng câu)
    sentence_after = text[match_start:match_start + len(pronoun) + 20]
    if _VOCATIVE_PARTICLES.search(sentence_after):
        return "addressee"
    sentence_before_full = text[sentence_start:match_start].strip()
    # "Anh ơi!" → vocative ngay sau pronoun
    rest_after_pronoun = text[match_start + len(pronoun):].lstrip()
    if rest_after_pronoun and rest_after_pronoun[:5].startswith(("ơi", "à", "ạ")):
        return "addressee"

    # Object position: sau verb hoặc preposition (token cuối của sentence_before)
    tokens_before = sentence_segment_before.split()
    if tokens_before:
        last_token = tokens_before[-1].lower()
        if _COMMON_VERBS.fullmatch(last_token) or _PREPOSITIONS.fullmatch(last_token):
            return "object"

    # Subject position: ≤3 tokens từ sentence boundary
    if len(tokens_before) <= 2:
        return "subject"

    return "unknown"


def detect_self_reference_pronoun_violation(
    text: str,
    expected_gender: str,
    *,
    allow_unknown_as_neutral: bool = True,
) -> Optional[dict]:
    """Detect khi text dùng SUBJECT pronoun ngược gender expected.

    Phase 10: smarter than simple regex (Phase 9). Chỉ flag subject-position
    pronoun (self-reference), KHÔNG flag addressee/object (legitimate khác char).

    Args:
      text: translated text (Vietnamese).
      expected_gender: "male" / "female" — char's profile gender.
      allow_unknown_as_neutral: True → "tôi/cậu/ta" KHÔNG flag (neutral OK).

    Returns: dict {pronoun, position, expected, actual} nếu violation.
      None nếu OK / addressee / không có subject pronoun ngược gender.
    """
    if expected_gender not in ("male", "female"):
        return None
    if not text or not isinstance(text, str):
        return None

    # Wrong-gender words list
    if expected_gender == "male":
        wrong_words = _FEMALE_GENDERED_WORDS
        actual_label = "female"
    else:
        wrong_words = _MALE_GENDERED_WORDS
        actual_label = "male"

    # Find each wrong-gender pronoun + check position
    for word in wrong_words:
        pattern = re.compile(rf"\b{word}\b", re.IGNORECASE)
        for m in pattern.finditer(text):
            position = _classify_pronoun_position(text, m.group(), m.start())
            if position == "subject":
                return {
                    "pronoun": m.group(),
                    "position": position,
                    "expected_gender": expected_gender,
                    "actual_gender": actual_label,
                    "match_index": m.start(),
                }
    return None


def neutral_safe_rewrite(text: str) -> str:
    """Rewrite text → neutral pronouns (subject-position only).

    Phase 10 conservative auto-fix khi confidence medium:
      "Anh đến đây" → "Tôi đến đây"
      "Cô không hiểu" → "Tôi không hiểu"

    Chỉ rewrite SUBJECT pronoun đầu câu (≤2 tokens từ boundary). KHÔNG đổi
    addressee/object pronouns (legitimate khác character).

    Conservative: nếu không chắc → return text unchanged.
    """
    if not text:
        return text

    sentences = re.split(r"([.!?]+\s*)", text)
    rewritten_parts: list[str] = []

    all_gendered = _MALE_GENDERED_WORDS + _FEMALE_GENDERED_WORDS

    for part in sentences:
        if not part or _SENTENCE_BOUNDARY.fullmatch(part):
            rewritten_parts.append(part)
            continue

        tokens = part.split()
        if not tokens:
            rewritten_parts.append(part)
            continue

        first_token_lower = tokens[0].lower().rstrip(",;:")
        if first_token_lower in all_gendered:
            # Check if it's likely subject (no vocative right after)
            if len(tokens) > 1 and tokens[1].lower().rstrip(",;:.!?") not in (
                "ơi", "à", "ạ",
            ):
                # Rewrite to "Tôi"
                tokens[0] = "Tôi"
                part = " ".join(tokens)
        rewritten_parts.append(part)

    return "".join(rewritten_parts)


def validate_locked_character_translations(
    segments: list[dict],
    registry: Optional[CharacterRegistry],
    *,
    text_field: str = "translated_text",
) -> list[TranslationWarning]:
    """Post-translation QA: detect locked characters có translation dùng
    pronoun MÂU THUẪN gender profile.

    LOCKED + gender_confidence >= GENDER_HIGH + translation chứa pronoun
    của gender ngược → warning + auto_fixed=False (Phase 10 sẽ fix).

    Returns: list TranslationWarning.
    """
    if registry is None or not registry.characters:
        return []

    warnings: list[TranslationWarning] = []
    for seg in segments:
        cid = seg.get("character_id")
        if not cid or cid not in registry.characters:
            continue
        profile = registry.characters[cid]
        if not (profile.locked and profile.gender_confidence >= GENDER_HIGH):
            continue
        if profile.gender not in ("male", "female"):
            continue
        text = (seg.get(text_field) or "").strip()
        if not text:
            continue

        male_match = bool(_MALE_PRONOUNS.search(text))
        female_match = bool(_FEMALE_PRONOUNS.search(text))

        # Conflict: char gender vs opposite-gender pronoun in translation.
        # Note: text can legitimately address OTHER characters using their
        # pronouns — so this is a heuristic, not strict. Phase 10 will
        # add smarter syntax analysis.
        violated = False
        if profile.gender == "male" and female_match and not male_match:
            violated = True
        elif profile.gender == "female" and male_match and not female_match:
            violated = True

        if violated:
            warnings.append(TranslationWarning(
                segment_id=seg.get("index", seg.get("id", "?")),
                character_id=cid,
                issue="locked_character_gender_violated",
                original_translation=text,
                corrected_translation=None,
                auto_fixed=False,
            ))

    if warnings:
        logger.warning(
            "Phase 9: %d locked-character pronoun violations in translation",
            len(warnings),
        )

    return warnings


# ── Phase 11: dispatcher helper ──────────────────────────────────

def build_registry_block_for_translate(project: dict) -> Optional[str]:
    """Reconstruct CharacterRegistry từ project meta + format thành prompt
    block cho LLM translate engines.

    Returns: block string nếu registry available, None nếu face-only / no registry.

    Moved từ dubbing_svc → here ở Phase 11 để giảm import weight (dubbing_svc
    import ffmpeg, không có trên test env). Unit tests có thể import helper
    này độc lập.
    """
    try:
        from app.models.character_schemas import CharacterProfile, CharacterRegistry
    except ImportError:
        return None

    reg_summary = (project.get("character_registry_summary") or {}).get("characters") or []
    if not reg_summary:
        return None
    reconstructed: dict = {}
    for c in reg_summary:
        cid = c.get("character_id")
        if not cid:
            continue
        try:
            reconstructed[cid] = CharacterProfile(
                character_id=cid,
                source_speakers=c.get("source_speakers") or [],
                gender=c.get("gender", "unknown"),
                gender_confidence=float(c.get("gender_confidence") or 0.0),
                line_count=int(c.get("line_count") or 0),
                merge_confidence=float(c.get("merge_confidence") or 1.0),
                locked=bool(c.get("locked") or False),
            )
        except Exception:
            continue
    if not reconstructed:
        return None
    registry = CharacterRegistry(
        project_id=project.get("id", ""),
        characters=reconstructed,
    )
    chars_meta = project.get("speaker_characters") or {}
    block = build_character_registry_prompt_block(registry, chars_meta=chars_meta)
    return block or None
