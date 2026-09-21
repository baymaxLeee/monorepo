import json
import logging
from builtins import list as list_type
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from infrastructure.ark_asset_groups import AssetGroupClient
from infrastructure.persistence.database import write_tx
from infrastructure.persistence.models.benefit_package import (
    AssetGroupCleanupRow,
    BenefitPackageModelRow,
    BenefitPackageReviewReservationRow,
    BenefitPackageRow,
)
from infrastructure.persistence.repositories import benefit_packages as repository
from infrastructure.persistence.repositories import providers as provider_repository
from kernel.errors import ConflictError, NotFoundError, RequestError
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from application.auth import AuthContext
from application.contracts.benefit_package import (
    AssetGroupCleanup,
    AvailableBenefitPackage,
    BenefitPackage,
    BenefitPackageReviewReservation,
    CreateBenefitPackageInput,
    InternalBenefitPackage,
    ReserveBenefitPackageReviewInput,
    UpdateBenefitPackageInput,
)
from application.encryption import decrypt, encrypt

logger = logging.getLogger(__name__)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _models(raw: str) -> list[str]:
    value = json.loads(raw)
    return [str(item) for item in value] if isinstance(value, list) else []


def _public(row: BenefitPackageRow, *, material_used: int | None = None, material_reserved: int = 0) -> BenefitPackage:
    return BenefitPackage(
        id=row.id,
        is_preset=row.is_preset,
        name=row.name,
        project_name=row.project_name,
        has_access_key_id=bool(decrypt(row.access_key_id_enc)),
        has_secret_access_key=bool(decrypt(row.secret_access_key_enc)),
        enabled=row.enabled,
        model_ids=_models(row.model_ids_json),
        material_used=row.material_used if material_used is None else material_used,
        material_reserved=material_reserved,
        material_limit=row.material_limit,
        revision=row.revision,
        created_by=row.created_by,
        updated_by=row.updated_by,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
    )


def _cleanup_public(row: AssetGroupCleanupRow) -> AssetGroupCleanup:
    return AssetGroupCleanup(
        id=row.id,
        benefit_package_id=row.benefit_package_id,
        asset_group_id=row.asset_group_id,
        status=row.status,
        attempts=row.attempts,
        last_error=row.last_error,
        created_at=_iso(row.created_at),
        updated_at=_iso(row.updated_at),
        completed_at=_iso(row.completed_at) if row.completed_at else None,
    )


def _integrity_conflict(exc: IntegrityError) -> ConflictError:
    current: BaseException | None = exc
    seen: set[int] = set()
    constraint = ""
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        constraint = str(getattr(current, "constraint_name", "") or "")
        diag = getattr(current, "diag", None)
        constraint = constraint or str(getattr(diag, "constraint_name", "") or "")
        if constraint:
            break
        current = getattr(current, "orig", None) or current.__cause__
    if constraint == "benefit_packages_preset":
        return ConflictError("preset benefit package already exists")
    if constraint == "benefit_packages_name":
        return ConflictError("benefit package name already exists")
    if constraint == "benefit_package_models_scope_model":
        return ConflictError("a model can belong to only one custom benefit package")
    if constraint == "benefit_packages_asset_group":
        return ConflictError("asset group is already attached to another benefit package")
    return ConflictError("benefit package conflicts with an existing record")


