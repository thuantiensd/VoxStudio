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
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from app.services.translate_svc import LANG_MAP, translate_batch as google_free_batch

logger = logging.getLogger(__name__)

# Retry cho transient errors (503 overload, 429 rate limit, 502/504 gateway)
RETRY_STATUSES = {429, 500, 502, 503, 504}
RETRY_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY = 1.5  # giây — 1.5, 3, 6

PROVIDER_DISPLAY = {
    "google_cloud": "Google Cloud",
    "deepl":        "DeepL",
    "gemini":       "Gemini",
    "openai":       "OpenAI",
    "claude":       "Claude",
}


def _friendly_error(engine: str, status: int, body: str) -> str:
    """Chuyển HTTP error từ provider thành message user-friendly (không leak raw)."""
    name = PROVIDER_DISPLAY.get(engine, engine)
    if status == 401 or status == 403:
        return f"API key cho {name} không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại trong Cài đặt."
    if status == 429:
        return f"Bạn đã vượt giới hạn của {name}. Vui lòng chờ vài phút rồi thử lại, hoặc đổi sang engine khác."
    if status == 402:
        return f"Tài khoản {name} đã hết quota hoặc credit. Vui lòng kiểm tra bên {name}."
    if status == 404:
        return f"Mô hình {name} đã thay đổi. Vui lòng cập nhật ứng dụng."
    if status in (500, 502, 503, 504):
        return f"Dịch vụ {name} tạm quá tải. Vui lòng thử lại sau ít phút, hoặc đổi sang engine khác (ví dụ Google miễn phí)."
    # 400 và các mã khác
    return f"{name} từ chối yêu cầu. Vui lòng thử lại hoặc đổi sang engine khác."


def _post_with_retry(engine: str, url: str, *, params=None, json_body=None, data=None,
                      headers=None) -> httpx.Response:
    """POST với retry exponential backoff cho transient errors."""
    last_resp = None
    with httpx.Client(timeout=TIMEOUT) as c:
        for attempt in range(RETRY_MAX_ATTEMPTS):
            try:
                if json_body is not None:
                    r = c.post(url, params=params, json=json_body, headers=headers)
                else:
                    r = c.post(url, params=params, data=data, headers=headers)
            except httpx.RequestError as e:
                # Network-level — retry nếu còn attempt
                if attempt < RETRY_MAX_ATTEMPTS - 1:
                    time.sleep(RETRY_BASE_DELAY * (2 ** attempt))
                    continue
                raise ValueError(
                    f"Không kết nối được dịch vụ {PROVIDER_DISPLAY.get(engine, engine)}. "
                    f"Kiểm tra kết nối mạng và thử lại."
                )
            last_resp = r
            if r.status_code < 400:
                return r
            if r.status_code in RETRY_STATUSES and attempt < RETRY_MAX_ATTEMPTS - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning("[%s] %d — retry %d/%d sau %.1fs",
                               engine, r.status_code, attempt + 1, RETRY_MAX_ATTEMPTS, delay)
                time.sleep(delay)
                continue
            # Non-retryable hoặc hết attempts
            break
    # Fail — tạo message user-friendly, raw body chỉ log
    status = last_resp.status_code if last_resp is not None else 0
    raw = last_resp.text[:500] if last_resp is not None else ""
    logger.error("[%s] final failure %d: %s", engine, status, raw)
    raise ValueError(_friendly_error(engine, status, raw))

# Default model mỗi engine — có thể override qua body request nếu cần.
# Gemini 1.5 đã bị Google retire (04/2025). Dùng 2.5-flash (fast + free tier).
DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "claude": "claude-3-5-haiku-20241022",
    "gemini": "gemini-2.5-flash",
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
    api_key = _sanitize_api_key(api_key, "Google Cloud Translate")
    url = "https://translation.googleapis.com/language/translate/v2"
    params = {"key": api_key}
    data = {"target": _lang_code(target), "format": "text", "q": texts}
    if source and source.lower() != "auto":
        data["source"] = _lang_code(source)
    r = _post_with_retry("google_cloud", url, params=params, data=data)
    body = r.json()
    return [t.get("translatedText", "") for t in body["data"]["translations"]]


# ── DeepL ──────────────────────────────────────────────────

def _deepl(texts: list[str], target: str, source: str, api_key: str) -> list[str]:
    api_key = _sanitize_api_key(api_key, "DeepL")
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
    r = _post_with_retry("deepl", f"{base}/v2/translate",
                          data=data, headers=headers)
    return [item.get("text", "") for item in r.json().get("translations", [])]


# ── Gemini ─────────────────────────────────────────────────

