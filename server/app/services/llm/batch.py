"""Parallel batch executor cho translate pipeline.

Mục đích: chạy nhiều LLM batch CONCURRENTLY (thread pool) để giảm thời gian
xử lý phim dài. ThreadPoolExecutor an toàn cho I/O-bound LLM calls.

Concurrency limits theo engine tier — tránh rate limit:
- Gemini Free: 15 RPM → max 2 concurrent
- Gemini Tier 1: 60 RPM → 4 concurrent OK
- OpenAI Tier 1: 500 RPM → 6-8 concurrent safe
- Claude Tier 1: 50 RPM → 4 concurrent

Adaptive batch size: prompt overhead ~2k chars cố định. Batch lớn hơn =
tỷ lệ overhead thấp hơn. Nhưng quá lớn → vượt context window/timeout.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

# Số batch concurrent theo engine. Default conservative để safe với free tier.
# User Pro có thể tăng qua env var sau.
CONCURRENT_BATCHES = {
    "gemini": 3,    # Conservative — free tier 15 RPM
    "openai": 6,    # Tier 1 (500 RPM) — plenty headroom
    "claude": 4,    # Tier 1 (50 RPM)
}


def adaptive_batch_size(n_segments: int) -> int:
    """Pick batch size tối ưu theo tổng segment count.

    Logic: prompt overhead ~2k chars cố định → batch nhỏ tốn nhiều API call;
    batch quá to → timeout/context limit. Đây là điểm sweet-spot empirical.
    """
    if n_segments < 100:
        return n_segments  # 1 batch
    if n_segments < 250:
        return 35
    if n_segments < 600:
        return 25
    if n_segments < 1200:
        return 20
    return 15  # very long film — tránh prompt quá to


T = TypeVar("T")


def run_parallel_batches(
    *,
    items: list,
    batch_size: int,
    engine: str,
    process_fn: Callable[[int, list], list],
    max_concurrent: int | None = None,
) -> list:
    """Parallel map theo batch. `process_fn(batch_idx, batch)` → list cùng
    length với batch (1 result per input item).

    Returns: flat list, length = len(items), aligned theo thứ tự gốc.
    Failed batch → các item của batch đó là None trong output.
    """
    if not items:
        return []

    batches = []
    for start in range(0, len(items), batch_size):
        batches.append((len(batches), start, items[start:start + batch_size]))

    n_concurrent = max_concurrent or CONCURRENT_BATCHES.get(engine, 3)
    n_concurrent = max(1, min(n_concurrent, len(batches)))

    logger.info(
        "Parallel translate: %d batches × %d items, concurrency=%d (engine=%s)",
        len(batches), batch_size, n_concurrent, engine,
    )

    results: list = [None] * len(items)
    errors: list[tuple[int, Exception]] = []

    with ThreadPoolExecutor(max_workers=n_concurrent) as pool:
        future_to_meta = {
            pool.submit(process_fn, idx, batch): (idx, start)
            for idx, start, batch in batches
        }
        for fut in as_completed(future_to_meta):
            idx, start = future_to_meta[fut]
            try:
                batch_result = fut.result()
                if not isinstance(batch_result, list):
                    raise TypeError(f"process_fn phải trả list, got {type(batch_result)}")
                # Fill kết quả vào đúng vị trí theo start offset
                for i, r in enumerate(batch_result):
                    if start + i < len(items):
                        results[start + i] = r
                logger.info("  batch %d/%d done", idx + 1, len(batches))
            except Exception as e:
                logger.error("  batch %d/%d FAILED: %s", idx + 1, len(batches), e)
                errors.append((idx, e))

    if errors:
        if len(errors) > len(batches) // 2:
            raise RuntimeError(
                f"Translate fail: {len(errors)}/{len(batches)} batches lỗi. "
                f"Sample: {errors[0][1]}"
            )
        logger.warning(
            "Translate partial: %d/%d batches lỗi, vẫn dùng kết quả còn lại",
            len(errors), len(batches),
        )

    return results
