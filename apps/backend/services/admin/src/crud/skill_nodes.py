"""Mutable and published Skill file-tree persistence."""

from models.skill_node import SkillNodeRow
from models.skill_published_node import SkillPublishedNodeRow
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession


async def list_workspace_nodes(session: AsyncSession, skill_id: str) -> list[SkillNodeRow]:
    result = await session.scalars(
        select(SkillNodeRow)
        .where(SkillNodeRow.skill_id == skill_id)
        .order_by(SkillNodeRow.sort_order, SkillNodeRow.name)
    )
    return list(result.all())


async def get_workspace_node(session: AsyncSession, skill_id: str, node_id: str) -> SkillNodeRow | None:
    return await session.scalar(
        select(SkillNodeRow).where(SkillNodeRow.skill_id == skill_id, SkillNodeRow.id == node_id)
    )


async def list_published_nodes(session: AsyncSession, skill_id: str) -> list[SkillPublishedNodeRow]:
    result = await session.scalars(
        select(SkillPublishedNodeRow)
        .where(SkillPublishedNodeRow.skill_id == skill_id)
        .order_by(SkillPublishedNodeRow.sort_order, SkillPublishedNodeRow.name)
    )
    return list(result.all())


async def replace_published_nodes(session: AsyncSession, skill_id: str) -> None:
    await session.execute(delete(SkillPublishedNodeRow).where(SkillPublishedNodeRow.skill_id == skill_id))
    for node in await list_workspace_nodes(session, skill_id):
        session.add(
            SkillPublishedNodeRow(
                skill_id=skill_id,
                node_id=node.id,
                parent_node_id=node.parent_id,
                name=node.name,
                node_type=node.node_type,
                mime_type=node.mime_type,
                content=node.content,
                sort_order=node.sort_order,
            )
        )
    await session.flush()
