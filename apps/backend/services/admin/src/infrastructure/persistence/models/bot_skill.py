"""Bot ↔ Skill binding.

Which skills a Bot advertises. Join-only table; the skill definition lives in
`skills`. A row here means "this bot offers this skill to the model".
"""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from infrastructure.persistence.models.base import Base


class BotSkillRow(Base):
    __tablename__ = "bot_skills"

    bot_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    skill_id: Mapped[str] = mapped_column(String(32), primary_key=True, index=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
