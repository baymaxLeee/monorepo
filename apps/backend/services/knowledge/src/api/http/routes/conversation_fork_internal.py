from application.contracts.conversation_fork import ForkConversationDocumentsInput, ForkConversationDocumentsResult
from application.conversation_fork import fork_conversation_documents
from fastapi import APIRouter, Depends

from api.http.dependencies import DbSession, require_internal_token

router = APIRouter(
    prefix="/internal/conversation-forks", tags=["internal"], dependencies=[Depends(require_internal_token)]
)


@router.post("", response_model=ForkConversationDocumentsResult)
async def fork_documents(
    payload: ForkConversationDocumentsInput, session: DbSession
) -> ForkConversationDocumentsResult:
    return await fork_conversation_documents(session, payload)
