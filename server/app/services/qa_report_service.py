"""QA Report Service (Phase 11 audit refactor).

Build canonical `qa_report.json` aggregating warnings từ tất cả phases 5-10:

  Phase 5  — registry.possible_merges (from character_registry.json)
  Phase 6  — project["ownership_warnings"]
  Phase 7a — project["gender_conflicts"]
  Phase 8  — project["voice_map_warnings"]
  Phase 9/10 — project["translation_warnings"]
  Phase 12 placeholder — project["timing_warnings"]
  Pipeline-wide — project["system_errors"]

Public API:
  build_qa_report(project, registry) → QAReport
  save_qa_report(qa_report, output_path) → None
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import OWNERSHIP_LOW
from app.models.character_schemas import (
    CharacterRegistry,
    GenderConflict,
    OwnershipWarning,
    PossibleMerge,
    QAReport,
    QASummary,
    SystemError,
    TimingWarning,
    TranslationWarning,
    VoiceConflict,
    VoiceMapWarning,
    VoiceWarning,
)

logger = logging.getLogger(__name__)


# ── Low-confidence ownership reasons (Phase 6) ────────────────────
_LOW_OWNERSHIP_REASONS = (
    "short_segment_keep",
    "low_quality_embedding_keep",
    "no_segment_embedding",
    "low_conf_keep",
    "no_character_embedding",
)


# ── Helpers ───────────────────────────────────────────────────────

def _parse_warning_list(
    raw: Optional[list],
    model_cls,
) -> list:
    """Validate raw list[dict] vs Pydantic model. Skip invalid items."""
    if not raw:
        return []
    out: list = []
    for item in raw:
        if isinstance(item, model_cls):
            out.append(item)
            continue
        if not isinstance(item, dict):
            continue
        try:
            out.append(model_cls.model_validate(item))
        except Exception as e:
            logger.debug(
                "qa_report: skipping invalid %s entry: %s",
                model_cls.__name__, e,
            )
    return out


def _count_low_confidence_segments(segments: list[dict]) -> int:
    """Count segments có ownership_tier=low hoặc reason indicating low conf."""
    count = 0
    for s in segments:
        tier = s.get("ownership_tier")
        reason = s.get("ownership_decision_reason")
        own_conf = s.get("ownership_confidence")
        if tier == "low":
            count += 1
            continue
        if reason in _LOW_OWNERSHIP_REASONS:
            count += 1
            continue
        if own_conf is not None and float(own_conf) < OWNERSHIP_LOW:
            count += 1
    return count


def _collect_uncertain_segment_ids(segments: list[dict]) -> list:
    """Return list segment_id (index hoặc id) cho seg có ownership_tier=low."""
    out = []
    for s in segments:
        tier = s.get("ownership_tier")
        reason = s.get("ownership_decision_reason")
        own_conf = s.get("ownership_confidence")
        is_low = (
            tier == "low"
            or reason in _LOW_OWNERSHIP_REASONS
            or (own_conf is not None and float(own_conf) < OWNERSHIP_LOW)
        )
        if is_low:
            seg_id = s.get("id") or s.get("index")
            if seg_id is not None:
                out.append(seg_id)
    return out


# ── Main entry ────────────────────────────────────────────────────

def build_qa_report(
    project: dict,
    registry: Optional[CharacterRegistry] = None,
) -> QAReport:
    """Build QAReport từ project meta + character_registry.

    Args:
      project: project meta dict (đã có warnings từ Phase 5-10).
      registry: CharacterRegistry — có thể reconstruct từ project meta nếu None.

    Returns: validated QAReport instance.
    """
    project_id = project.get("id", "unknown")
    segments = project.get("segments") or []

    # Reconstruct registry from project meta nếu chưa pass vào
    if registry is None:
        registry = _reconstruct_registry_from_project(project)

    # ── Summary counts ──
    total_segments = len(segments)
    total_characters = len(registry.characters) if registry else 0
    low_conf_count = _count_low_confidence_segments(segments)
    low_conf_ratio = (low_conf_count / total_segments) if total_segments > 0 else 0.0

    unknown_gender_count = 0
    if registry:
        unknown_gender_count = sum(
            1 for c in registry.characters.values()
            if c.gender == "unknown" or c.review_required
        )

    # system_errors có thể chứa entries "critical" — count chúng
    raw_sys_errors = project.get("system_errors") or []
    system_errors = _parse_warning_list(raw_sys_errors, SystemError)
    # Treat error_type with TIMEOUT/MODEL_FAIL/API_RATE_LIMIT as critical
    critical_error_types = {"TIMEOUT", "MODEL_FAIL", "API_RATE_LIMIT", "FATAL"}
    critical_count = sum(
        1 for e in system_errors if e.error_type in critical_error_types
    )

    summary = QASummary(
        total_segments=total_segments,
        total_characters=total_characters,
        low_confidence_segments=low_conf_count,
        low_confidence_ratio=round(low_conf_ratio, 3),
        unknown_gender_characters=unknown_gender_count,
        critical_errors=critical_count,
    )

    # ── uncertain_characters: chars có review_required hoặc gender unknown ──
    uncertain_chars: list[str] = []
    if registry:
        for cid, profile in registry.characters.items():
            if profile.review_required or profile.gender == "unknown":
                uncertain_chars.append(cid)

    # ── uncertain_segments: segments có tier=low ──
    uncertain_segs = _collect_uncertain_segment_ids(segments)

    # ── Parse warnings từ project meta ──
    possible_merges = (
        list(registry.possible_merges) if registry else []
    )

    gender_conflicts = _parse_warning_list(
        project.get("gender_conflicts"), GenderConflict,
    )
    ownership_warnings = _parse_warning_list(
        project.get("ownership_warnings"), OwnershipWarning,
    )
    translation_warnings = _parse_warning_list(
        project.get("translation_warnings"), TranslationWarning,
    )
    voice_map_warnings = _parse_warning_list(
        project.get("voice_map_warnings"), VoiceMapWarning,
    )
    # Phase 12 Item 7 — TTS-time voice routing warnings + conflicts
    voice_warnings = _parse_warning_list(
        project.get("voice_warnings"), VoiceWarning,
    )
    voice_conflicts = _parse_warning_list(
        project.get("voice_conflicts"), VoiceConflict,
    )
    timing_warnings = _parse_warning_list(
        project.get("timing_warnings"), TimingWarning,
    )

    # Merge uncertain_segments_no_char (Phase 12) vào uncertain_segs
    extra_uncert = project.get("uncertain_segments_no_char") or []
    for sid in extra_uncert:
        if sid not in uncertain_segs:
            uncertain_segs.append(sid)

    report = QAReport(
        project_id=project_id,
        generated_at=datetime.now(timezone.utc),
        summary=summary,
        uncertain_characters=uncertain_chars,
        uncertain_segments=uncertain_segs,
        possible_merges=possible_merges,
        gender_conflicts=gender_conflicts,
        ownership_warnings=ownership_warnings,
        translation_warnings=translation_warnings,
        voice_map_warnings=voice_map_warnings,
        voice_warnings=voice_warnings,
        voice_conflicts=voice_conflicts,
        timing_warnings=timing_warnings,
        system_errors=system_errors,
    )

    logger.info(
        "qa_report: project=%s · %d segments · %d chars · "
        "%d low_conf segs · %d unknown_gender chars · %d critical errors · "
        "%d translation + %d ownership + %d gender conflicts + %d voice_map warnings",
        project_id, total_segments, total_characters,
        low_conf_count, unknown_gender_count, critical_count,
        len(translation_warnings), len(ownership_warnings),
        len(gender_conflicts), len(voice_map_warnings),
    )

    return report


def _reconstruct_registry_from_project(project: dict) -> Optional[CharacterRegistry]:
    """Build CharacterRegistry stub from project["character_registry_summary"].

    Used khi caller không pass registry — read persisted summary từ transcribe.
    """
    from app.models.character_schemas import CharacterProfile

    summary = project.get("character_registry_summary") or {}
    char_list = summary.get("characters") or []
    if not char_list:
        return None

    chars: dict = {}
    for c in char_list:
        cid = c.get("character_id")
        if not cid:
            continue
        try:
            chars[cid] = CharacterProfile(
                character_id=cid,
                source_speakers=c.get("source_speakers") or [],
                gender=c.get("gender", "unknown"),
                gender_confidence=float(c.get("gender_confidence") or 0.0),
                line_count=int(c.get("line_count") or 0),
                merge_confidence=float(c.get("merge_confidence") or 1.0),
                locked=bool(c.get("locked") or False),
                review_required=bool(c.get("review_required") or False),
            )
        except Exception as e:
            logger.debug("Skipping invalid character entry %s: %s", cid, e)

    if not chars:
        return None

    # Possible merges from summary
    possible_merges_raw = summary.get("possible_merges") or []
    possible_merges = []
    for pm in possible_merges_raw:
        if isinstance(pm, PossibleMerge):
            possible_merges.append(pm)
            continue
        if isinstance(pm, dict):
            try:
                possible_merges.append(PossibleMerge.model_validate(pm))
            except Exception:
                pass

    return CharacterRegistry(
        project_id=project.get("id", ""),
        characters=chars,
        possible_merges=possible_merges,
    )


def save_qa_report(qa_report: QAReport, output_path: Path) -> None:
    """Write qa_report.json (pretty UTF-8)."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    js = qa_report.model_dump_json(indent=2)
    output_path.write_text(js, encoding="utf-8")
    logger.info("Saved qa_report.json: %s (%.1fKB)",
                output_path, output_path.stat().st_size / 1024)
