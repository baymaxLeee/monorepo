from infrastructure.persistence.models.artifact import ArtifactGenerationRow
from kernel.errors import ConflictError, NotFoundError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def get_owned_generation(
    session: AsyncSession,
    generation_id: str,
    user_id: str,
    *,
    for_update: bool = False,
) -> ArtifactGenerationRow:
    stmt = select(ArtifactGenerationRow).where(
        ArtifactGenerationRow.id == generation_id,
        ArtifactGenerationRow.user_id == user_id,
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = await session.scalar(stmt)
    if row is None:
        raise NotFoundError(f"artifact generation {generation_id} not found")
    return row


def assert_generation_writable(generation: ArtifactGenerationRow) -> None:
    if generation.status == "cancelled":
        raise ConflictError("artifact generation was cancelled")
    if generation.status == "failed":
        raise ConflictError("artifact generation failed")
    if generation.status == "completed":
        raise ConflictError("completed artifact blocks are immutable")
