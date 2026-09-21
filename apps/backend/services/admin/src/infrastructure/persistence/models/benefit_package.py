from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class BenefitPackageRow(Base):
    __tablename__ = "benefit_packages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(26), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(String(26), nullable=False, index=True)
    is_preset: Mapped[bool] = mapped_column(Boolean, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    project_name: Mapped[str] = mapped_column(String(128), nullable=False)
    asset_group_id: Mapped[str] = mapped_column(String(128), nullable=False)
    access_key_id_enc: Mapped[str] = mapped_column(Text, nullable=False)
    secret_access_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    model_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    material_used: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    material_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(String(26), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(26), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BenefitPackageModelRow(Base):
    __tablename__ = "benefit_package_models"
    __table_args__ = (
        UniqueConstraint("tenant_id", "workspace_id", "model_id", name="benefit_package_models_scope_model"),
    )

    package_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(26), nullable=False)
    workspace_id: Mapped[str] = mapped_column(String(26), nullable=False)
    model_id: Mapped[str] = mapped_column(String(128), primary_key=True)


class AssetGroupCleanupRow(Base):
    __tablename__ = "benefit_package_asset_group_cleanups"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(26), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(String(26), nullable=False, index=True)
    benefit_package_id: Mapped[str] = mapped_column(String(32), nullable=False)
    asset_group_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    project_name: Mapped[str] = mapped_column(String(128), nullable=False)
    access_key_id_enc: Mapped[str] = mapped_column(Text, nullable=False)
    secret_access_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    lease_token: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BenefitPackageReviewReservationRow(Base):
    __tablename__ = "benefit_package_review_reservations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(26), nullable=False, index=True)
    workspace_id: Mapped[str] = mapped_column(String(26), nullable=False, index=True)
    benefit_package_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    asset_id: Mapped[str] = mapped_column(String(36), nullable=False)
    operation_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="reserved")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BenefitPackageReviewCleanupClaimRow(Base):
    __tablename__ = "benefit_package_review_cleanup_claims"

    cleanup_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    reservation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
