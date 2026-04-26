"""USD → VND exchange rate fetcher with 24h cache.

Source ưu tiên: api.exchangerate.host (free, no key, mỏng nhưng ổn).
Fallback: open.er-api.com (free, no key, có rate limit thấp).
Final fallback: hardcoded FALLBACK_USD_VND (cập nhật khi giá lệch nhiều).

Sử dụng:
    from app.services import fx_rate_svc
    rate = fx_rate_svc.get_usd_to_vnd()    # float, vd 26000.0
    vnd = fx_rate_svc.usd_cents_to_vnd(2000)  # $20 → 520_000

Thread-safe (lock + atomic dict swap). Không async vì gọi từ to_dict()
sync. Network call chỉ chạy mỗi 24h.
"""
from __future__ import annotations

import logging
import threading
import time

import httpx

logger = logging.getLogger(__name__)

# Hardcoded fallback — cập nhật theo tỷ giá thị trường VN khi đợt sau.
FALLBACK_USD_VND = 26_000.0
CACHE_TTL_SEC = 24 * 3600  # 24 giờ

_lock = threading.Lock()
_cache = {"rate": FALLBACK_USD_VND, "ts": 0.0, "source": "fallback"}


def _fetch_from_exchangerate_host() -> float | None:
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get("https://api.exchangerate.host/latest",
                      params={"base": "USD", "symbols": "VND"})
            if r.status_code != 200:
                return None
            data = r.json()
            rate = float(data.get("rates", {}).get("VND", 0))
            if rate > 1000:  # sanity check (USD-VND luôn > 20000)
                return rate
    except Exception as e:
        logger.debug("exchangerate.host failed: %s", e)
    return None


def _fetch_from_er_api() -> float | None:
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get("https://open.er-api.com/v6/latest/USD")
            if r.status_code != 200:
                return None
            data = r.json()
            rate = float(data.get("rates", {}).get("VND", 0))
            if rate > 1000:
                return rate
    except Exception as e:
        logger.debug("er-api failed: %s", e)
    return None


def _refresh_if_stale():
    """Re-fetch nếu cache > TTL. Lock để tránh nhiều thread cùng fetch."""
    now = time.time()
    if now - _cache["ts"] < CACHE_TTL_SEC:
        return
    with _lock:
        # Re-check sau lock (double-checked locking)
        if now - _cache["ts"] < CACHE_TTL_SEC:
            return
        rate = _fetch_from_exchangerate_host()
        source = "exchangerate.host"
        if rate is None:
            rate = _fetch_from_er_api()
            source = "er-api"
        if rate is None:
            # Cả 2 source fail → giữ rate cũ (hoặc fallback) + lùi ts để
            # thử lại sau 1h chứ không phải 24h
            _cache["ts"] = now - (CACHE_TTL_SEC - 3600)
            logger.warning("All FX sources failed, keeping rate=%.0f (source=%s)",
                           _cache["rate"], _cache["source"])
            return
        _cache["rate"] = rate
        _cache["ts"] = now
        _cache["source"] = source
        logger.info("FX rate refreshed: 1 USD = %.0f VND (source=%s)",
                    rate, source)


def get_usd_to_vnd() -> float:
    """Lấy tỷ giá hiện tại. Refresh nếu cache cũ. Luôn trả số > 0."""
    try:
        _refresh_if_stale()
    except Exception as e:
        logger.warning("FX refresh error: %s", e)
    return float(_cache["rate"]) or FALLBACK_USD_VND


def usd_cents_to_vnd(cents: int) -> int:
    """Convert USD cents → VND tròn 1000 đồng (làm tròn lên).

    Ví dụ: $20 (2000 cents) × 26000 = 520_000.
    Tỷ giá thay đổi → số VND thay đổi mỗi lần fetch (sau 24h).
    """
    if not cents:
        return 0
    rate = get_usd_to_vnd()
    vnd = (cents / 100.0) * rate
    # Round up to nearest 1000 đồng cho dễ nhìn
    return int(((vnd + 999) // 1000) * 1000)


def current_rate_info() -> dict:
    """Để admin/debug thấy state hiện tại."""
    return {
        "rate": _cache["rate"],
        "source": _cache["source"],
        "fetched_ago_sec": int(time.time() - _cache["ts"]) if _cache["ts"] else None,
        "cache_ttl_sec": CACHE_TTL_SEC,
    }
