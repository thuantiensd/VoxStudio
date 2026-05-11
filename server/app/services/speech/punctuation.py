"""Punctuation restoration + sentence-aware splitting (CapCut-style).

Vấn đề Whisper Chinese (và 1 số ngôn ngữ): output text KHÔNG có dấu câu rõ.
  "郡主你说你来我这十多回有谁能帮你"

CapCut + các tool pro dùng pipeline:
  1. Whisper transcribe (text raw)
  2. Punctuation restoration (thêm dấu câu)
  3. Split theo dấu câu (sentence boundary)
  4. Length normalize (mỗi sub 3-7s)

Module này implement phase 2-4.

Tools:
  - deepmultilingualpunctuation (free, multilingual)
  - pysbd (sentence boundary detection)

Fallback nếu lib không cài: regex split + heuristic.
"""
from __future__ import annotations

import logging
import re
import threading
from typing import Optional

logger = logging.getLogger(__name__)


_punct_lock = threading.Lock()
_punct_model = None
_pysbd_segmenters: dict = {}


# ── Punctuation restoration ──────────────────────────────────

def _load_punct_model():
    """Lazy-load deepmultilingualpunctuation model.
    Hỗ trợ: en, de, fr, it, pl, nl, vi, hi, jp + Chinese qua transformer.
    """
    global _punct_model
    if _punct_model is not None:
        return _punct_model
    with _punct_lock:
        if _punct_model is not None:
            return _punct_model
        try:
            from deepmultilingualpunctuation import PunctuationModel
            logger.info("Loading PunctuationModel...")
            _punct_model = PunctuationModel()
            logger.info("PunctuationModel ready")
            return _punct_model
        except ImportError:
            logger.warning(
                "deepmultilingualpunctuation not installed — punctuation restore skipped",
            )
            _punct_model = False  # marker = không có
            return False
        except Exception as e:
            logger.warning("PunctuationModel load fail: %s", e)
            _punct_model = False
            return False


