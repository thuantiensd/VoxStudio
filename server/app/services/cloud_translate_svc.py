"""Multi-provider cloud translation.

Tất cả engine đều nhận (texts, target, source, api_key) và trả về list[str]
cùng độ dài với `texts`. Engines:

- google_free   : deep_translator.GoogleTranslator, không cần key
- google_cloud  : translation.googleapis.com/language/translate/v2 (API key)
- deepl         : api-free.deepl.com/v2/translate (Authorization: DeepL-Auth-Key)
- gemini        : generativelanguage.googleapis.com (Gemini 1.5 Flash/Pro)
- openai        : api.openai.com/v1/chat/completions (gpt-4o-mini)
- claude        : api.anthropic.com/v1/messages (claude-3-5-haiku)

Key **không lưu server** — renderer (Electron) gửi key kèm request mỗi lần.
Chỉ file translate_svc.py cũ (Google free) vẫn dùng được cho pipeline
dubbing legacy.
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.services.translate_svc import LANG_MAP, translate_batch as google_free_batch

logger = logging.getLogger(__name__)

# Default model mỗi engine — có thể override qua body request nếu cần.
DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "claude": "claude-3-5-haiku-20241022",
    "gemini": "gemini-1.5-flash",
}

TIMEOUT = 60.0

LANG_DISPLAY_NAMES = {
    "vi": "Vietnamese", "en": "English", "zh": "Chinese", "ja": "Japanese",
    "ko": "Korean", "fr": "French", "es": "Spanish", "de": "German",
    "pt": "Portuguese", "ru": "Russian", "th": "Thai", "hi": "Hindi",
    "id": "Indonesian", "ms": "Malay", "tr": "Turkish", "it": "Italian",
    "nl": "Dutch", "pl": "Polish", "ar": "Arabic", "uk": "Ukrainian",
    "vietnamese": "Vietnamese", "english": "English", "chinese": "Chinese",
    "japanese": "Japanese", "korean": "Korean",
}


def _lang_code(lang: str) -> str:
    """Map user-friendly name → ISO code (or auto)."""
    if not lang or lang.lower() in ("", "auto"):
        return "auto"
    return LANG_MAP.get(lang.lower(), lang)


def _lang_display(lang: str) -> str:
    c = _lang_code(lang)
    return LANG_DISPLAY_NAMES.get(c, LANG_DISPLAY_NAMES.get(lang, lang))


# ── Google Cloud Translate v2 ──────────────────────────────

def _google_cloud(texts: list[str], target: str, source: str, api_key: str) -> list[str]:
    url = "https://translation.googleapis.com/language/translate/v2"
    params = {"key": api_key}
    data = {"target": _lang_code(target), "format": "text", "q": texts}
    if source and source.lower() != "auto":
        data["source"] = _lang_code(source)
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(url, params=params, data=data)
    if r.status_code != 200:
        raise ValueError(f"Google Cloud error {r.status_code}: {r.text[:200]}")
    body = r.json()
    return [t.get("translatedText", "") for t in body["data"]["translations"]]


# ── DeepL ──────────────────────────────────────────────────

def _deepl(texts: list[str], target: str, source: str, api_key: str) -> list[str]:
    # DeepL lang codes thường dùng EN/VI/ZH/JA/… (uppercase). Nó không hỗ trợ 'vi'!
    tgt = _lang_code(target).upper().replace("ZH-CN", "ZH")
    # api-free dùng cho key có đuôi ':fx'; pro dùng api.deepl.com
    base = "https://api-free.deepl.com" if api_key.endswith(":fx") else "https://api.deepl.com"
    headers = {"Authorization": f"DeepL-Auth-Key {api_key}"}
    data = [("target_lang", tgt)]
    if source and source.lower() != "auto":
        data.append(("source_lang", _lang_code(source).upper().replace("ZH-CN", "ZH")))
    for t in texts:
        data.append(("text", t))
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(f"{base}/v2/translate", data=data, headers=headers)
    if r.status_code != 200:
        raise ValueError(f"DeepL error {r.status_code}: {r.text[:200]}")
    return [item.get("text", "") for item in r.json().get("translations", [])]


# ── Gemini ─────────────────────────────────────────────────

def _gemini(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None) -> list[str]:
    model = model or DEFAULT_MODELS["gemini"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    tgt_name = _lang_display(target)
    src_name = _lang_display(source) if source and source.lower() != "auto" else "auto-detected source"
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = (
        f"Translate the following numbered lines from {src_name} into {tgt_name}. "
        f"Preserve the exact number of lines and numbering. Output ONLY the translated "
        f"lines in format 'N. <translated>' — no explanations, no code fences.\n\n{numbered}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2},
    }
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(url, params={"key": api_key}, json=payload,
                    headers={"Content-Type": "application/json"})
    if r.status_code != 200:
        raise ValueError(f"Gemini error {r.status_code}: {r.text[:300]}")
    body = r.json()
    raw = body["candidates"][0]["content"]["parts"][0]["text"]
    return _parse_numbered(raw, len(texts))


# ── OpenAI ─────────────────────────────────────────────────

def _openai(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None) -> list[str]:
    model = model or DEFAULT_MODELS["openai"]
    tgt_name = _lang_display(target)
    src_name = _lang_display(source) if source and source.lower() != "auto" else "auto-detected source"
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    system = (
        f"You are a precise {tgt_name} translator. Input is numbered lines in {src_name}. "
        f"Translate each line into natural, idiomatic {tgt_name}. "
        f"Output ONLY the translated lines in format 'N. <text>'. No preamble, no code fences."
    )
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": numbered},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post("https://api.openai.com/v1/chat/completions",
                    json=payload, headers=headers)
    if r.status_code != 200:
        raise ValueError(f"OpenAI error {r.status_code}: {r.text[:300]}")
    raw = r.json()["choices"][0]["message"]["content"]
    return _parse_numbered(raw, len(texts))


# ── Anthropic Claude ───────────────────────────────────────

def _claude(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None) -> list[str]:
    model = model or DEFAULT_MODELS["claude"]
    tgt_name = _lang_display(target)
    src_name = _lang_display(source) if source and source.lower() != "auto" else "auto-detected source"
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    system = (
        f"You are a precise {tgt_name} translator. Translate numbered {src_name} lines "
        f"into natural, idiomatic {tgt_name}. Output ONLY the translated lines in format "
        f"'N. <text>'. No preamble."
    )
    payload = {
        "model": model,
        "max_tokens": 4096,
        "temperature": 0.2,
        "system": system,
        "messages": [{"role": "user", "content": numbered}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post("https://api.anthropic.com/v1/messages",
                    json=payload, headers=headers)
    if r.status_code != 200:
        raise ValueError(f"Claude error {r.status_code}: {r.text[:300]}")
    raw = r.json()["content"][0]["text"]
    return _parse_numbered(raw, len(texts))


# ── Helpers ────────────────────────────────────────────────

def _parse_numbered(raw: str, n: int) -> list[str]:
    """Parse 'N. <text>' lines from LLM response. Returns list of length n."""
    import re
    out = [""] * n
    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^(\d+)[.):\-\s]+(.+)$", line)
        if m:
            idx = int(m.group(1)) - 1
            if 0 <= idx < n:
                out[idx] = m.group(2).strip()
    # Fallback: nếu parse thất bại hoàn toàn, trả raw split theo newline
    if not any(out):
        lines = [l.strip() for l in raw.strip().split("\n") if l.strip()]
        for i in range(min(n, len(lines))):
            out[i] = lines[i]
    return out


# ── Public dispatcher ──────────────────────────────────────

ENGINES = {
    "google_free":  None,  # handled inline
    "google_cloud": _google_cloud,
    "deepl":        _deepl,
    "gemini":       _gemini,
    "openai":       _openai,
    "claude":       _claude,
}


def translate_texts(
    texts: list[str],
    target: str,
    source: str = "auto",
    engine: str = "google_free",
    api_key: str | None = None,
    model: str | None = None,
) -> list[str]:
    """Translate list of strings with chosen engine.

    Raises ValueError with user-facing Vietnamese messages on config errors.
    Empty strings in input are passed through (skip API call) for efficiency.
    """
    if not texts:
        return []

    # Filter empty inputs — skip API call for blanks
    non_empty_idx = [i for i, t in enumerate(texts) if t and t.strip()]
    if not non_empty_idx:
        return [""] * len(texts)

    sub = [texts[i] for i in non_empty_idx]

    if engine == "google_free":
        translated = google_free_batch(sub, target, source)
    else:
        fn = ENGINES.get(engine)
        if not fn:
            raise ValueError(f"Engine không hỗ trợ: {engine}")
        if not api_key:
            raise ValueError(f"Thiếu API key cho {engine}. Vào Cài đặt → AI & API keys để thêm.")
        try:
            if engine in ("gemini", "openai", "claude"):
                translated = fn(sub, target, source, api_key, model=model)
            else:
                translated = fn(sub, target, source, api_key)
        except httpx.RequestError as e:
            raise ValueError(f"Lỗi mạng khi gọi {engine}: {e}")
        except ValueError:
            raise
        except Exception as e:
            logger.exception("Engine %s failed", engine)
            raise ValueError(f"Lỗi {engine}: {e}")

    out = [""] * len(texts)
    for pos, v in zip(non_empty_idx, translated):
        out[pos] = v or ""
    return out
