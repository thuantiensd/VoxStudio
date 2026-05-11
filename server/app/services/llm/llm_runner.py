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
)

logger = logging.getLogger(__name__)

TIMEOUT_S = 90
MIN_SPEAKERS_FOR_ANALYZE = 2


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
) -> dict:
    """Pass-0: speaker relationship analysis. Skip nếu 1 speaker.

    Returns {} nếu skip/fail (caller phải fallback Pass-1 không anchor).
    """
    spks = {s.get("speaker") for s in segments if s.get("speaker")}
    spks.discard(None)
    spks.discard("")
    if len(spks) < MIN_SPEAKERS_FOR_ANALYZE:
        return {}

    prompt = build_speaker_analysis_prompt(
        segments=segments, source_lang=source_lang, film_genre=film_genre,
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


def run_edit(
    *,
    engine: str,
    items: list[dict],
    target_lang: str,
    source_lang: str,
    speaker_relationships: Optional[dict] = None,
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
    m = model or "gemini-2.5-flash"
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
    m = model or "gpt-4o-mini"
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
    m = model or "claude-3-5-haiku-20241022"
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
