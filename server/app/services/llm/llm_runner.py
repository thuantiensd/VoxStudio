"""LLM runner — gọi LLM thực cho 3 pass: analyze, translate, edit.

Wrapper duy nhất cho 3 engine (Gemini SDK + OpenAI/Claude HTTP). Mỗi
pass chỉ cần build prompt → gọi runner → parse output.

Public API:
  run_analyze(engine, segments, source_lang, ..., api_key) → relationships dict
  run_translate(engine, segments, ..., api_key) → list[dict] (literal)
  run_edit(engine, items, ..., api_key) → list[dict] (polished)
"""
from __future__ import annotations

import logging
from typing import Optional

from .prompts import (
    build_speaker_analysis_prompt,
    parse_speaker_analysis,
    build_translator_prompt,
    parse_translator_response,
    build_editor_prompt,
    parse_editor_response,
    build_visual_context_prompt,
    parse_visual_context,
)

logger = logging.getLogger(__name__)

TIMEOUT_S = 90
VISION_TIMEOUT_S = 120  # VLM với images chậm hơn
# Pass-0 vẫn chạy với 1 speaker để detect register/genre (cổ trang/modern…)
# — info này critical cho Pass-1/Pass-2 quyết định vocab/honorifics.
MIN_SPEAKERS_FOR_ANALYZE = 1