def _gemini(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None,
            topic_hint: str | None = None,
            glossary_block: str | None = None) -> list[str]:
    model = model or DEFAULT_MODELS["gemini"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    tgt_name = _lang_display(target)
    src_name = _lang_display(source) if source and source.lower() != "auto" else "auto-detected source"
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    extras = []
    if topic_hint: extras.append(topic_hint)
    if glossary_block: extras.append(glossary_block)
    extra_block = ("\n\n" + "\n\n".join(extras)) if extras else ""
    prompt = (
        f"Translate the following numbered lines from {src_name} into {tgt_name}. "
        f"Preserve the exact number of lines and numbering. Output ONLY the translated "
        f"lines in format 'N. <translated>' — no explanations, no code fences."
        f"{extra_block}\n\n{numbered}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2},
    }
    r = _post_with_retry("gemini", url, params={"key": api_key},
                          json_body=payload,
                          headers={"Content-Type": "application/json"})
    body = r.json()
    try:
        raw = body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        logger.error("Gemini response malformed: %s", body)
        raise ValueError("Gemini trả về dữ liệu không đúng định dạng. Vui lòng thử lại.")
    return _parse_numbered(raw, len(texts))


# ── OpenAI ─────────────────────────────────────────────────

def _sanitize_api_key(api_key: str, provider: str) -> str:
    """Strip whitespace/zero-width/non-ASCII từ key. HTTP header bắt buộc
    ASCII — copy key từ web hay dính NBSP/smart-quote/zero-width space →
    httpx/requests fail với 'ascii codec can't encode' (xảy ra trong code
    cũ). Strip rồi check trước khi gửi để fail fast với message rõ ràng.
    """
    if not api_key:
        raise ValueError(f"Thiếu API key cho {provider}")
    cleaned = api_key.strip()
    # Loại zero-width / NBSP / control chars
    cleaned = "".join(c for c in cleaned if c.isprintable() and ord(c) >= 0x21)
    try:
        cleaned.encode("ascii")
    except UnicodeEncodeError:
        raise ValueError(
            f"API key {provider} chứa ký tự không hợp lệ (non-ASCII). "
            f"Hãy copy lại key từ dashboard chính thức.",
        )
    if len(cleaned) < 8:
        raise ValueError(f"API key {provider} quá ngắn — có thể sai")
    return cleaned


def _openai(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None,
            topic_hint: str | None = None,
            glossary_block: str | None = None,
            segments_meta: list[dict] | None = None,
            speaker_genders: dict | None = None,
            film_genre: str | None = None) -> list[str]:
    """OpenAI translate với unified prompt CÙNG chất lượng Gemini.

    Trước đây OpenAI dùng prompt 1-dòng minimal → user chat trực tiếp
    cho output tốt nhưng pipeline thì kém. Fix: dùng cùng prompt builder
    với genre + pronoun matrix + budget + anchor entities.
    """
    api_key = _sanitize_api_key(api_key, "OpenAI")
    model = model or DEFAULT_MODELS["openai"]

    # Convert texts → segment dicts cho unified prompt builder
    if not segments_meta:
        # Fallback nếu caller không truyền meta — generate từ texts
        segments_meta = [
            {"index": i, "start": float(i * 3), "end": float((i + 1) * 3),
             "original_text": t}
            for i, t in enumerate(texts)
        ]

    from app.services.llm.prompts import (
        build_translation_prompt,
        parse_translation_response,
    )
    prompt = build_translation_prompt(
        segments=segments_meta,
        target_lang=target,
        source_lang=source,
        topic_hint=topic_hint,
        glossary_block=glossary_block,
        speaker_genders=speaker_genders,
        film_genre=film_genre,
        engine="openai",
    )

    payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt["system"]},
            {"role": "user", "content": prompt["user"]},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    r = _post_with_retry("openai", "https://api.openai.com/v1/chat/completions",
                          json_body=payload, headers=headers)
    try:
        raw = r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise ValueError("OpenAI trả về dữ liệu không đúng định dạng. Vui lòng thử lại.")

    # Parse với unified parser (handle markdown fence, partial JSON, ...)
    parsed = parse_translation_response(raw, len(texts))
    out = [item["translated_text"] for item in parsed]
    if not any(out):
        # Last-resort fallback
        out = _parse_numbered(raw, len(texts))
    return out


# ── Anthropic Claude ───────────────────────────────────────

