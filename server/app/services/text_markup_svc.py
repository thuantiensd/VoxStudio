"""Text markup parser cho TTS — hỗ trợ pause marker + future expansion.

Custom markup format đơn giản (KHÔNG dùng SSML đầy đủ vì OmniVoice không
parse được, Edge TTS qua thư viện Communicate cũng không nhận SSML):

  [pause:500]      → pause 500ms (khuyến nghị 200-3000ms)
  [pause:0.5s]     → pause 500ms (alias đơn vị giây)
  [p:500]          → alias ngắn của [pause:500]

Backend chiến lược:
  1. parse_markers(text) → list of (chunk_text, pause_ms_after)
  2. tts_svc gen từng chunk → concat WAV với silence chèn giữa
  3. Output 1 file duy nhất

Tương lai mở rộng (sau khi user feedback):
  [emphasis:strong]hello[/emphasis]
  [rate:slow]chậm[/rate]
  [voice:linh]Linh nói[/voice]
"""

from __future__ import annotations

import logging
import re
from typing import List, Tuple

logger = logging.getLogger(__name__)


# Match: [pause:500] [pause:0.5s] [p:500] [p:0.5s]
# Group 1: full marker (for replace), Group 2: value, Group 3: optional 's' suffix
_PAUSE_PATTERN = re.compile(r"\[(?:pause|p):(\d+(?:\.\d+)?)(s|ms)?\]", re.IGNORECASE)

# Hard limits để chống abuse
MIN_PAUSE_MS = 50
MAX_PAUSE_MS = 5000  # 5 giây — đủ cho mọi use case văn phong


def _ms_from_match(value: str, unit: str | None) -> int:
    """Convert match group → milliseconds with bounds clamp."""
    try:
        num = float(value)
    except ValueError:
        return 0
    if unit and unit.lower() == "s":
        ms = int(num * 1000)
    else:
        ms = int(num)
    return max(MIN_PAUSE_MS, min(MAX_PAUSE_MS, ms))


def parse_markers(text: str) -> List[Tuple[str, int]]:
    """Tách text thành list (chunk, pause_after_ms).

    Pause được attach vào CHUNK ĐỨNG TRƯỚC nó. Chunk cuối có pause_after_ms=0.

    Examples:
      "Hello [pause:500] world" → [("Hello", 500), ("world", 0)]
      "A [p:0.5s] B [p:1s] C"   → [("A", 500), ("B", 1000), ("C", 0)]
      "No markers"              → [("No markers", 0)]
      "[p:500] start"           → [("", 500), ("start", 0)]  (leading pause)
    """
    if not text:
        return []

    chunks: List[Tuple[str, int]] = []
    last_end = 0
    for match in _PAUSE_PATTERN.finditer(text):
        chunk_text = text[last_end:match.start()].strip()
        pause_ms = _ms_from_match(match.group(1), match.group(2))
        chunks.append((chunk_text, pause_ms))
        last_end = match.end()

    # Chunk cuối (sau marker cuối, hoặc toàn bộ nếu không có marker)
    tail = text[last_end:].strip()
    if tail or not chunks:
        chunks.append((tail, 0))

    return chunks


def has_markers(text: str) -> bool:
    """Quick check không cần parse full — dùng để skip pre-process khi không cần."""
    return bool(_PAUSE_PATTERN.search(text or ""))


def strip_markers(text: str) -> str:
    """Bỏ tất cả markers, trả text plain. Dùng cho display preview /
    char count UI mà không tính markers vào limit."""
    if not text:
        return ""
    return _PAUSE_PATTERN.sub("", text).strip()
