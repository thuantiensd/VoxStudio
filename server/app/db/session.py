"""DB session setup — SQLite async với SQLAlchemy 2.0."""

import os
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from .models import Base

# File DB lưu cùng dubbing_projects dir để tiện backup
_SERVER_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = os.environ.get("VOX_DB_PATH") or str(_SERVER_ROOT / "voxstudio.db")

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
