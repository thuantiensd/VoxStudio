"""Audit log — ghi lại mọi action quan trọng cho admin trace."""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLog

logger = logging.getLogger(__name__)


async def log(
    db: AsyncSession,
    *,
    user_id: int | None = None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    """Ghi 1 audit entry. Không raise — lỗi log không được crash request."""
    try:
        entry = AuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata else None,
            ip=ip,
            user_agent=user_agent,
        )
        db.add(entry)
        await db.commit()
        return entry
    except Exception as e:
        logger.warning("audit.log failed [%s]: %s", action, e)
        try:
            await db.rollback()
        except Exception:
            pass
        return None  # type: ignore[return-value]
