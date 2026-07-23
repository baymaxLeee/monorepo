from application.contracts.conversation_cleanup import (
    CleanupConversationArtifactsInput,
    CleanupConversationArtifactsResult,
)
from application.conversation_cleanup import cleanup_conversation_artifacts
from fastapi import APIRouter, Depends

from api.http.dependencies import require_internal_token

router = APIRouter(
    prefix="/internal/conversation-artifact-cleanups",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("", response_model=CleanupConversationArtifactsResult)
async def cleanup_conversation_artifacts_route(
    payload: CleanupConversationArtifactsInput,
) -> CleanupConversationArtifactsResult:
    return await cleanup_conversation_artifacts(payload)