def _claude(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None,
            topic_hint: str | None = None,
            glossary_block: str | None = None,
            segments_meta: list[dict] | None = None,
            speaker_genders: dict | None = None,
            film_genre: str | None = None) -> list[str]:
    """Claude translate với unified prompt + JSON output (Claude follow OK)."""
    api_key = _sanitize_api_key(api_key, "Claude")
    model = model or DEFAULT_MODELS["claude"]
    if not segments_meta:
        segments_meta = [
            {"index": i, "start": float(i * 3), "end": float((i + 1) * 3),
             "original_text": t}
            for i, t in enumerate(texts)
        ]
    from app.services.llm.prompts import (
        build_translation_prompt,
        parse_translation_response,
    )
    prompt = build_translation_prompt(
        segments=segments_meta,
        target_lang=target,
        source_lang=source,
        topic_hint=topic_hint,
        glossary_block=glossary_block,
        speaker_genders=speaker_genders,
        film_genre=film_genre,
        engine="claude",
    )
    payload = {
        "model": model,
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
    r = _post_with_retry("claude", "https://api.anthropic.com/v1/messages",
                          json_body=payload, headers=headers)
    try:
        raw = r.json()["content"][0]["text"]
    except (KeyError, IndexError):
        raise ValueError("Claude trả về dữ liệu không đúng định dạng. Vui lòng thử lại.")
    parsed = parse_translation_response(raw, len(texts))
    out = [item["translated_text"] for item in parsed]
    if not any(out):
        out = _parse_numbered(raw, len(texts))
    return out


def _claude_old_unused(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None,
            topic_hint: str | None = None,
            glossary_block: str | None = None) -> list[str]:
    """DEPRECATED — kept for reference."""
    model = model or DEFAULT_MODELS["claude"]
    tgt_name = _lang_display(target)
    src_name = _lang_display(source) if source and source.lower() != "auto" else "auto-detected source"
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    sys_extras = []
    if topic_hint: sys_extras.append(topic_hint)
    if glossary_block: sys_extras.append(glossary_block)
    extra_block = ("\n\n" + "\n\n".join(sys_extras)) if sys_extras else ""
    system = (
        f"You are a precise {tgt_name} translator. Translate numbered {src_name} lines "
        f"into natural, idiomatic {tgt_name}. Output ONLY the translated lines in format "
        f"'N. <text>'. No preamble."
        f"{extra_block}"
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
    r = _post_with_retry("claude", "https://api.anthropic.com/v1/messages",
                          json_body=payload, headers=headers)
    try:
        raw = r.json()["content"][0]["text"]
    except (KeyError, IndexError):
        raise ValueError("Claude trả về dữ liệu không đúng định dạng. Vui lòng thử lại.")
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
    topic_hint: str | None = None,
    glossary: list[tuple[str, str]] | None = None,
    segments_meta: list[dict] | None = None,
    speaker_genders: dict | None = None,
    film_genre: str | None = None,
) -> list[str]:
    """Translate list of strings with chosen engine.

    NEW params (S+timestamp): segments_meta, speaker_genders, film_genre →
    forward vào LLM prompt để mọi engine có cùng quality (genre awareness,
    pronoun matrix, budget chars). Trước đây chỉ Gemini có rich prompt,
    OpenAI/Claude dùng minimal → chất lượng kém.

    topic_hint, glossary: cải thiện chất lượng dịch.
      · LLM engines (gemini/openai/claude): inject vào prompt
      · Non-LLM (google_free/google_cloud/deepl): post-process glossary
    """
    if not texts:
        return []

    non_empty_idx = [i for i, t in enumerate(texts) if t and t.strip()]
    if not non_empty_idx:
        return [""] * len(texts)

    sub = [texts[i] for i in non_empty_idx]
    # Lấy meta tương ứng với non-empty
    sub_meta = None
    if segments_meta:
        sub_meta = [segments_meta[i] for i in non_empty_idx if i < len(segments_meta)]

    from app.services import glossary_svc
    glossary = glossary or []
    glossary_block = glossary_svc.format_for_prompt(glossary) if glossary else ""
    topic_block = glossary_svc.format_topic_hint_for_prompt(topic_hint) if topic_hint else ""

    if engine == "google_free":
        translated = google_free_batch(sub, target, source)
    else:
        fn = ENGINES.get(engine)
        if not fn:
            raise ValueError(f"Engine không hỗ trợ: {engine}")
        if not api_key:
            raise ValueError(f"Thiếu API key cho {engine}. Vào Cài đặt → AI & API keys để thêm.")
        try:
            if engine in ("openai", "claude"):
                # Mới: pass full meta để builder dùng unified rich prompt
                translated = fn(sub, target, source, api_key, model=model,
                                topic_hint=topic_block or None,
                                glossary_block=glossary_block or None,
                                segments_meta=sub_meta,
                                speaker_genders=speaker_genders,
                                film_genre=film_genre)
            elif engine == "gemini":
                # Gemini path cũ giữ tương thích — đã có rich prompt riêng
                translated = fn(sub, target, source, api_key, model=model,
                                topic_hint=topic_block or None,
                                glossary_block=glossary_block or None)
            else:
                translated = fn(sub, target, source, api_key)
        except httpx.RequestError:
            raise ValueError(
                f"Không kết nối được dịch vụ {PROVIDER_DISPLAY.get(engine, engine)}. "
                f"Kiểm tra kết nối mạng và thử lại."
            )
        except ValueError:
            raise
        except Exception:
            logger.exception("Engine %s failed", engine)
            raise ValueError(
                f"Dịch vụ {PROVIDER_DISPLAY.get(engine, engine)} đang gặp sự cố. "
                f"Vui lòng thử lại hoặc đổi sang engine khác."
            )

    # Post-process glossary cho NON-LLM engines (LLM đã tự áp dụng qua prompt)
    if glossary and engine in ("google_free", "google_cloud", "deepl"):
        translated = glossary_svc.apply_post_process(translated, glossary, sources=sub)

    out = [""] * len(texts)
    for pos, v in zip(non_empty_idx, translated):
        out[pos] = v or ""
    return out
