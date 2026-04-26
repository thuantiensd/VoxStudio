"""SQLAlchemy models cho auth + app state + admin foundation + job queue."""

from datetime import datetime
import uuid

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import (
    String, DateTime, Text, Integer, Float, Boolean, ForeignKey, Index,
)


class Base(DeclarativeBase):
    pass


# ── User ───────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id:            Mapped[int]   = mapped_column(primary_key=True)
    email:         Mapped[str]   = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name:          Mapped[str]   = mapped_column(String(120))
    avatar_url:    Mapped[str | None] = mapped_column(Text, nullable=True)
    google_id:     Mapped[str | None] = mapped_column(String(64), unique=True,
                                                       index=True, nullable=True)
    plan:          Mapped[str]   = mapped_column(String(16), default="free")

    # Admin / moderation
    role:            Mapped[str]  = mapped_column(String(16), default="user", index=True)
    is_banned:       Mapped[bool] = mapped_column(Boolean, default=False)
    last_active_at:  Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Email verification
    email_verified:  Mapped[bool] = mapped_column(Boolean, default=False)
    verify_token:    Mapped[str | None] = mapped_column(String(64), nullable=True)
    verify_sent_at:  Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at:    Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    def public_dict(self):
        """Serialize an ra FE — không leak password_hash."""
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "avatar": self.avatar_url,
            "plan": self.plan,
            "role": self.role,
            "is_banned": self.is_banned,
            "email_verified": bool(self.email_verified),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ── Audit log ──────────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_log"

    id:           Mapped[int] = mapped_column(primary_key=True)
    user_id:      Mapped[int | None] = mapped_column(
                    ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    action:       Mapped[str] = mapped_column(String(64), index=True)
    target_type:  Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id:    Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Tên 'metadata' trùng SQLAlchemy internal — dùng _json suffix.
    ip:           Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent:   Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at:   Mapped[datetime] = mapped_column(
                    DateTime, default=datetime.utcnow, index=True)


Index("idx_audit_user_created", AuditLog.user_id, AuditLog.created_at.desc())


# ── Feature flags ──────────────────────────────────────────────
class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    name:             Mapped[str]  = mapped_column(String(64), primary_key=True)
    enabled:          Mapped[bool] = mapped_column(Boolean, default=False)
    rollout_percent:  Mapped[int]  = mapped_column(Integer, default=0)
    whitelist_user_ids: Mapped[str | None] = mapped_column(
                        Text, nullable=True)  # JSON array '[42, 7]'
    description:      Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at:       Mapped[datetime] = mapped_column(
                        DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow)


# ── Plans (stub — admin edit được) ─────────────────────────────
class Plan(Base):
    __tablename__ = "plans"

    id:          Mapped[str]  = mapped_column(String(16), primary_key=True)
    # 'free' | 'pro' | 'studio'
    name:        Mapped[str]  = mapped_column(String(64))
    price_vnd:   Mapped[int]  = mapped_column(Integer, default=0)
    price_usd:   Mapped[int]  = mapped_column(Integer, default=0)
    # LTD (one-time) — 0 nếu không bán LTD cho plan này
    ltd_price_vnd: Mapped[int] = mapped_column(Integer, default=0)
    ltd_price_usd: Mapped[int] = mapped_column(Integer, default=0)
    ltd_slots_total:     Mapped[int] = mapped_column(Integer, default=0)
    ltd_slots_taken:     Mapped[int] = mapped_column(Integer, default=0)

    features_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    limits_json:   Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order:  Mapped[int]  = mapped_column(Integer, default=0)
    is_active:   Mapped[bool] = mapped_column(Boolean, default=True)


# ── Usage events ──────────────────────────────────────────────
class UsageEvent(Base):
    __tablename__ = "usage_events"

    id:         Mapped[int] = mapped_column(primary_key=True)
    user_id:    Mapped[int] = mapped_column(
                  ForeignKey("users.id", ondelete="CASCADE"), index=True)
    feature:    Mapped[str] = mapped_column(String(32), index=True)
    # 'dubbing' | 'stt' | 'tts' | 'translate' | 'clone' | 'separate'
    minutes:    Mapped[float] = mapped_column(Float, default=0.0)
    tokens:     Mapped[int]   = mapped_column(Integer, default=0)
    characters: Mapped[int]   = mapped_column(Integer, default=0)
    project_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
                  DateTime, default=datetime.utcnow, index=True)


Index("idx_usage_user_created", UsageEvent.user_id, UsageEvent.created_at.desc())


# ── Jobs queue ─────────────────────────────────────────────────
class Job(Base):
    __tablename__ = "jobs"

    id:           Mapped[str] = mapped_column(String(36), primary_key=True,
                                               default=lambda: str(uuid.uuid4()))
    user_id:      Mapped[int] = mapped_column(
                    ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind:         Mapped[str] = mapped_column(String(32), index=True)
    # 'dubbing' | 'stt' | 'tts' | 'clone' | 'separate'
    status:       Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # 'pending' | 'running' | 'done' | 'error' | 'canceled'
    priority:     Mapped[int] = mapped_column(Integer, default=0)
    # Cao hơn = ưu tiên trước. Plan-based: free=0, pro=10, studio=20
    payload:      Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON input
    progress:     Mapped[float] = mapped_column(Float, default=0.0)
    current_step: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result:       Mapped[str | None] = mapped_column(Text, nullable=True)
    error:        Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at:   Mapped[datetime] = mapped_column(
                    DateTime, default=datetime.utcnow, index=True)
    started_at:   Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at:  Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# Composite index cho picker query
Index("idx_jobs_picker",
      Job.status, Job.priority.desc(), Job.created_at.asc())


# ── Voice clones (per-user) ───────────────────────────────────
class Voice(Base):
    __tablename__ = "voices"

    id:         Mapped[str] = mapped_column(String(16), primary_key=True)
    user_id:    Mapped[int] = mapped_column(
                  ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name:       Mapped[str] = mapped_column(String(120))
    ref_text:   Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json:  Mapped[str | None] = mapped_column(Text, nullable=True)
    has_prompt: Mapped[bool] = mapped_column(Boolean, default=False)
    is_public:  Mapped[bool] = mapped_column(Boolean, default=False)
    # reserved cho feature "share giọng public" sau này

    # Consent — user xác nhận có quyền dùng giọng nói trong ref audio.
    # NULL = chưa attest (voice cũ trước migration). Ghi NOT NULL với value
    # = thời điểm user tick checkbox + IP + user agent.
    consent_at:    Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    consent_ip:    Mapped[str | None] = mapped_column(String(45), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
                  DateTime, default=datetime.utcnow, index=True)
