from application.contracts.conversation_fork import ForkConversationFilesInput, ForkConversationFilesResult
from application.conversation_fork import fork_conversation_files
from fastapi import APIRouter, Depends

from api.http.dependencies import DbSession, require_internal_token

router = APIRouter(
    prefix="/internal/conversation-forks", tags=["internal"], dependencies=[Depends(require_internal_token)]
)


@router.post("", response_model=ForkConversationFilesResult)
async def fork_files(payload: ForkConversationFilesInput, session: DbSession) -> ForkConversationFilesResult:
    return await fork_conversation_files(session, payload)
