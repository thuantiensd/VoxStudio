"""SQLAlchemy models cho auth + app state."""

from datetime import datetime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, DateTime, Text


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id:            Mapped[int]   = mapped_column(primary_key=True)
    email:         Mapped[str]   = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Nullable — user đăng nhập qua Google không cần password.
    name:          Mapped[str]   = mapped_column(String(120))
    avatar_url:    Mapped[str | None] = mapped_column(Text, nullable=True)
    google_id:     Mapped[str | None] = mapped_column(String(64), unique=True,
                                                       index=True, nullable=True)
    plan:          Mapped[str]   = mapped_column(String(16), default="free")
    created_at:    Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def public_dict(self):
        """Serialize an ra FE — không leak password_hash."""
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "avatar": self.avatar_url,
            "plan": self.plan,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
