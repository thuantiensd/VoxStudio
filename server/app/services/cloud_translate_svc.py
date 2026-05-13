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


# Fatal status — KHÔNG retry, KHÔNG fallback. User-correctable error.
# Pipeline phải fail NGAY thay vì waste time chuyển engine khác.
FATAL_STATUSES = {401, 403, 402}  # auth, forbidden, payment required


class FatalAuthError(ValueError):
    """Key sai/hết hạn/quota → user phải fix, không fallback engine khác."""
    pass


# Thread-local cache cho LLM self-verify gender (Option A).
# LLM trả speaker_genders cuối JSON output → engines store ở đây → caller
# (dubbing_svc) đọc qua get_last_llm_genders() để override pipeline detect.
import threading as _threading
_llm_genders_lock = _threading.Lock()
_last_llm_genders: dict = {}


def _store_llm_genders(engine: str, genders: dict) -> None:
    """Engine functions gọi sau khi parse output → store gender LLM tự suy."""
    with _llm_genders_lock:
        _last_llm_genders[engine] = dict(genders or {})


def get_last_llm_genders(engine: str | None = None) -> dict:
    """Caller (dubbing_svc) đọc LLM-inferred gender sau translate.

    Args:
      engine: tên engine cụ thể, hoặc None → merge tất cả engines.
    Returns: {speaker_id: {"gender": str, "evidence": str}}
    """
    with _llm_genders_lock:
        if engine:
            return dict(_last_llm_genders.get(engine, {}))
        # Merge tất cả engines — engine cuối win nếu trùng speaker
        merged = {}
        for v in _last_llm_genders.values():
            merged.update(v)
        return merged


def clear_llm_genders() -> None:
    """Reset cache — gọi đầu mỗi project translate."""
    with _llm_genders_lock:
        _last_llm_genders.clear()


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
    msg = _friendly_error(engine, status, raw)
    # Fatal status (401/403/402) → raise FatalAuthError để dubbing_svc
    # KHÔNG fallback engine khác — user phải fix key trước.
    if status in FATAL_STATUSES:
        raise FatalAuthError(msg)
    raise ValueError(msg)

