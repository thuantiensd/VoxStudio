"""Glossary helper — terms cố định cần giữ nguyên hoặc dịch theo cách user
chỉ định. Hỗ trợ 2 path:

1. **LLM engines** (Claude/GPT/Gemini/Qwen): inject glossary làm
   instruction trong prompt. LLM tự tuân thủ.
2. **Non-LLM engines** (Google Free / Google Cloud / DeepL): post-process
   tìm-thay sau khi dịch. Dùng word-boundary regex case-insensitive cho
   term, không match giữa từ.

Format input (text user gõ trong UI):

    ChatGPT=ChatGPT
    neural network=mạng nơ-ron
    GPU=keep
    Claude=Claude
    AI=keep

  · `keep`  → giữ nguyên source term, không dịch.
  · `gốc=` (rỗng RHS) → coi như `keep`.
  · Dòng trống / bắt đầu `#` → bỏ qua.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


def parse_glossary(raw: str | None) -> list[tuple[str, str]]:
    """Parse multi-line text → list of (source, target). Giữ thứ tự để
    apply ưu tiên dòng trên (term dài hơn nên đặt trước nếu user muốn
    tránh substring match — nhưng word-boundary đã hạn chế khá ổn).
    """
    if not raw:
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        src, _, dst = line.partition("=")
        src = src.strip()
        dst = dst.strip()
        if not src:
            continue
        # Dedup theo source (lower)
        key = src.lower()
        if key in seen:
            continue
        seen.add(key)
        # `keep` hoặc rỗng → giữ nguyên source
        if not dst or dst.lower() == "keep":
            dst = src
        out.append((src, dst))
    return out


def format_for_prompt(glossary: list[tuple[str, str]]) -> str:
    """Render glossary thành block text inject vào LLM prompt."""
    if not glossary:
        return ""
    lines = []
    for src, dst in glossary:
        if src == dst:
            lines.append(f'- "{src}" → keep as "{src}" (do NOT translate)')
        else:
            lines.append(f'- "{src}" → translate as "{dst}"')
    return "GLOSSARY (apply EXACTLY, this is mandatory):\n" + "\n".join(lines)


_WORD_CHAR = re.compile(r"\w", re.UNICODE)


def _word_boundary_pattern(term: str) -> re.Pattern:
    """Pattern case-insensitive khớp term với word boundary mềm.
    Dùng (?<!\\w) và (?!\\w) thay \\b để hỗ trợ Unicode tốt hơn.
    Term có thể chứa space → escape rồi cho phép \\s+ giữa các word.
    """
    parts = re.split(r"\s+", term.strip())
    body = r"\s+".join(re.escape(p) for p in parts if p)
    return re.compile(rf"(?<!\w){body}(?!\w)", re.IGNORECASE)


def apply_post_process(
    translated: list[str],
    glossary: list[tuple[str, str]],
    sources: list[str] | None = None,
) -> list[str]:
    """Áp dụng glossary lên TỪNG output sau khi engine dịch xong.

    Strategy: với mỗi (src, dst) trong glossary, tìm `src` trong source
    text → vị trí (i, span). Nếu xuất hiện trong source, ép output i
    chứa `dst`. Heuristic đơn giản: tìm-thay case-insensitive ở output.

    Lý do dùng src làm chốt: engine có thể đã dịch term đi (vd Google
    dịch "ChatGPT" thành "Trò chuyện GPT"). Khi đó tìm src trong output
    không match. Fallback: scan các pattern hay gặp ("ChatGPT" → "Trò
    chuyện GPT" / "GPT chat") khó tổng quát, nên skip.

    Cải thiện: pre-process source text — wrap term trong placeholder
    `[[GL_0]]` mà engine sẽ giữ nguyên. Phương án này ổn hơn nhưng
    phức tạp; áp dụng cho phase sau nếu cần.

    Trả về list mới cùng độ dài.
    """
    if not glossary or not translated:
        return translated
    out = list(translated)
    for src, dst in glossary:
        # Skip pair vô nghĩa (src == dst rỗng)
        if not src or not dst:
            continue
        try:
            pat = _word_boundary_pattern(src)
        except re.error:
            continue
        for i, txt in enumerate(out):
            if not txt:
                continue
            try:
                out[i] = pat.sub(dst, txt)
            except Exception:
                # Skip nếu replacement có chứa \1 v.v. (paranoid)
                continue
    return out


def format_topic_hint_for_prompt(hint: str | None) -> str:
    """Render topic hint thành 1-line context cho LLM prompt."""
    if not hint:
        return ""
    h = hint.strip()
    if not h:
        return ""
    # Cap length 500 chars để không bloat prompt
    if len(h) > 500:
        h = h[:500] + "…"
    return f"VIDEO CONTEXT (for translation tone/terminology): {h}"
