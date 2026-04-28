"""DB session setup — support cả SQLite (local dev) và Postgres (production).

Quyết định backend qua env:
  DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname  → Postgres
  (không set)                                                    → SQLite local
"""

import os
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from .models import Base

# File DB lưu cùng dubbing_projects dir để tiện backup (chỉ dùng nếu fallback SQLite)
_SERVER_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = os.environ.get("VOX_DB_PATH") or str(_SERVER_ROOT / "voxstudio.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if DATABASE_URL:
    # Production: Postgres remote (VPS shared between API + GPU pod)
    # pool_pre_ping: ping connection trước query để auto-reconnect khi DB bị reset
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        future=True,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )
else:
    # Local dev: SQLite file
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{DB_PATH}",
        echo=False,
        future=True,
    )

AsyncSessionLocal = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)


async def init_db():
    """Tạo tables nếu chưa có. Gọi ở app startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    """FastAPI dependency — yield 1 session/request."""
    async with AsyncSessionLocal() as session:
        yield session
