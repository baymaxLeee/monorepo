"""Durable cross-service Asset Claim intent."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class AssetClaimIntentRow(Base):
    __tablename__ = "asset_claim_intents"

    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    slot: Mapped[str] = mapped_column(String(128), primary_key=True)
    asset_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    revision_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=False), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    desired_state: Mapped[str] = mapped_column(String(20), nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state_version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