def restore_punctuation(text: str, language: Optional[str] = None) -> str:
    """Thêm dấu câu vào text raw (output Whisper).

    Tries:
      1. deepmultilingualpunctuation (multilingual neural model)
      2. Heuristic fallback (regex thêm dấu chấm cuối + space-based)
    """
    if not text or not text.strip():
        return text
    # Đã có dấu câu nhiều → skip
    punct_count = sum(1 for c in text if c in ".!?。！？，,")
    if punct_count >= max(1, len(text.split()) // 4):
        return text

    model = _load_punct_model()
    if model:
        try:
            return model.restore_punctuation(text)
        except Exception as e:
            logger.warning("restore_punctuation fail: %s — fallback heuristic", e)

    # Heuristic fallback: thêm dấu chấm cuối nếu chưa có
    text = text.strip()
    if text and text[-1] not in ".!?。！？":
        # Detect Chinese vs latin
        if any("一" <= c <= "鿿" for c in text):
            text = text + "。"
        else:
            text = text + "."
    return text


# ── Sentence splitter ────────────────────────────────────────

def _get_pysbd_segmenter(language: str):
    """Lazy-load pysbd segmenter per language."""
    if language in _pysbd_segmenters:
        return _pysbd_segmenters[language]
    try:
        import pysbd
        # pysbd supports: en, mr, hi, jp, zh, fr, it, ru, es, am, de, pl, nl, ar
        # Map common ISO to pysbd codes
        lang_map = {
            "vi": "en",       # Vietnamese: dùng English rules (gần nhất)
            "vietnamese": "en",
            "chinese": "zh",
            "japanese": "jp",
            "korean": "en",   # Korean: fallback English
            "english": "en",
        }
        pysbd_lang = lang_map.get(language.lower() if language else "", language or "en")
        seg = pysbd.Segmenter(language=pysbd_lang, clean=False)
        _pysbd_segmenters[language] = seg
        return seg
    except ImportError:
        logger.info("pysbd not installed — fallback regex sentence split")
        _pysbd_segmenters[language] = None
        return None
    except Exception as e:
        logger.warning("pysbd init fail for %s: %s", language, e)
        _pysbd_segmenters[language] = None
        return None


_SENTENCE_END = re.compile(r"([。！？\.\!\?][\"'\)\]]*\s*)")


def split_into_sentences(text: str, language: Optional[str] = None) -> list[str]:
    """Split text thành sentences. Try pysbd → regex fallback."""
    if not text or not text.strip():
        return []
    seg = _get_pysbd_segmenter(language or "en")
    if seg is not None:
        try:
            return [s.strip() for s in seg.segment(text) if s.strip()]
        except Exception:
            pass
    # Regex fallback: split sau . ! ? 。 ！ ？
    parts = _SENTENCE_END.split(text)
    sentences = []
    current = ""
    for p in parts:
        current += p
        if _SENTENCE_END.match(p):
            if current.strip():
                sentences.append(current.strip())
            current = ""
    if current.strip():
        sentences.append(current.strip())
    return sentences or [text.strip()]


# ── Process segments (main API) ──────────────────────────────

def punctuate_and_split_segments(
    segments: list[dict],
    language: Optional[str] = None,
    max_chars_per_sub: int = 50,
    min_chars_per_sub: int = 8,
) -> list[dict]:
    """CapCut-style: restore punctuation + split sentence + length normalize.

    Args:
      segments: từ Whisper, mỗi seg có {start, end, text, words?}
      language: ISO code ("zh", "vi", "en") — affect punctuation rule + split
      max_chars_per_sub: câu dài hơn → cắt tại "，" ","
      min_chars_per_sub: câu ngắn hơn → merge với câu kế

    Returns: new segments với text có dấu câu + mỗi seg = 1 câu hoàn chỉnh.
    """
    if not segments:
        return segments

    out: list[dict] = []
    has_punct_model = bool(_load_punct_model())

    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue

        # 1. Restore punctuation
        text_punct = restore_punctuation(text, language=language)

        # 2. Split sentences
        sentences = split_into_sentences(text_punct, language=language)
        if not sentences:
            sentences = [text_punct]

        # 3. Length normalize — merge câu ngắn + split câu dài
        sentences = _normalize_sentence_lengths(
            sentences,
            max_chars=max_chars_per_sub,
            min_chars=min_chars_per_sub,
            language=language,
        )

        # 4. Re-assign timestamps proportional (theo char count hoặc words)
        seg_start = float(seg["start"])
        seg_end = float(seg["end"])
        seg_dur = max(0.01, seg_end - seg_start)

        words = seg.get("words") or []
        if words and len(words) >= len(sentences):
            # Có word timestamps → map chính xác
            assigned = _map_sentences_to_words(sentences, words, seg_start, seg_end)
            out.extend(assigned)
        else:
            # Không có word timestamps → chia proportional theo char
            total_chars = sum(len(s) for s in sentences) or 1
            cursor = seg_start
            for i, sent in enumerate(sentences):
                frac = len(sent) / total_chars
                sub_end = seg_end if i == len(sentences) - 1 else cursor + seg_dur * frac
                out.append({
                    "start": round(cursor, 2),
                    "end": round(sub_end, 2),
                    "text": sent,
                    "speaker": seg.get("speaker"),
                    "avg_logprob": seg.get("avg_logprob", 0),
                    "no_speech_prob": seg.get("no_speech_prob", 0),
                })
                cursor = sub_end

    method = "neural" if has_punct_model else "heuristic"
    logger.info(
        "Punctuate+split (%s): %d → %d sentences",
        method, len(segments), len(out),
    )
    return out


def _normalize_sentence_lengths(
    sentences: list[str],
    max_chars: int,
    min_chars: int,
    language: Optional[str] = None,
) -> list[str]:
    """Merge câu ngắn + split câu dài tại "，"."""
    # Pass 1: split câu dài tại comma
    splitted = []
    for sent in sentences:
        if len(sent) <= max_chars:
            splitted.append(sent)
            continue
        # Split tại comma/semicolon — giữ chunk gần midpoint
        chunks = re.split(r"(?<=[，,；;])\s*", sent)
        chunks = [c.strip() for c in chunks if c.strip()]
        if len(chunks) >= 2 and all(len(c) <= max_chars + 10 for c in chunks):
            splitted.extend(chunks)
        else:
            # Force split half (last resort)
            mid = len(sent) // 2
            splitted.append(sent[:mid].strip())
            splitted.append(sent[mid:].strip())

    # Pass 2: merge câu ngắn liền nhau
    merged: list[str] = []
    for sent in splitted:
        if merged and len(merged[-1]) < min_chars and len(merged[-1]) + len(sent) <= max_chars:
            merged[-1] = (merged[-1] + " " + sent).strip()
        else:
            merged.append(sent)
    return merged


def _map_sentences_to_words(
    sentences: list[str],
    words: list[dict],
    seg_start: float,
    seg_end: float,
) -> list[dict]:
    """Map mỗi sentence → khoảng time dựa vào words (chính xác hơn proportional).

    Algorithm: char-greedy match words với sentence, lấy start/end của
    first/last matched word.
    """
    if not words:
        return []

    # Build full text từ words với positions
    full_text = "".join(w.get("word", "") for w in words)
    if not full_text.strip():
        return []

    # Vị trí mỗi word trong full_text
    word_positions = []
    pos = 0
    for w in words:
        w_text = w.get("word", "")
        word_positions.append((pos, pos + len(w_text), w))
        pos += len(w_text)

    # Match từng sentence với chunk trong full_text
    out = []
    text_cursor = 0
    for sent in sentences:
        # Tìm sentence trong full_text starting từ text_cursor
        # Strip whitespace/punct trong sent để match dễ hơn
        sent_clean = re.sub(r"\s+", "", sent)
        full_clean_from_cursor = re.sub(r"\s+", "", full_text[text_cursor:])

        # Find substring (best effort — Whisper text vs punctuated may differ)
        # Use char-level fuzzy: count overlapping chars
        sent_start_char = text_cursor
        sent_end_char = text_cursor + len(sent_clean) + 5  # slack

        # Find words covering [sent_start_char, sent_end_char]
        sent_words = []
        for w_start, w_end, w_data in word_positions:
            if w_end <= sent_start_char:
                continue
            if w_start >= sent_end_char:
                break
            sent_words.append(w_data)

        if sent_words:
            t_start = float(sent_words[0].get("start", seg_start))
            t_end = float(sent_words[-1].get("end", seg_end))
        else:
            # Fallback: proportional
            t_start = seg_start + (sent_start_char / max(1, len(full_text))) * (seg_end - seg_start)
            t_end = seg_start + (sent_end_char / max(1, len(full_text))) * (seg_end - seg_start)
            t_end = min(t_end, seg_end)

        out.append({
            "start": round(t_start, 2),
            "end": round(t_end, 2),
            "text": sent,
            "speaker": sent_words[0].get("speaker") if sent_words else None,
            "words": sent_words,
        })
        text_cursor = sent_end_char

    return out