# Default model mỗi engine — flagship tier 2026 (bump 2026-05-13).
# Dịch phim cổ trang/drama cần instruction-following cực mạnh để tuân
# thủ FORBIDDEN list + name fidelity + register-aware. Flagship tier
# theo context dài + giữ rule xuyên suốt batch tốt hơn rõ rệt.
DEFAULT_MODELS = {
    "openai": "gpt-5",                # flagship OpenAI (T7/2025)
    "claude": "claude-opus-4-5",       # flagship Anthropic (T9/2025)
    "gemini": "gemini-2.5-pro",        # flagship Google
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


def _translate_3pass(engine: str, texts: list[str], target: str, source: str,
                       api_key: str, model: str | None,
                       topic_hint: str | None, glossary_block: str | None,
                       segments_meta: list[dict] | None,
                       film_genre: str | None,
                       visual_context: dict | None = None) -> list[str]:
    """3-pass translation cho OpenAI/Claude qua HTTP.

    Pass-0: analyze speakers (skip nếu 1 speaker; có visual_context = ground truth)
    Pass-1: literal translator
    Pass-2: editor polish
    """
    from app.services.llm import run_analyze, run_translate, run_edit
    from app.services.llm.prompts import _max_chars

    if not segments_meta:
        segments_meta = [
            {"index": i, "start": float(i * 3), "end": float((i + 1) * 3),
             "original_text": t}
            for i, t in enumerate(texts)
        ]

    # Pass-0: speaker analysis + auto-detect genre.
    # entity_registry (từ Python scan toàn file) inject vào Pass-0 prompt
    # làm name anchor — tránh LLM bỏ sót tên do sample bias.
    entity_registry = None
    try:
        # segments_meta là từ project["segments"] → có thể tìm registry trong meta
        if segments_meta and isinstance(segments_meta[0], dict):
            # Build mini project structure để call build_entity_registry
            from app.services.dubbing_svc import build_entity_registry
            mini_project = {"segments": segments_meta, "source_language": source}
            entity_registry = build_entity_registry(mini_project)
    except Exception as e:
        logger.debug("entity_registry build skipped: %s", e)

    relationships: dict = {}
    try:
        relationships = run_analyze(
            engine=engine, segments=segments_meta, source_lang=source,
            api_key=api_key, model=model, film_genre=film_genre,
            visual_context=visual_context,
            entity_registry=entity_registry,
        )
        # Backward-compat: extract gender → cache cho dubbing_svc đọc lại.
        # Store FULL info (character_name, age, role) để TTS routing + UI dùng.
        if relationships and relationships.get("speakers"):
            full_info = {
                spk_id: {
                    "gender": info.get("gender", "unsure"),
                    "evidence": info.get("evidence", ""),
                    "character_name": info.get("character_name", ""),
                    "age": info.get("age", "adult"),
                    "role": info.get("role", ""),
                }
                for spk_id, info in relationships["speakers"].items()
            }
            _store_llm_genders(engine, full_info)

        # Auto-detect genre từ Pass-0 — override film_genre nếu user pick
        # "auto" / "generic" và confidence >= 0.5.
        detected = (relationships.get("film_genre_primary") or "").strip()
        conf = float(relationships.get("genre_confidence") or 0.0)
        if detected and conf >= 0.5 and (not film_genre or film_genre in ("auto", "generic", "")):
            logger.info(
                "Genre auto-detected: %s (confidence=%.2f, signals=%s) — override user 'auto'",
                detected, conf, relationships.get("genre_signals", [])[:3],
            )
            film_genre = detected
        elif detected and conf < 0.5:
            logger.info(
                "Genre detected: %s (confidence=%.2f LOW) — keeping user pick=%s",
                detected, conf, film_genre or "auto",
            )
    except Exception as e:
        logger.warning("%s Pass-0 fail: %s", engine, e)

    # Pass-1 + Pass-2: ADAPTIVE BATCH + PARALLEL (phim dài)
    from app.services.llm.batch import adaptive_batch_size, run_parallel_batches
    batch_size = adaptive_batch_size(len(segments_meta))
    logger.info("%s: %d segments → adaptive batch_size=%d",
                 engine, len(segments_meta), batch_size)

    # Batch cache — phục vụ DUY NHẤT cho resume khi pipeline crash giữa chừng.
    # Scope: 1 thư mục riêng cho mỗi (corpus + LLM code version) → khi user
    # re-dub project khác / LLM prompt đổi → cache miss tự nhiên, không bị
    # ăn output cũ. Pipeline success → xoá toàn bộ scope ở cuối hàm.
    import hashlib as _hl, json as _json, tempfile as _tf, os as _os
    import shutil as _shutil

    # 1) Corpus fingerprint: hash toàn bộ source text của video này.
    #    Cùng video → cùng corpus_fp. Khác video → khác fp.
    _corpus_key = "\n".join(
        (s.get("original_text") or "").strip() for s in segments_meta
    )
    _corpus_fp = _hl.sha256(_corpus_key.encode("utf-8")).hexdigest()[:12]

    # 2) LLM code fingerprint: hash các file có ảnh hưởng output LLM.
    #    Thay đổi prompt / few-shot / runner → fp đổi → cache auto-invalidate.
    _llm_dir = _os.path.dirname(__file__) + "/llm"
    _code_h = _hl.sha256()
    for _fn in ("prompts.py", "few_shot_examples.py", "llm_runner.py"):
        try:
            with open(_os.path.join(_llm_dir, _fn), "rb") as _f:
                _code_h.update(_f.read())
        except FileNotFoundError:
            pass
    _code_fp = _code_h.hexdigest()[:8]

    _scope_dir = _os.path.join(
        _tf.gettempdir(), "voxstudio_batch_cache",
        f"{_corpus_fp}_{_code_fp}",
    )
    _os.makedirs(_scope_dir, exist_ok=True)
    logger.info("%s cache scope: %s/%s (corpus=%s, code=%s)",
                engine, _os.path.basename(_os.path.dirname(_scope_dir)),
                _os.path.basename(_scope_dir), _corpus_fp, _code_fp)

    def _batch_cache_path(batch: list[dict]) -> str:
        key = _json.dumps({
            "engine": engine,
            "model": model or "",
            "target": target,
            "source": source,
            "texts": [s.get("original_text", "") for s in batch],
        }, ensure_ascii=False, sort_keys=True)
        h = _hl.sha256(key.encode("utf-8")).hexdigest()[:16]
        return _os.path.join(_scope_dir, f"batch_{h}.json")

    def _validate_batch_output(result: list[str], batch: list[dict]) -> tuple[bool, str]:
        """Task 4: validate output. Trả (ok, reason).

        Pass nếu:
        - Length match batch
        - >= 70% có translation non-empty (cho phép vài line truly empty
          như interjection silent)
        - Không quá nhiều pinyin token (LLM dịch lười)
        """
        if not isinstance(result, list) or len(result) != len(batch):
            return False, f"length mismatch: got {len(result) if isinstance(result, list) else type(result)}, want {len(batch)}"
        non_empty = sum(1 for t in result if t and t.strip())
        if non_empty < max(1, int(len(batch) * 0.7)):
            return False, f"only {non_empty}/{len(batch)} non-empty (need >= 70%)"
        # Pinyin heuristic: đếm bigram pinyin (2 caps cạnh nhau)
        import re as _re_v
        pinyin_hits = 0
        for t in result:
            if not t:
                continue
            pinyin_hits += len(_re_v.findall(r"\b[A-Z][a-z]{1,7}\s+[A-Z][a-z]{1,7}\b", t))
        if pinyin_hits > len(batch) * 0.5:
            return False, f"too much pinyin ({pinyin_hits} bigrams in {len(batch)} lines)"
        return True, "ok"

    def _process_batch(batch_idx: int, batch: list[dict]) -> list[str]:
        """Return list[str] cùng length batch — translated text per seg.

        Task 2 v2: context_before = 10 lines trước (continuity).
        Task 5 v2: cache hit → skip LLM call.
        Task 4 v2: validation + retry up to 2 lần nếu output bad.
        """
        # Cache check
        cpath = _batch_cache_path(batch)
        try:
            if _os.path.exists(cpath):
                with open(cpath, "r", encoding="utf-8") as f:
                    cached = _json.load(f)
                if isinstance(cached, list) and len(cached) == len(batch):
                    logger.info("%s batch %d: cache HIT (%s) — skip LLM",
                                engine, batch_idx, _os.path.basename(cpath))
                    return cached
        except Exception as e:
            logger.debug("Cache read fail batch %d: %s", batch_idx, e)
        # Build context_before từ 10 line trước batch
        context_before = None
        if batch and batch_idx > 0:
            first_idx = batch[0].get("index", 0)
            ctx_segs = [
                s for s in segments_meta
                if first_idx - 10 <= s.get("index", -1) < first_idx
                and (s.get("original_text") or "").strip()
            ]
            if ctx_segs:
                context_before = [
                    {
                        "index": s["index"] + 1,
                        "original": (s.get("original_text") or "").strip(),
                        "translated": (s.get("translated_text") or "").strip() or "—",
                    }
                    for s in ctx_segs[-10:]
                ]

        literal = run_translate(
            engine=engine, segments=batch,
            target_lang=target, source_lang=source,
            speaker_relationships=relationships,
            context_before=context_before,
            topic_hint=topic_hint, glossary_block=glossary_block,
            film_genre=film_genre, api_key=api_key, model=model,
        )
        polished = list(literal)
        # Skip Editor pass cho flagship models — Pass-1 đã polish tốt sẵn,
        # Pass-2 có thể làm degrade do over-edit. Editor chỉ cần thiết
        # cho mini/cheap models.
        flagship_models = {
            "gpt-5", "gpt-5-mini",
            "claude-opus-4-5", "claude-opus-4-7", "claude-sonnet-4-6",
            "gemini-2.5-pro",
        }
        skip_editor = (model or "").lower() in flagship_models

        def _save_cache(result: list[str]) -> None:
            """Cache batch output. Only cache nếu ≥1 non-empty translation."""
            try:
                if any(t and t.strip() for t in result):
                    with open(cpath, "w", encoding="utf-8") as f:
                        _json.dump(result, f, ensure_ascii=False)
            except Exception as e:
                logger.debug("Cache write fail batch %d: %s", batch_idx, e)

        if skip_editor:
            # Task 3: flagship skip rewrite NHƯNG vẫn QA scan nhẹ bằng Python
            # (không thêm LLM call). Catch lỗi LLM hay slip:
            # - Dòng quá dài cho lồng tiếng (>2× max_chars)
            # - Còn chữ Trung gốc lọt vào output
            # - Tên cá biệt drift trong batch
            out = [p.get("translated_text", "") for p in literal]
            qa_issues: list[str] = []
            import re as _re_qa
            seen_names: dict[str, set] = {}
            for i, (t, seg) in enumerate(zip(out, batch)):
                if not t or not t.strip():
                    qa_issues.append(f"L{seg.get('index', i)}: empty")
                    continue
                # Quá dài: >2× max_chars cho lồng tiếng
                max_c = (seg.get("end", 0) - seg.get("start", 0)) * 15
                if max_c > 0 and len(t) > max_c * 2.0:
                    qa_issues.append(f"L{seg.get('index', i)}: too long ({len(t)} vs {int(max_c)})")
                # Chữ Trung lọt → undertranslated
                if _re_qa.search(r"[一-鿿]", t):
                    qa_issues.append(f"L{seg.get('index', i)}: contains Han chars")
                # Track tên xuất hiện để check drift
                for name_match in _re_qa.finditer(r"\b[A-ZĐ][a-zà-ỹ]+(?:\s+[A-ZĐ][a-zà-ỹ]+)+\b", t):
                    full = name_match.group(0)
                    seen_names.setdefault(full.split()[0], set()).add(full)
            # Name drift detection
            for first, variants in seen_names.items():
                if len(variants) > 1:
                    qa_issues.append(f"name drift: {first} → {list(variants)}")
            if qa_issues:
                logger.warning(
                    "%s batch %d QA scan: %d issues — %s",
                    engine, batch_idx, len(qa_issues), "; ".join(qa_issues[:5]),
                )
            else:
                logger.info("%s batch %d QA scan: clean (no issues)", engine, batch_idx)
            _save_cache(out)
            return out

        try:
            items = []
            for i, seg in enumerate(batch):
                lit_text = literal[i].get("translated_text", "") if i < len(literal) else ""
                items.append({
                    "index": seg["index"],
                    "speaker": seg.get("speaker"),
                    "original": seg["original_text"],
                    "literal": lit_text,
                    "max_chars": _max_chars(seg),
                })
            polished_raw = run_edit(
                engine=engine, items=items,
                target_lang=target, source_lang=source,
                speaker_relationships=relationships,
                film_genre=film_genre,
                api_key=api_key, model=model,
            )
            for i, p in enumerate(polished_raw):
                if p.get("translated_text"):
                    polished[i] = p
        except Exception as e:
            logger.warning("%s Pass-2 fail batch %d: %s — dùng literal", engine, batch_idx, e)
        out = [p.get("translated_text", "") for p in polished]
        _save_cache(out)
        return out

    def _process_batch_with_retry(batch_idx: int, batch: list[dict]) -> list[str]:
        """Task 4: retry batch up to 2 lần nếu validation fail.

        Cache hits → no retry needed (cache check trong _process_batch đã
        skip LLM khi có result cũ). Nếu LLM call mới ra output bad →
        retry. Sau 2 retry fail → giữ result tốt nhất (literal fallback).
        """
        last_result: list[str] = []
        for attempt in range(3):  # 1 try + 2 retry
            try:
                result = _process_batch(batch_idx, batch)
            except Exception as e:
                logger.warning("%s batch %d attempt %d crashed: %s",
                               engine, batch_idx, attempt + 1, e)
                if attempt == 2:
                    raise
                continue
            ok, reason = _validate_batch_output(result, batch)
            if ok:
                if attempt > 0:
                    logger.info("%s batch %d: validated OK at retry %d",
                                engine, batch_idx, attempt)
                return result
            logger.warning(
                "%s batch %d attempt %d validation fail: %s — retry",
                engine, batch_idx, attempt + 1, reason,
            )
            last_result = result
            # Xoá cache để retry không dùng kết quả bad
            try:
                cpath = _batch_cache_path(batch)
                if _os.path.exists(cpath):
                    _os.remove(cpath)
            except Exception:
                pass
        # Sau 2 retry vẫn fail → return result cuối cùng
        logger.error("%s batch %d: ALL 3 attempts failed validation — using last result",
                     engine, batch_idx)
        return last_result

    try:
        parallel = run_parallel_batches(
            items=segments_meta, batch_size=batch_size, engine=engine,
            process_fn=_process_batch_with_retry,
        )
    except Exception as e:
        # FAIL → giữ cache để retry resume nhanh.
        logger.error("%s parallel batch fail: %s — keeping cache for resume",
                     engine, e)
        raise ValueError(f"{engine} lỗi: {e}") from e

    # SUCCESS → cache hoàn thành sứ mệnh resume, xoá scope để lần dịch sau
    # cùng video chắc chắn gọi LLM tươi (user có thể đã đổi model / settings).
    try:
        _shutil.rmtree(_scope_dir, ignore_errors=True)
        logger.info("%s cache cleanup OK: %s", engine, _os.path.basename(_scope_dir))
    except Exception as e:
        logger.debug("%s cache cleanup skip: %s", engine, e)

    return [t or "" for t in parallel]


def _openai(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None,
            topic_hint: str | None = None,
            glossary_block: str | None = None,
            segments_meta: list[dict] | None = None,
            speaker_genders: dict | None = None,
            film_genre: str | None = None,
            visual_context: dict | None = None) -> list[str]:
    """OpenAI translate — 3-pass."""
    api_key = _sanitize_api_key(api_key, "OpenAI")
    model = model or DEFAULT_MODELS["openai"]
    return _translate_3pass("openai", texts, target, source, api_key, model,
                              topic_hint, glossary_block, segments_meta, film_genre,
                              visual_context)


def _claude(texts: list[str], target: str, source: str, api_key: str,
            model: str | None = None,
            topic_hint: str | None = None,
            glossary_block: str | None = None,
            segments_meta: list[dict] | None = None,
            speaker_genders: dict | None = None,
            film_genre: str | None = None,
            visual_context: dict | None = None) -> list[str]:
    """Claude translate — 3-pass."""
    api_key = _sanitize_api_key(api_key, "Claude")
    model = model or DEFAULT_MODELS["claude"]
    return _translate_3pass("claude", texts, target, source, api_key, model,
                              topic_hint, glossary_block, segments_meta, film_genre,
                              visual_context)


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
    visual_context: dict | None = None,
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
                                film_genre=film_genre,
                                visual_context=visual_context)
            elif engine == "gemini":
                # Gemini path cũ giữ tương thích — đã có rich prompt riêng
                translated = fn(sub, target, source, api_key, model=model,
                                topic_hint=topic_block or None,
                                glossary_block=glossary_block or None)
            else:
                translated = fn(sub, target, source, api_key)
        except httpx.RequestError as e:
            raise ValueError(
                f"Không kết nối được dịch vụ {PROVIDER_DISPLAY.get(engine, engine)} "
                f"({type(e).__name__}: {e}). Kiểm tra kết nối mạng và thử lại."
            )
        except ValueError:
            # ValueError là loại lỗi đã có message user-friendly (từ
            # _check_llm_http_response, FatalAuthError, run_parallel_batches…)
            # → giữ nguyên, không bọc lại.
            raise
        except Exception as e:
            # Lỗi không lường trước (KeyError JSON, JSONDecodeError, TimeoutError…)
            # → log full traceback + surface type+message lên user thay vì che
            # bằng generic "đang gặp sự cố" (khiến debug bất khả).
            logger.exception("Engine %s failed", engine)
            raise ValueError(
                f"{PROVIDER_DISPLAY.get(engine, engine)} lỗi không lường trước: "
                f"{type(e).__name__}: {e}. Xem log server để biết chi tiết."
            ) from e

    # Post-process glossary cho NON-LLM engines (LLM đã tự áp dụng qua prompt)
    if glossary and engine in ("google_free", "google_cloud", "deepl"):
        translated = glossary_svc.apply_post_process(translated, glossary, sources=sub)

    out = [""] * len(texts)
    for pos, v in zip(non_empty_idx, translated):
        out[pos] = v or ""
    return out