class BenefitPackageService:
    def __init__(
        self, session: AsyncSession, current_user: AuthContext, asset_groups: AssetGroupClient | None = None
    ) -> None:
        self._session = session
        self._user = current_user
        self._asset_groups = asset_groups or AssetGroupClient()

    async def list(self, available_only: bool = False) -> list[BenefitPackage]:
        rows = await repository.list_packages(self._session, self._user.tenant_id, self._user.workspace_id)
        usage = await repository.review_usage(self._session, self._user.tenant_id, self._user.workspace_id)
        if available_only or not self._user.can_write_workspace_config:
            rows = [row for row in rows if row.enabled]
        return [
            _public(row, material_used=usage.get(row.id, (0, 0))[0], material_reserved=usage.get(row.id, (0, 0))[1])
            for row in rows
        ]

    async def list_available_internal(self) -> list_type[AvailableBenefitPackage]:
        rows = await repository.list_packages(self._session, self._user.tenant_id, self._user.workspace_id)
        usage = await repository.review_usage(self._session, self._user.tenant_id, self._user.workspace_id)
        return [
            AvailableBenefitPackage(
                id=row.id,
                name=row.name,
                is_preset=row.is_preset,
                model_ids=_models(row.model_ids_json),
                material_used=usage.get(row.id, (0, 0))[0],
                material_reserved=usage.get(row.id, (0, 0))[1],
                material_limit=row.material_limit,
            )
            for row in rows
            if row.enabled
        ]

    async def create(self, payload: CreateBenefitPackageInput) -> BenefitPackage:
        model_ids = self._normalize_models(payload.model_ids)
        if not payload.is_preset and not model_ids:
            raise RequestError("custom package requires at least one model")
        name = "预置权益包" if payload.is_preset else payload.name.strip()
        if not payload.is_preset and name == "预置权益包":
            raise RequestError("custom package cannot use the preset package name")
        project_name = "default" if payload.is_preset else payload.project_name.strip()
        access_key_id = payload.access_key_id.strip()
        secret_access_key = payload.secret_access_key.strip()
        if not name or not project_name or not access_key_id or not secret_access_key:
            raise RequestError("benefit package name, project and credentials are required")
        async with self._session.begin():
            existing = await repository.list_packages(self._session, self._user.tenant_id, self._user.workspace_id)
            if payload.is_preset and any(item.is_preset for item in existing):
                raise ConflictError("preset benefit package already exists")
            if not payload.is_preset:
                await self._validate_models(model_ids, existing)
        asset_group_id = await self._asset_groups.create(
            name=name,
            project_name=project_name,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
        )
        now = datetime.now(UTC)
        row = BenefitPackageRow(
            id=uuid4().hex,
            tenant_id=self._user.tenant_id,
            workspace_id=self._user.workspace_id,
            is_preset=payload.is_preset,
            name=name,
            project_name=project_name,
            asset_group_id=asset_group_id,
            access_key_id_enc=encrypt(access_key_id),
            secret_access_key_enc=encrypt(secret_access_key),
            enabled=True if payload.is_preset else payload.enabled,
            model_ids_json=json.dumps([] if payload.is_preset else model_ids),
            material_used=0,
            material_limit=payload.material_limit,
            revision=1,
            created_by=self._user.user_id,
            updated_by=self._user.user_id,
            created_at=now,
            updated_at=now,
        )
        try:
            async with write_tx(self._session):
                rows = await repository.list_packages(self._session, self._user.tenant_id, self._user.workspace_id)
                if payload.is_preset and any(item.is_preset for item in rows):
                    raise ConflictError("preset benefit package already exists")
                if not payload.is_preset:
                    await self._validate_models(model_ids, rows)
                self._session.add(row)
                await self._session.flush()
                await self._replace_models(row, model_ids)
        except Exception as exc:
            await self._enqueue_group_cleanup(row.id, asset_group_id, project_name, access_key_id, secret_access_key)
            if isinstance(exc, IntegrityError):
                raise _integrity_conflict(exc) from exc
            raise
        return _public(row)

    async def update(self, package_id: str, payload: UpdateBenefitPackageInput) -> BenefitPackage:
        async with self._session.begin():
            current = await self._get(package_id)
            if current.revision != payload.expected_revision:
                raise ConflictError("benefit package changed; reload before saving")
            if current.is_preset and (
                payload.name is not None or payload.project_name is not None or payload.model_ids is not None
            ):
                raise RequestError("preset package scope cannot be changed")
            current_is_preset = current.is_preset
            current_name = current.name
            current_project_name = current.project_name
            current_asset_group_id = current.asset_group_id
            current_access_key_id = decrypt(current.access_key_id_enc)
            current_secret_access_key = decrypt(current.secret_access_key_enc)
            current_model_ids = _models(current.model_ids_json)

        name = payload.name.strip() if payload.name is not None else current_name
        project_name = payload.project_name.strip() if payload.project_name is not None else current_project_name
        access_key_id = payload.access_key_id.strip() if payload.access_key_id is not None else current_access_key_id
        secret_access_key = (
            payload.secret_access_key.strip() if payload.secret_access_key is not None else current_secret_access_key
        )
        if not current_is_preset and name == "预置权益包":
            raise RequestError("custom package cannot use the preset package name")
        if not name or not project_name or not access_key_id or not secret_access_key:
            raise RequestError("benefit package name, project and credentials are required")
        model_ids = self._normalize_models(payload.model_ids) if payload.model_ids is not None else current_model_ids
        if not current_is_preset and not model_ids:
            raise RequestError("custom package requires at least one model")
        group_changed = (
            name != current_name
            or project_name != current_project_name
            or payload.access_key_id is not None
            or payload.secret_access_key is not None
        )
        async with self._session.begin():
            usage = await repository.review_usage(self._session, self._user.tenant_id, self._user.workspace_id)
            committed, reserved = usage.get(package_id, (0, 0))
            if committed + reserved > 0 and (group_changed or payload.model_ids is not None):
                raise ConflictError("benefit package credentials, project and models cannot change while reviews exist")
        old_group: tuple[str, str, str, str] | None = None
        new_group: tuple[str, str, str, str] | None = None
        if group_changed:
            new_group_id = await self._asset_groups.create(
                name=name,
                project_name=project_name,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
            )
            new_group = (new_group_id, project_name, access_key_id, secret_access_key)
            old_group = (
                current_asset_group_id,
                current_project_name,
                current_access_key_id,
                current_secret_access_key,
            )
        try:
            async with write_tx(self._session):
                row = await self._get(package_id, for_update=True)
                if row.revision != payload.expected_revision:
                    raise ConflictError("benefit package changed; reload before saving")
                if row.is_preset and (
                    payload.name is not None or payload.project_name is not None or payload.model_ids is not None
                ):
                    raise RequestError("preset package scope cannot be changed")
                usage = await repository.review_usage(self._session, self._user.tenant_id, self._user.workspace_id)
                committed, reserved = usage.get(package_id, (0, 0))
                if committed + reserved > 0 and (group_changed or payload.model_ids is not None):
                    raise ConflictError(
                        "benefit package credentials, project and models cannot change while reviews exist"
                    )
                if not row.is_preset:
                    rows = await repository.list_packages(self._session, self._user.tenant_id, self._user.workspace_id)
                    await self._validate_models(model_ids, rows, package_id)
                if new_group is not None:
                    row.asset_group_id = new_group[0]
                row.name = name
                row.project_name = project_name
                if payload.access_key_id is not None:
                    row.access_key_id_enc = encrypt(access_key_id)
                if payload.secret_access_key is not None:
                    row.secret_access_key_enc = encrypt(secret_access_key)
                if payload.enabled is not None:
                    row.enabled = payload.enabled
                if "material_limit" in payload.model_fields_set:
                    if payload.material_limit is not None and payload.material_limit < committed + reserved:
                        raise ConflictError("material limit cannot be lower than committed and reserved reviews")
                    row.material_limit = payload.material_limit
                row.model_ids_json = json.dumps([] if row.is_preset else model_ids)
                row.revision += 1
                row.updated_by = self._user.user_id
                row.updated_at = datetime.now(UTC)
                await self._session.flush()
                await self._replace_models(row, model_ids)
        except Exception as exc:
            if new_group is not None:
                await self._enqueue_group_cleanup(package_id, *new_group)
            if isinstance(exc, IntegrityError):
                raise _integrity_conflict(exc) from exc
            raise
        if old_group is not None:
            await self._enqueue_group_cleanup(package_id, *old_group)
        return _public(row)

    async def reserve_review(
        self, package_id: str, payload: ReserveBenefitPackageReviewInput
    ) -> BenefitPackageReviewReservation:
        now = datetime.now(UTC)
        try:
            async with write_tx(self._session):
                package = await self._get(package_id, for_update=True)
                if not package.enabled:
                    raise ConflictError("benefit package is disabled")
                existing = await repository.get_review_reservation(
                    self._session, payload.reservation_id, for_update=True
                )
                if existing is not None:
                    if (
                        existing.tenant_id != self._user.tenant_id
                        or existing.workspace_id != self._user.workspace_id
                        or existing.benefit_package_id != package_id
                        or existing.project_id != payload.project_id
                        or existing.asset_id != payload.asset_id
                    ):
                        raise ConflictError("review reservation id already belongs to another request")
                    if existing.status != "released":
                        return BenefitPackageReviewReservation(id=existing.id, status=existing.status)
                usage = await repository.review_usage(self._session, self._user.tenant_id, self._user.workspace_id)
                committed, reserved = usage.get(package_id, (0, 0))
                if package.material_limit is not None and committed + reserved >= package.material_limit:
                    raise ConflictError("benefit package material quota exceeded")
                if existing is not None:
                    existing.status = "reserved"
                    existing.updated_at = now
                    await self._session.flush()
                    return BenefitPackageReviewReservation(id=existing.id, status=existing.status)
                row = BenefitPackageReviewReservationRow(
                    id=payload.reservation_id,
                    tenant_id=self._user.tenant_id,
                    workspace_id=self._user.workspace_id,
                    benefit_package_id=package_id,
                    project_id=payload.project_id,
                    asset_id=payload.asset_id,
                    status="reserved",
                    created_at=now,
                    updated_at=now,
                )
                self._session.add(row)
                await self._session.flush()
        except IntegrityError as exc:
            raise ConflictError("asset already has an active review in this benefit package") from exc
        return BenefitPackageReviewReservation(id=row.id, status=row.status)

    async def transition_review_reservation(
        self, package_id: str, reservation_id: str, status: str
    ) -> BenefitPackageReviewReservation:
        if status not in {"committed", "released"}:
            raise RequestError("unsupported review reservation status")
        async with write_tx(self._session):
            row = await repository.get_review_reservation(self._session, reservation_id, for_update=True)
            if (
                row is None
                or row.tenant_id != self._user.tenant_id
                or row.workspace_id != self._user.workspace_id
                or row.benefit_package_id != package_id
            ):
                raise NotFoundError(f"review reservation {reservation_id} not found")
            if row.status == status or row.status == "released":
                return BenefitPackageReviewReservation(id=row.id, status=row.status)
            row.status = status
            row.updated_at = datetime.now(UTC)
            await self._session.flush()
        return BenefitPackageReviewReservation(id=row.id, status=row.status)

    async def delete(self, package_id: str, expected_revision: int) -> None:
        obsolete_group: tuple[str, str, str, str] | None = None
        async with write_tx(self._session):
            row = await self._get(package_id, for_update=True)
            if row.is_preset:
                raise RequestError("preset benefit package cannot be deleted")
            if row.revision != expected_revision:
                raise ConflictError("benefit package changed; reload before deleting")
            usage = await repository.review_usage(self._session, self._user.tenant_id, self._user.workspace_id)
            committed, reserved = usage.get(package_id, (0, 0))
            if committed + reserved > 0:
                raise ConflictError("benefit package cannot be deleted while reviews exist")
            row.deleted_at = datetime.now(UTC)
            row.enabled = False
            row.revision += 1
            row.updated_by = self._user.user_id
            row.updated_at = row.deleted_at
            await self._replace_models(row, [])
            obsolete_group = (
                row.asset_group_id,
                row.project_name,
                decrypt(row.access_key_id_enc),
                decrypt(row.secret_access_key_enc),
            )
        if obsolete_group is not None:
            await self._enqueue_group_cleanup(package_id, *obsolete_group)

    async def list_asset_group_cleanups(self) -> list_type[AssetGroupCleanup]:
        rows = await repository.list_asset_group_cleanups(self._session, self._user.tenant_id, self._user.workspace_id)
        return [_cleanup_public(row) for row in rows]

    async def retry_asset_group_cleanup(self, cleanup_id: str) -> AssetGroupCleanup:
        lease_token = uuid4().hex
        now = datetime.now(UTC)
        async with write_tx(self._session):
            row = await repository.get_asset_group_cleanup(
                self._session,
                cleanup_id,
                self._user.tenant_id,
                self._user.workspace_id,
                for_update=True,
            )
            if row is None:
                raise NotFoundError(f"asset group cleanup {cleanup_id} not found")
            if row.status == "completed":
                return _cleanup_public(row)
            if row.status == "running" and row.lease_until is not None and row.lease_until > now:
                raise ConflictError("asset group cleanup is already running")
            row.status = "running"
            row.lease_token = lease_token
            row.lease_until = now + timedelta(minutes=2)
            row.attempts += 1
            row.last_error = ""
            row.updated_at = datetime.now(UTC)
            await self._session.flush()
        try:
            await self._asset_groups.delete(
                group_id=row.asset_group_id,
                project_name=row.project_name,
                access_key_id=decrypt(row.access_key_id_enc),
                secret_access_key=decrypt(row.secret_access_key_enc),
            )
        except Exception as exc:
            await self._mark_cleanup(cleanup_id, lease_token, completed=False, error=str(exc))
            raise
        return await self._mark_cleanup(cleanup_id, lease_token, completed=True)

    async def get_internal(self, package_id: str) -> InternalBenefitPackage:
        row = await self._get(package_id)
        if not row.enabled:
            raise NotFoundError(f"benefit package {package_id} not found")
        return InternalBenefitPackage(
            id=row.id,
            name=row.name,
            project_name=row.project_name,
            asset_group_id=row.asset_group_id,
            access_key_id=decrypt(row.access_key_id_enc),
            secret_access_key=decrypt(row.secret_access_key_enc),
            is_preset=row.is_preset,
            model_ids=_models(row.model_ids_json),
        )

    async def _validate_models(
        self, model_ids: list_type[str], packages: list_type[BenefitPackageRow], package_id: str = ""
    ) -> None:
        for model_id in model_ids:
            provider = await provider_repository.get_provider(
                self._session, model_id, self._user.workspace_id, self._user.tenant_id
            )
            if provider is None or not provider.is_enabled or provider.provider_kind != "video":
                raise RequestError("benefit packages only accept enabled video models in the current workspace")
        claimed = {
            model_id
            for package in packages
            if package.id != package_id and not package.is_preset
            for model_id in _models(package.model_ids_json)
        }
        if claimed.intersection(model_ids):
            raise ConflictError("a model can belong to only one custom benefit package")

    async def _get(self, package_id: str, *, for_update: bool = False) -> BenefitPackageRow:
        row = await repository.get_package(
            self._session, package_id, self._user.tenant_id, self._user.workspace_id, for_update=for_update
        )
        if row is None:
            raise NotFoundError(f"benefit package {package_id} not found")
        return row

    @staticmethod
    def _normalize_models(values: list_type[str]) -> list_type[str]:
        return list_type(dict.fromkeys(value.strip() for value in values if value.strip()))

    async def _replace_models(self, row: BenefitPackageRow, model_ids: list_type[str]) -> None:
        await self._session.execute(delete(BenefitPackageModelRow).where(BenefitPackageModelRow.package_id == row.id))
        self._session.add_all(
            BenefitPackageModelRow(
                package_id=row.id, tenant_id=row.tenant_id, workspace_id=row.workspace_id, model_id=model_id
            )
            for model_id in ([] if row.is_preset else model_ids)
        )
        await self._session.flush()

    async def _enqueue_group_cleanup(
        self, package_id: str, group_id: str, project_name: str, access_key_id: str, secret_access_key: str
    ) -> None:
        now = datetime.now(UTC)
        try:
            async with write_tx(self._session):
                row = AssetGroupCleanupRow(
                    id=uuid4().hex,
                    tenant_id=self._user.tenant_id,
                    workspace_id=self._user.workspace_id,
                    benefit_package_id=package_id,
                    asset_group_id=group_id,
                    project_name=project_name,
                    access_key_id_enc=encrypt(access_key_id),
                    secret_access_key_enc=encrypt(secret_access_key),
                    status="pending",
                    lease_token="",
                    lease_until=None,
                    attempts=0,
                    last_error="",
                    created_at=now,
                    updated_at=now,
                    completed_at=None,
                )
                self._session.add(row)
                await self._session.flush()
            try:
                await self.retry_asset_group_cleanup(row.id)
            except Exception:
                logger.exception(
                    "failed to clean obsolete Ark asset group",
                    extra={"benefit_package_id": package_id, "asset_group_id": group_id},
                )
        except IntegrityError:
            logger.info(
                "Ark asset group cleanup is already recorded",
                extra={"benefit_package_id": package_id, "asset_group_id": group_id},
            )
        except Exception:
            logger.exception(
                "failed to persist Ark asset group cleanup",
                extra={"benefit_package_id": package_id, "asset_group_id": group_id},
            )

    async def _mark_cleanup(
        self, cleanup_id: str, lease_token: str, *, completed: bool, error: str = ""
    ) -> AssetGroupCleanup:
        async with write_tx(self._session):
            row = await repository.get_asset_group_cleanup(
                self._session, cleanup_id, self._user.tenant_id, self._user.workspace_id, for_update=True
            )
            if row is None:
                raise NotFoundError(f"asset group cleanup {cleanup_id} not found")
            if row.status != "running" or row.lease_token != lease_token:
                raise ConflictError("asset group cleanup lease changed")
            now = datetime.now(UTC)
            row.updated_at = now
            row.status = "completed" if completed else "pending"
            row.completed_at = now if completed else None
            row.lease_token = ""
            row.lease_until = None
            row.last_error = "" if completed else error[:512]
            await self._session.flush()
        return _cleanup_public(row)
