"""Pass-1 speaker relationship analyzer.

Trước khi dịch (Pass-2), gọi LLM 1 lần để phân tích quan hệ giữa các
SPEAKER_XX. Output map sẽ inject vào prompt Pass-2 làm ANCHOR mạnh →
LLM hết chỗ đoán mò pronoun.

Cost: ~$0.001/phim. Time: 5-10s.

Public API:
    analyze_speakers(engine, segments, source_lang, ..., api_key) -> dict
        Returns {scene_context, register, speakers: {SPEAKER_XX: {...}}}.
        Empty dict nếu fail (caller fallback Pass-2 chạy không có anchor).
"""
from __future__ import annotations

import logging
from typing import Optional

from .prompts import (
    build_speaker_analysis_prompt,
    parse_speaker_analysis,
)

logger = logging.getLogger(__name__)

PASS1_TIMEOUT_S = 60
PASS1_MIN_SPEAKERS = 2  # 1 speaker = narration → skip Pass-1


def _count_unique_speakers(segments: list[dict]) -> int:
    spks = {s.get("speaker") for s in segments if s.get("speaker")}
    spks.discard(None)
    spks.discard("")
    return len(spks)


def analyze_speakers(
    *,
    engine: str,
    segments: list[dict],
    source_lang: str,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    film_genre: Optional[str] = None,
) -> dict:
    """Run Pass-1: analyze speaker relationships via LLM.

    Args:
      engine: "gemini" | "openai" | "claude" | "gemini_http" (cloud HTTP)
      segments: full segment list với speaker tag
      source_lang: ngôn ngữ gốc
      api_key: required cho openai/claude/gemini_http (gemini SDK dùng GEMINI_API_KEY env)
      model: optional model override
      film_genre: optional genre hint

    Returns:
      {"scene_context": str, "register": str, "speakers": {...}} hoặc {} nếu fail.
    """
    if _count_unique_speakers(segments) < PASS1_MIN_SPEAKERS:
        # 1 speaker = narration mode → không cần phân tích quan hệ
        return {}

    prompt = build_speaker_analysis_prompt(
        segments=segments,
        source_lang=source_lang,
        film_genre=film_genre,
    )

    try:
        if engine == "gemini":
            raw = _call_gemini_sdk(prompt, model=model)
        elif engine in ("openai",):
            raw = _call_openai_http(prompt, api_key=api_key, model=model)
        elif engine in ("claude",):
            raw = _call_claude_http(prompt, api_key=api_key, model=model)
        elif engine == "gemini_http":
            raw = _call_gemini_http(prompt, api_key=api_key, model=model)
        else:
            logger.warning("speaker_analyzer: engine %r không support, skip Pass-1", engine)
            return {}
    except Exception as e:
        logger.warning("speaker_analyzer Pass-1 fail (%s): %s — fallback Pass-2 không anchor", engine, e)
        return {}

    result = parse_speaker_analysis(raw)
    if result and result.get("speakers"):
        n_spk = len(result["speakers"])
        logger.info(
            "speaker_analyzer Pass-1 ok (%s): %d speakers, register=%r",
            engine, n_spk, result.get("register", ""),
        )
    else:
        logger.warning("speaker_analyzer Pass-1 parse empty (%s)", engine)
    return result


# ── Engine-specific LLM call ────────────────────────────────

def _call_gemini_sdk(prompt: dict, model: Optional[str] = None) -> str:
    """Gemini via google-generativeai SDK (cho gemini_translate_svc legacy path)."""
    import google.generativeai as genai
    from app.config import GEMINI_API_KEY

    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set")
    genai.configure(api_key=GEMINI_API_KEY)
    m = genai.GenerativeModel(model or "gemini-2.0-flash")

    # Hard timeout với threading wrapper (SDK không có timeout native)
    import threading
    import queue as _queue

    result_q: _queue.Queue = _queue.Queue()
    full_prompt = prompt["system"] + "\n\n" + prompt["user"]

    def _worker():
        try:
            r = m.generate_content(full_prompt)
            result_q.put(("ok", r.text))
        except Exception as e:
            result_q.put(("err", e))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    try:
        kind, value = result_q.get(timeout=PASS1_TIMEOUT_S)
    except _queue.Empty:
        raise TimeoutError(f"Gemini Pass-1 timeout {PASS1_TIMEOUT_S}s")
    if kind == "err":
        raise value
    return value


def _call_gemini_http(prompt: dict, api_key: Optional[str], model: Optional[str]) -> str:
    """Gemini via HTTP (cloud_translate_svc path)."""
    if not api_key:
        raise ValueError("api_key required cho gemini_http")
    import httpx
    m = model or "gemini-2.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
    full_prompt = prompt["system"] + "\n\n" + prompt["user"]
    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"temperature": 0.1, "response_mime_type": "application/json"},
    }
    with httpx.Client(timeout=PASS1_TIMEOUT_S) as c:
        r = c.post(url, params={"key": api_key}, json=payload,
                    headers={"Content-Type": "application/json"})
        r.raise_for_status()
        body = r.json()
    return body["candidates"][0]["content"]["parts"][0]["text"]


def _call_openai_http(prompt: dict, api_key: Optional[str], model: Optional[str]) -> str:
    if not api_key:
        raise ValueError("api_key required cho openai")
    import httpx
    m = model or "gpt-4o-mini"
    payload = {
        "model": m,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt["system"]},
            {"role": "user", "content": prompt["user"]},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=PASS1_TIMEOUT_S) as c:
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
        "max_tokens": 2048,
        "temperature": 0.1,
        "system": prompt["system"],
        "messages": [{"role": "user", "content": prompt["user"]}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=PASS1_TIMEOUT_S) as c:
        r = c.post("https://api.anthropic.com/v1/messages",
                    json=payload, headers=headers)
        r.raise_for_status()
    return r.json()["content"][0]["text"]
