"""DB-backed dubbing project ownership + lifecycle.

Tách khỏi dubbing_svc.py (xử lý pipeline). Module này chỉ lo:
  - CRUD bảng dubbing_projects
  - Authorization (ownership check, admin bypass)
  - Soft delete + cleanup orphan files
  - Per-user list / counts / quota enforcement

dubbing_svc.py vẫn giữ filesystem flat tại dubbing_projects/<project_id>/...
Ownership do DB quyết — endpoint phải gọi check_owner() trước mọi thao tác.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DubbingProject, User

logger = logging.getLogger(__name__)


# ── Lifecycle ────────────────────────────────────────────────

async def create(
    db: AsyncSession,
    *,
    project_id: str,
    user_id: int,
    title: str = "",
    video_filename: str = "",
    duration_sec: float = 0.0,
    file_size_bytes: int = 0,
    source_language: str = "auto",
    target_language: str = "vietnamese",
) -> DubbingProject:
    """Tạo DB row đại diện ownership cho project. Filesystem files đã được
    dubbing_svc.create_project() ghi sẵn — gọi hàm này NGAY SAU."""
    p = DubbingProject(
        id=project_id,
        user_id=user_id,
        title=title or video_filename or project_id,
        video_filename=video_filename,
        duration_sec=duration_sec,
        file_size_bytes=file_size_bytes,
        source_language=source_language,
        target_language=target_language,
        status="created",
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    logger.info("DubbingProject row created: id=%s user=%d", project_id, user_id)
    return p


async def get(db: AsyncSession, project_id: str) -> DubbingProject | None:
    """Lookup project bất kể owner. KHÔNG dùng trực tiếp ở route — hãy dùng
    require_owned() để vừa lookup vừa check ownership."""
    return await db.get(DubbingProject, project_id)


async def require_owned(
    db: AsyncSession,
    project_id: str,
    user: User,
    *,
    include_deleted: bool = False,
) -> DubbingProject:
    """Lookup + raise 403/404 nếu không phải owner. Admin được bypass.

    Trả về row nếu OK. Đây là gate chính cho mọi mutation/access.
    """
    p = await db.get(DubbingProject, project_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if p.deleted_at is not None and not include_deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    is_admin = user.role == "admin"
    if p.user_id != user.id and not is_admin:
        # Không phân biệt 403 vs 404 để tránh enumerate project_id của user khác.
        # (Security best practice: trả 404 thay vì 403 khi không phải owner.)
        raise HTTPException(status_code=404, detail="Project not found")
    return p


async def list_for_user(
    db: AsyncSession,
    user: User,
    *,
    limit: int = 100,
    offset: int = 0,
    include_deleted: bool = False,
) -> list[DubbingProject]:
    """List projects của user (paginated). Admin có thể truyền user_id qua
    endpoint khác để xem global — hàm này chỉ cho user thường."""
    q = select(DubbingProject).where(DubbingProject.user_id == user.id)
    if not include_deleted:
        q = q.where(DubbingProject.deleted_at.is_(None))
    q = q.order_by(DubbingProject.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    return list(result.scalars().all())


async def count_for_user(
    db: AsyncSession,
    user_id: int,
    *,
    include_deleted: bool = False,
) -> int:
    """Đếm số project active của user — phục vụ quota check."""
    q = select(func.count(DubbingProject.id)).where(DubbingProject.user_id == user_id)
    if not include_deleted:
        q = q.where(DubbingProject.deleted_at.is_(None))
    result = await db.execute(q)
    return int(result.scalar() or 0)


async def update_status(
    db: AsyncSession,
    project_id: str,
    status_value: str,
    error: str | None = None,
):
    """Cập nhật trạng thái pipeline. Gọi từ worker khi pipeline tiến triển."""
    p = await db.get(DubbingProject, project_id)
    if p is None:
        return
    p.status = status_value
    if error is not None:
        p.error = error
    p.updated_at = datetime.utcnow()
    await db.commit()


async def soft_delete(
    db: AsyncSession,
    project: DubbingProject,
):
    """Mark deleted (giữ data 30 ngày). File trên disk chưa xoá — cleanup task
    chạy nightly sẽ xoá folder cho project có deleted_at < now() - 30d."""
    project.deleted_at = datetime.utcnow()
    await db.commit()
    logger.info("DubbingProject soft-deleted: id=%s user=%d",
                project.id, project.user_id)


async def list_purgeable(
    db: AsyncSession,
    days: int = 30,
) -> Sequence[DubbingProject]:
    """List projects soft-deleted > N days → cleanup task xoá file + DB row."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    q = select(DubbingProject).where(
        and_(
            DubbingProject.deleted_at.is_not(None),
            DubbingProject.deleted_at < cutoff,
        )
    )
    result = await db.execute(q)
    return list(result.scalars().all())


async def hard_delete(db: AsyncSession, project: DubbingProject):
    """Xoá hẳn DB row (file disk phải xoá riêng bằng dubbing_svc)."""
    await db.delete(project)
    await db.commit()
