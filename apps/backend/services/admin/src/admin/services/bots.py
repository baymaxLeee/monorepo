"""Bot business service."""

from datetime import UTC

from kernel.errors import NotFoundError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from admin.crud import bots as bot_crud
from admin.deps import ADMIN_USER_ID, AuthContext
from admin.models.bot import BotRow
from admin.schemas.bot import Bot


def to_schema(row: BotRow) -> Bot:
    created = row.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return Bot(
        id=row.id,
        user_id=row.user_id,
        username="admin" if row.user_id == ADMIN_USER_ID else row.user_id,
        name=row.name,
        status=row.status,  # type: ignore[arg-type]
        created_at=created.isoformat().replace("+00:00", "Z"),
    )


class BotService:
    def __init__(
        self,
        session: AsyncSession,
        current_user: AuthContext,
        redis: Redis | None = None,
    ) -> None:
        self._session = session
        self._current_user = current_user
        self._redis = redis

    async def list(self) -> list[Bot]:
        rows = await bot_crud.list_bots(
            self._session,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        return [to_schema(row) for row in rows]

    async def get(self, bot_id: str) -> Bot:
        row = await bot_crud.get_bot(
            self._session,
            bot_id,
            self._current_user.user_id,
            self._current_user.is_admin,
        )
        if row is None:
            raise NotFoundError(f"bot {bot_id} not found")
        return to_schema(row)

    async def create(self, name: str) -> Bot:
        row = await bot_crud.create_bot(self._session, name, self._current_user.user_id)
        if self._redis is not None:
            await self._redis.incr("admin:bots:created")
        return to_schema(row)
