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
    process_fn: Callable[[int, list], T],
    max_concurrent: int | None = None,
) -> list[T]:
    """Chia `items` thành batches, chạy song song qua `process_fn`.

    Args:
      items: list cần chia.
      batch_size: kích thước mỗi batch.
      engine: tên engine (gemini/openai/claude) để pick concurrency limit.
      process_fn: callable(batch_idx, batch_items) → result. CHẠY TRONG THREAD.
      max_concurrent: override default per-engine concurrency.

    Returns: list[T] song song với batches (theo thứ tự gốc).
    """
    if not items:
        return []

    batches = []
    for start in range(0, len(items), batch_size):
        batches.append((len(batches), items[start:start + batch_size]))

    n_concurrent = max_concurrent or CONCURRENT_BATCHES.get(engine, 3)
    n_concurrent = max(1, min(n_concurrent, len(batches)))

    logger.info(
        "Parallel translate: %d batches × %d items, concurrency=%d (engine=%s)",
        len(batches), batch_size, n_concurrent, engine,
    )

    results: list[T | None] = [None] * len(batches)
    errors: list[tuple[int, Exception]] = []

    with ThreadPoolExecutor(max_workers=n_concurrent) as pool:
        future_to_idx = {
            pool.submit(process_fn, idx, batch): idx
            for idx, batch in batches
        }
        for fut in as_completed(future_to_idx):
            idx = future_to_idx[fut]
            try:
                results[idx] = fut.result()
                logger.info("  batch %d/%d done", idx + 1, len(batches))
            except Exception as e:
                logger.error("  batch %d/%d FAILED: %s", idx + 1, len(batches), e)
                errors.append((idx, e))

    if errors:
        # Nếu >50% fail → raise. Còn lại → log warning và trả partial.
        if len(errors) > len(batches) // 2:
            raise RuntimeError(
                f"Translate fail: {len(errors)}/{len(batches)} batches lỗi. "
                f"Sample: {errors[0][1]}"
            )
        logger.warning(
            "Translate partial: %d/%d batches lỗi, vẫn dùng kết quả còn lại",
            len(errors), len(batches),
        )

    return [r for r in results if r is not None]  # type: ignore[return-value]
