"""Internal RAG retrieval API for chat and other services.

`POST /internal/retrieve` runs hybrid search (dense + BM25 + RRF + optional
rerank), scoped to the caller's team org, and returns chunks with citations.
"""

from application.contracts.retrieval import RetrieveInput, RetrieveResult
from application.retrieval import retrieve
from fastapi import APIRouter, Depends

from api.http.dependencies import DbSession, require_internal_token

router = APIRouter(
    prefix="/internal",
    tags=["internal-retrieval"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/retrieve", response_model=RetrieveResult)
async def retrieve_chunks(payload: RetrieveInput, session: DbSession) -> RetrieveResult:
    return await retrieve(
        session,
        org_id=payload.org_id,
        query=payload.query,
        top_k=payload.top_k,
    )