# Vision-capable models per engine — backend list cho FE dropdown.
# Mặc định = flagship tier (instruction-following mạnh nhất, ít hallucination,
# tốt cho phim cổ trang + name fidelity).
VISION_MODELS = {
    "gemini": [
        {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash (nhanh, rẻ)"},
        {"id": "gemini-2.5-pro",   "label": "Gemini 2.5 Pro (flagship)", "default": True},
    ],
    "openai": [
        {"id": "gpt-4o-mini",     "label": "GPT-4o mini (rẻ, cũ)"},
        {"id": "gpt-4o",          "label": "GPT-4o (cũ, T5/2024)"},
        {"id": "gpt-4.1-mini",    "label": "GPT-4.1 mini (rẻ, instruction-tuned)"},
        {"id": "gpt-4.1",         "label": "GPT-4.1 (instruction-tuned)"},
        {"id": "gpt-5-mini",      "label": "GPT-5 mini (cân đối)"},
        {"id": "gpt-5",           "label": "GPT-5 (flagship, chuẩn nhất)", "default": True},
    ],
    "claude": [
        {"id": "claude-3-5-haiku-20241022",  "label": "Claude 3.5 Haiku (rẻ, cũ)"},
        {"id": "claude-3-5-sonnet-20241022", "label": "Claude 3.5 Sonnet (cũ)"},
        {"id": "claude-sonnet-4-5",          "label": "Claude Sonnet 4.5 (cân đối)"},
        {"id": "claude-sonnet-4-6",          "label": "Claude Sonnet 4.6 (mid-flagship)"},
        {"id": "claude-opus-4-5",            "label": "Claude Opus 4.5 (flagship)", "default": True},
    ],
}


# ═══════════════════════════════════════════════════════════════
# Pass dispatchers
# ═══════════════════════════════════════════════════════════════

def run_analyze(
    *,
    engine: str,
    segments: list[dict],
    source_lang: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    film_genre: Optional[str] = None,
    visual_context: Optional[dict] = None,
    entity_registry: Optional[dict] = None,
) -> dict:
    """Pass-0: speaker relationship analysis. Skip nếu 1 speaker.

    Nếu có visual_context (từ Pass-(-1) VLM) → inject làm ground truth.
    entity_registry: từ Python scan toàn file → name anchor authoritative.

    Returns {} nếu skip/fail (caller phải fallback Pass-1 không anchor).
    """
    spks = {s.get("speaker") for s in segments if s.get("speaker")}
    spks.discard(None)
    spks.discard("")
    if len(spks) < MIN_SPEAKERS_FOR_ANALYZE:
        return {}

    prompt = build_speaker_analysis_prompt(
        segments=segments, source_lang=source_lang,
        film_genre=film_genre, visual_context=visual_context,
        entity_registry=entity_registry,
    )
    try:
        raw = _call_llm(engine, prompt, api_key=api_key, model=model)
    except Exception as e:
        logger.warning("run_analyze fail (%s): %s", engine, e)
        return {}

    result = parse_speaker_analysis(raw)
    if result and result.get("speakers"):
        logger.info("Pass-0 (%s): %d speakers, register=%r",
                     engine, len(result["speakers"]),
                     result.get("register", ""))
    return result


def run_translate(
    *,
    engine: str,
    segments: list[dict],
    target_lang: str,
    source_lang: str,
    speaker_relationships: Optional[dict] = None,
    context_before: Optional[list[dict]] = None,
    topic_hint: Optional[str] = None,
    glossary_block: Optional[str] = None,
    film_genre: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> list[dict]:
    """Pass-1: literal translation. Returns list[{translated_text, emotion}]."""
    prompt = build_translator_prompt(
        segments=segments,
        target_lang=target_lang,
        source_lang=source_lang,
        speaker_relationships=speaker_relationships,
        context_before=context_before,
        topic_hint=topic_hint,
        glossary_block=glossary_block,
        film_genre=film_genre,
        engine=engine,
    )
    raw = _call_llm(engine, prompt, api_key=api_key, model=model)
    return parse_translator_response(raw, len(segments))


def run_visual_analyze(
    *,
    engine: str,
    frame_paths: list,
    source_lang: str = "auto",
    api_key: str | None = None,
    model: str | None = None,
) -> dict:
    """Pass-(-1): visual context analysis qua VLM.

    Args:
      engine: gemini/openai/claude
      frame_paths: list[Path|str] tới keyframe JPG/PNG (8 frames ideal)
      api_key: required (BYOK)
      model: optional override; default = bản rẻ nhất từ VISION_MODELS

    Returns: {genre, register, scene_summary, characters[], relationships[]}
             hoặc {} nếu fail.
    """
    if not frame_paths:
        return {}
    prompt_text = build_visual_context_prompt(source_lang=source_lang, n_frames=len(frame_paths))

    try:
        if engine == "gemini":
            raw = _call_gemini_vision(prompt_text, frame_paths, api_key=api_key, model=model)
        elif engine == "openai":
            raw = _call_openai_vision(prompt_text, frame_paths, api_key=api_key, model=model)
        elif engine == "claude":
            raw = _call_claude_vision(prompt_text, frame_paths, api_key=api_key, model=model)
        else:
            logger.warning("Visual: engine %r không support", engine)
            return {}
    except Exception as e:
        logger.warning("run_visual_analyze fail (%s): %s", engine, e)
        return {}

    result = parse_visual_context(raw)
    if result.get("characters"):
        logger.info("Visual (%s): %d characters, genre=%r, register=%r",
                     engine, len(result["characters"]),
                     result.get("genre", ""), result.get("register", ""))
    return result


def run_edit(
    *,
    engine: str,
    items: list[dict],
    target_lang: str,
    source_lang: str,
    speaker_relationships: Optional[dict] = None,
    film_genre: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> list[dict]:
    """Pass-2: polish literal → film style. Returns list[{translated_text, emotion}].

    Items mỗi cái: {index, speaker, original, literal, max_chars}.
    """
    prompt = build_editor_prompt(
        items=items,
        target_lang=target_lang,
        source_lang=source_lang,
        speaker_relationships=speaker_relationships,
        film_genre=film_genre,
    )
    raw = _call_llm(engine, prompt, api_key=api_key, model=model)
    return parse_editor_response(raw, len(items))


# ═══════════════════════════════════════════════════════════════
# Engine dispatch
# ═══════════════════════════════════════════════════════════════

def _call_llm(engine: str, prompt: dict,
              api_key: Optional[str], model: Optional[str]) -> str:
    """Dispatch tới engine. Trả raw text response."""
    if engine == "gemini":
        return _call_gemini_sdk(prompt, model=model)
    if engine == "gemini_http":
        return _call_gemini_http(prompt, api_key=api_key, model=model)
    if engine == "openai":
        return _call_openai_http(prompt, api_key=api_key, model=model)
    if engine == "claude":
        return _call_claude_http(prompt, api_key=api_key, model=model)
    raise ValueError(f"engine không support: {engine!r}")


def _call_gemini_sdk(prompt: dict, model: Optional[str] = None) -> str:
    """Gemini via SDK. Hard timeout via threading."""
    import google.generativeai as genai
    from app.config import GEMINI_API_KEY

    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set")
    genai.configure(api_key=GEMINI_API_KEY)
    m = genai.GenerativeModel(model or "gemini-2.5-flash")

    import threading
    import queue as _queue

    full_prompt = prompt["system"] + "\n\n" + prompt["user"]
    result_q: _queue.Queue = _queue.Queue()

    def _worker():
        try:
            cfg = genai.types.GenerationConfig(temperature=0.2)
            r = m.generate_content(full_prompt, generation_config=cfg)
            result_q.put(("ok", r.text))
        except Exception as e:
            result_q.put(("err", e))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    try:
        kind, value = result_q.get(timeout=TIMEOUT_S)
    except _queue.Empty:
        raise TimeoutError(f"Gemini timeout {TIMEOUT_S}s")
    if kind == "err":
        raise value
    return value


def _call_gemini_http(prompt: dict, api_key: Optional[str], model: Optional[str]) -> str:
    if not api_key:
        raise ValueError("api_key required cho gemini_http")
    import httpx
    m = model or "gemini-2.5-pro"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
    full = prompt["system"] + "\n\n" + prompt["user"]
    payload = {
        "contents": [{"parts": [{"text": full}]}],
        "generationConfig": {"temperature": 0.2},
    }
    with httpx.Client(timeout=TIMEOUT_S) as c:
        r = c.post(url, params={"key": api_key}, json=payload,
                    headers={"Content-Type": "application/json"})
        r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _call_openai_http(prompt: dict, api_key: Optional[str], model: Optional[str]) -> str:
    if not api_key:
        raise ValueError("api_key required cho openai")
    import httpx
    m = model or "gpt-5"
    payload = {
        "model": m,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt["system"]},
            {"role": "user", "content": prompt["user"]},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=TIMEOUT_S) as c:
        r = c.post("https://api.openai.com/v1/chat/completions",
                    json=payload, headers=headers)
        r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _call_claude_http(prompt: dict, api_key: Optional[str], model: Optional[str]) -> str:
    if not api_key:
        raise ValueError("api_key required cho claude")
    import httpx
    m = model or "claude-opus-4-5"
    payload = {
        "model": m,
        "max_tokens": 4096,
        "temperature": 0.2,
        "system": prompt["system"],
        "messages": [{"role": "user", "content": prompt["user"]}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=TIMEOUT_S) as c:
        r = c.post("https://api.anthropic.com/v1/messages",
                    json=payload, headers=headers)
        r.raise_for_status()
    return r.json()["content"][0]["text"]


# ═══════════════════════════════════════════════════════════════
# Vision (VLM) callers — encode image base64 + multimodal request
# ═══════════════════════════════════════════════════════════════

def _read_image_b64(path) -> tuple[str, str]:
    """Read image file → (mime_type, base64_str)."""
    import base64
    from pathlib import Path
    p = Path(path)
    suffix = p.suffix.lower()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp"}.get(suffix, "image/jpeg")
    return mime, base64.b64encode(p.read_bytes()).decode("ascii")


def _call_gemini_vision(prompt_text: str, frame_paths: list,
                         api_key: Optional[str], model: Optional[str]) -> str:
    """Gemini vision via HTTP (multimodal generateContent)."""
    if not api_key:
        raise ValueError("api_key required cho gemini vision")
    import httpx
    m = model or "gemini-2.5-pro"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"

    parts = [{"text": prompt_text}]
    for fp in frame_paths:
        mime, b64 = _read_image_b64(fp)
        parts.append({"inline_data": {"mime_type": mime, "data": b64}})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.1},
    }
    with httpx.Client(timeout=VISION_TIMEOUT_S) as c:
        r = c.post(url, params={"key": api_key}, json=payload,
                    headers={"Content-Type": "application/json"})
        r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _call_openai_vision(prompt_text: str, frame_paths: list,
                         api_key: Optional[str], model: Optional[str]) -> str:
    """OpenAI vision (gpt-4o family) — chat.completions với image_url base64."""
    if not api_key:
        raise ValueError("api_key required cho openai vision")
    import httpx
    m = model or "gpt-5"

    content = [{"type": "text", "text": prompt_text}]
    for fp in frame_paths:
        mime, b64 = _read_image_b64(fp)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })

    payload = {
        "model": m,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": content}],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=VISION_TIMEOUT_S) as c:
        r = c.post("https://api.openai.com/v1/chat/completions",
                    json=payload, headers=headers)
        r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _call_claude_vision(prompt_text: str, frame_paths: list,
                         api_key: Optional[str], model: Optional[str]) -> str:
    """Claude vision — messages API với image content blocks."""
    if not api_key:
        raise ValueError("api_key required cho claude vision")
    import httpx
    m = model or "claude-opus-4-5"

    content = []
    for fp in frame_paths:
        mime, b64 = _read_image_b64(fp)
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": b64},
        })
    content.append({"type": "text", "text": prompt_text})

    payload = {
        "model": m,
        "max_tokens": 2048,
        "temperature": 0.1,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=VISION_TIMEOUT_S) as c:
        r = c.post("https://api.anthropic.com/v1/messages",
                    json=payload, headers=headers)
        r.raise_for_status()
    return r.json()["content"][0]["text"]
