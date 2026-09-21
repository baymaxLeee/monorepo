from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from infrastructure.persistence.models.benefit_package import (
    AssetGroupCleanupRow,
    BenefitPackageReviewCleanupClaimRow,
    BenefitPackageReviewReservationRow,
    BenefitPackageRow,
)


async def list_packages(session: AsyncSession, tenant_id: str, workspace_id: str) -> list[BenefitPackageRow]:
    rows = await session.scalars(
        select(BenefitPackageRow)
        .where(
            BenefitPackageRow.tenant_id == tenant_id,
            BenefitPackageRow.workspace_id == workspace_id,
            BenefitPackageRow.deleted_at.is_(None),
        )
        .order_by(BenefitPackageRow.is_preset.desc(), BenefitPackageRow.updated_at.desc())
    )
    return list(rows.all())


async def get_package(
    session: AsyncSession, package_id: str, tenant_id: str, workspace_id: str, *, for_update: bool = False
) -> BenefitPackageRow | None:
    statement = select(BenefitPackageRow).where(
        BenefitPackageRow.id == package_id,
        BenefitPackageRow.tenant_id == tenant_id,
        BenefitPackageRow.workspace_id == workspace_id,
        BenefitPackageRow.deleted_at.is_(None),
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = await session.scalars(statement)
    return row.one_or_none()


async def list_asset_group_cleanups(
    session: AsyncSession, tenant_id: str, workspace_id: str
) -> list[AssetGroupCleanupRow]:
    rows = await session.scalars(
        select(AssetGroupCleanupRow)
        .where(
            AssetGroupCleanupRow.tenant_id == tenant_id,
            AssetGroupCleanupRow.workspace_id == workspace_id,
        )
        .order_by(AssetGroupCleanupRow.updated_at.desc())
    )
    return list(rows.all())


async def get_asset_group_cleanup(
    session: AsyncSession, cleanup_id: str, tenant_id: str, workspace_id: str, *, for_update: bool = False
) -> AssetGroupCleanupRow | None:
    statement = select(AssetGroupCleanupRow).where(
        AssetGroupCleanupRow.id == cleanup_id,
        AssetGroupCleanupRow.tenant_id == tenant_id,
        AssetGroupCleanupRow.workspace_id == workspace_id,
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = await session.scalars(statement)
    return row.one_or_none()


async def review_usage(session: AsyncSession, tenant_id: str, workspace_id: str) -> dict[str, tuple[int, int]]:
    rows = await session.execute(
        select(
            BenefitPackageReviewReservationRow.benefit_package_id,
            func.count().filter(
                BenefitPackageReviewReservationRow.status.in_(("committed", "releasing", "reacquiring"))
            ),
            func.count().filter(BenefitPackageReviewReservationRow.status == "reserved"),
        )
        .where(
            BenefitPackageReviewReservationRow.tenant_id == tenant_id,
            BenefitPackageReviewReservationRow.workspace_id == workspace_id,
        )
        .group_by(BenefitPackageReviewReservationRow.benefit_package_id)
    )
    return {str(package_id): (int(committed), int(reserved)) for package_id, committed, reserved in rows}


async def get_review_reservation(
    session: AsyncSession, reservation_id: str, *, for_update: bool = False
) -> BenefitPackageReviewReservationRow | None:
    statement = select(BenefitPackageReviewReservationRow).where(
        BenefitPackageReviewReservationRow.id == reservation_id
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = await session.scalars(statement)
    return row.one_or_none()


async def get_review_reservation_by_operation(
    session: AsyncSession, operation_id: str, *, for_update: bool = False
) -> BenefitPackageReviewReservationRow | None:
    statement = select(BenefitPackageReviewReservationRow).where(
        BenefitPackageReviewReservationRow.operation_id == operation_id
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = await session.scalars(statement)
    return row.one_or_none()


async def get_active_review_reservation(
    session: AsyncSession, package_id: str, project_id: str, asset_id: str, *, for_update: bool = False
) -> BenefitPackageReviewReservationRow | None:
    statement = select(BenefitPackageReviewReservationRow).where(
        BenefitPackageReviewReservationRow.benefit_package_id == package_id,
        BenefitPackageReviewReservationRow.project_id == project_id,
        BenefitPackageReviewReservationRow.asset_id == asset_id,
        BenefitPackageReviewReservationRow.status.in_(("reserved", "committed", "releasing", "reacquiring")),
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = await session.scalars(statement)
    return row.one_or_none()


async def get_review_cleanup_claim(
    session: AsyncSession, cleanup_id: str, *, for_update: bool = False
) -> BenefitPackageReviewCleanupClaimRow | None:
    statement = select(BenefitPackageReviewCleanupClaimRow).where(
        BenefitPackageReviewCleanupClaimRow.cleanup_id == cleanup_id
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    row = await session.scalars(statement)
    return row.one_or_none()


async def count_pending_review_cleanup_claims(session: AsyncSession, reservation_id: str) -> int:
    return int(
        await session.scalar(
            select(func.count()).select_from(BenefitPackageReviewCleanupClaimRow).where(
                BenefitPackageReviewCleanupClaimRow.reservation_id == reservation_id,
                BenefitPackageReviewCleanupClaimRow.status == "pending",
            )
        )
        or 0
    )
