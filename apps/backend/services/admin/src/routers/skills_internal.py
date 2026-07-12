"""Internal skill-resolution API (service-to-service).

Mounted under `/internal/skills/...`. Gateway DOES NOT forward `/internal/*` to
the public surface — only sibling microservices reach this with a valid
`X-Internal-Token` header. `GET /internal/skills/{id}` returns the skill's full
body; chat pulls it on demand when the model calls `load_skill` (progressive
disclosure), so the body never sits in the prompt unless activated.
"""

from typing import Annotated

from deps import AuthContext, DbSession, InternalCaller
from fastapi import APIRouter, Query
from schemas.skill import InternalSkill, InternalSkillFile
from services.skills import SkillService

router = APIRouter(prefix="/internal/skills", tags=["internal-skills"])


@router.get("/{skill_id}/files", response_model=InternalSkillFile)
async def get_skill_file_internal(
    skill_id: str,
    path: Annotated[str, Query(min_length=1, max_length=1024)],
    org_id: Annotated[str, Query(min_length=1, description="Team that owns the skill")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalSkillFile:
    service = SkillService(session, AuthContext(user_id="", username="", email="", org_id=org_id))
    return await service.get_internal_file(skill_id, org_id, path)


@router.get("/{skill_id}", response_model=InternalSkill)
async def get_skill_internal(
    skill_id: str,
    org_id: Annotated[str, Query(min_length=1, description="Team that owns the skill")],
    session: DbSession,
    _caller: InternalCaller,
) -> InternalSkill:
    service = SkillService(session, AuthContext(user_id="", username="", email="", org_id=org_id))
    return await service.get_internal(skill_id, org_id)
