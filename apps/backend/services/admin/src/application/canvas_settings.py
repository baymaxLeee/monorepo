from infrastructure.persistence.database import write_tx
from infrastructure.persistence.repositories import canvas_settings as repository
from infrastructure.persistence.repositories import providers
from kernel.errors import ConflictError, ForbiddenError, RequestError
from sqlalchemy.ext.asyncio import AsyncSession

from application.auth import AuthContext
from application.contracts.canvas_settings import CanvasDefaults, CanvasSettings, UpdateCanvasSettings


class CanvasSettingsService:
    def __init__(self, session: AsyncSession, actor: AuthContext) -> None:
        self.session = session
        self.actor = actor

    async def get(self) -> CanvasSettings:
        if not self.actor.workspace_id:
            raise ForbiddenError("active workspace required")
        row = await repository.get(self.session, self.actor.workspace_id, self.actor.tenant_id)
        if row is None:
            return CanvasSettings(revision=0, defaults=CanvasDefaults())
        return CanvasSettings(revision=row.revision, defaults=CanvasDefaults.model_validate_json(row.defaults_json))

    async def update(self, payload: UpdateCanvasSettings) -> CanvasSettings:
        if not self.actor.workspace_id or not self.actor.can_write_workspace_config:
            raise ForbiddenError("workspace_admin role required")
        async with write_tx(self.session):
            for slot, kind in (("inference", "chat"), ("image", "image"), ("video", "video")):
                selection = getattr(payload.defaults, slot)
                if selection is None:
                    continue
                provider = await providers.get_provider(
                    self.session, selection.provider_id, self.actor.workspace_id, self.actor.tenant_id
                )
                if provider is None or not provider.is_enabled or provider.provider_kind != kind:
                    raise RequestError(f"{slot} requires an enabled {kind} provider in this workspace")
                if (
                    selection.parameters.max_tokens is not None
                    and selection.parameters.max_tokens > provider.max_output_tokens
                ):
                    raise RequestError("max_tokens exceeds the provider output budget")
            saved = await repository.save(
                self.session,
                self.actor.workspace_id,
                self.actor.tenant_id,
                self.actor.user_id,
                payload.expected_revision,
                payload.defaults.model_dump_json(),
            )
            if not saved:
                raise ConflictError("Canvas settings changed; reload before saving")
        return CanvasSettings(revision=payload.expected_revision + 1, defaults=payload.defaults)
