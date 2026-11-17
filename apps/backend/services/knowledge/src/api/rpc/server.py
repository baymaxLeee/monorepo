from __future__ import annotations

from collections.abc import Awaitable
from datetime import datetime
from typing import Any, Never

import grpc
import knowledge.v1.knowledge_pb2 as knowledge_pb2
import knowledge.v1.knowledge_pb2_grpc as knowledge_pb2_grpc
from application import document_operations
from application.contracts.conversation_cleanup import CleanupConversationArtifactsInput
from application.contracts.conversation_fork import ForkConversationDocumentsInput
from application.contracts.document import (
    CreateMediaDocumentInput,
    CreateStagedMediaInput,
    Document,
    DocumentSlice,
    StagedMedia,
    StagedMediaActionInput,
    UpdateArtifactInput,
)
from application.contracts.retrieval import RetrieveInput, RetrieveResult
from application.conversation_cleanup import cleanup_conversation_artifacts
from application.conversation_fork import fork_conversation_documents
from application.retrieval import retrieve
from google.protobuf.timestamp_pb2 import Timestamp
from infrastructure.persistence.database import get_session_factory
from knowledge_kernel.errors import BaseError


async def _abort(context: grpc.aio.ServicerContext[Any, Any], error: BaseError) -> Never:
    codes = {
        400: grpc.StatusCode.INVALID_ARGUMENT,
        401: grpc.StatusCode.UNAUTHENTICATED,
        403: grpc.StatusCode.PERMISSION_DENIED,
        404: grpc.StatusCode.NOT_FOUND,
        409: grpc.StatusCode.FAILED_PRECONDITION,
    }
    await context.abort(codes.get(error.status_code, grpc.StatusCode.INTERNAL), error.message)
    raise AssertionError("context.abort returned")


async def _call[T](context: grpc.aio.ServicerContext[Any, Any], operation: Awaitable[T]) -> T:
    callers = [value for key, value in (context.invocation_metadata() or ()) if key == "x-caller-service"]
    if callers != ["runtime"]:
        await context.abort(grpc.StatusCode.PERMISSION_DENIED, "caller is not authorized for this RPC")
    try:
        return await operation
    except BaseError as error:
        await _abort(context, error)


def _actor(request: Any) -> tuple[str, str, str]:
    actor = request.actor
    return actor.user_id, actor.tenant_id, actor.workspace_id


def _timestamp(value: str) -> Timestamp:
    result = Timestamp()
    result.FromDatetime(datetime.fromisoformat(value.replace("Z", "+00:00")))
    return result


_DOCUMENT_KINDS = {"source": knowledge_pb2.DOCUMENT_KIND_SOURCE, "artifact": knowledge_pb2.DOCUMENT_KIND_ARTIFACT}
_INGEST = {
    name: getattr(knowledge_pb2, f"INGEST_STATUS_{name.upper()}")
    for name in ("pending", "storing", "received", "converting", "ready", "failed")
}
_INDEX = {
    name: getattr(knowledge_pb2, f"INDEX_STATUS_{name.upper()}")
    for name in ("pending", "indexing", "indexed", "skipped", "failed")
}
_SLICE = {
    name: getattr(knowledge_pb2, f"DOCUMENT_SLICE_STATE_{name.upper()}") for name in ("ready", "processing", "failed")
}
_STAGED = {
    name: getattr(knowledge_pb2, f"STAGED_MEDIA_STATUS_{name.upper()}") for name in ("staged", "published", "discarded")
}


def _document(value: Document) -> knowledge_pb2.Document:
    result = knowledge_pb2.Document(
        id=value.id,
        user_id=value.user_id,
        kind=_DOCUMENT_KINDS[value.kind],
        title=value.title,
        filename=value.filename,
        mime_type=value.mime_type,
        editable_source=value.editable_source,
        content_markdown=value.content_md,
        source_size=value.source_size,
        ingest_status=_INGEST[value.ingest_status],
        ingest_progress=value.ingest_progress,
        index_status=_INDEX[value.index_status],
        created_at=_timestamp(value.created_at),
        updated_at=_timestamp(value.updated_at),
    )
    for field in (
        "workspace_id",
        "tenant_id",
        "conversation_id",
        "source_mime_type",
        "asset_id",
        "source_revision_id",
        "source_sha256",
        "source_filename",
        "ingest_error",
        "index_error",
    ):
        item = getattr(value, field)
        if item is not None:
            setattr(result, field, item)
    return result


def _slice(value: DocumentSlice) -> knowledge_pb2.DocumentSlice:
    result = knowledge_pb2.DocumentSlice(
        id=value.id,
        title=value.title,
        filename=value.filename,
        mime_type=value.mime_type,
        content=value.content,
        start=value.start,
        total_chars=value.total_chars,
        state=_SLICE[value.state],
    )
    if value.next_start is not None:
        result.next_start = value.next_start
    if value.error is not None:
        result.error = value.error
    return result


def _staged(value: StagedMedia) -> knowledge_pb2.StagedMedia:
    result = knowledge_pb2.StagedMedia(
        id=value.id,
        user_id=value.user_id,
        workspace_id=value.workspace_id,
        tenant_id=value.tenant_id,
        title=value.title,
        filename=value.filename,
        mime_type=value.mime_type,
        size=value.size,
        asset_id=value.asset_id,
        revision_id=value.revision_id,
        sha256=value.sha256,
        status=_STAGED[value.status],
        created_at=_timestamp(value.created_at),
        updated_at=_timestamp(value.updated_at),
    )
    if value.conversation_id is not None:
        result.conversation_id = value.conversation_id
    if value.document_id is not None:
        result.document_id = value.document_id
    return result


def _retrieval(value: RetrieveResult) -> knowledge_pb2.RetrieveResponse:
    result = knowledge_pb2.RetrieveResponse(
        query=value.query,
        chunks=[
            knowledge_pb2.RetrievedChunk(
                document_id=item.document_id,
                chunk_index=item.chunk_index,
                content=item.content,
                score=item.score,
                title=item.title,
                filename=item.filename,
                media_type=item.media_type,
            )
            for item in value.chunks
        ],
    )
    if value.note is not None:
        result.note = value.note
    return result


class KnowledgeService(
    knowledge_pb2_grpc.DocumentServiceServicer,
    knowledge_pb2_grpc.StagedMediaServiceServicer,
    knowledge_pb2_grpc.ConversationDocumentServiceServicer,
    knowledge_pb2_grpc.RetrievalServiceServicer,
):
    async def ListDocuments(self, request, context):  # type: ignore[no-untyped-def]
        user_id, _, _ = _actor(request)
        kinds = {knowledge_pb2.DOCUMENT_KIND_SOURCE: "source", knowledge_pb2.DOCUMENT_KIND_ARTIFACT: "artifact"}
        async with get_session_factory()() as session:
            values = await _call(
                context,
                document_operations.list_documents(
                    session,
                    user_id,
                    request.conversation_id if request.HasField("conversation_id") else None,
                    kinds.get(request.kind) if request.HasField("kind") else None,
                ),
            )
        return knowledge_pb2.ListDocumentsResponse(documents=[_document(value) for value in values])

    async def GetDocument(self, request, context):  # type: ignore[no-untyped-def]
        user_id, _, _ = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(context, document_operations.get_document(request.document_id, session, user_id, True))
        return knowledge_pb2.GetDocumentResponse(document=_document(value))

    async def GetWorkspaceDocument(self, request, context):  # type: ignore[no-untyped-def]
        _, tenant_id, workspace_id = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(
                context,
                document_operations.get_workspace_document(
                    workspace_id, request.document_id, session, tenant_id, False
                ),
            )
        return knowledge_pb2.GetWorkspaceDocumentResponse(document=_document(value))

    async def GetDocumentSlice(self, request, context):  # type: ignore[no-untyped-def]
        user_id, _, _ = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(
                context,
                document_operations.get_document_slice(
                    request.document_id, session, user_id, request.start, request.max_chars, request.wait_millis
                ),
            )
        return knowledge_pb2.GetDocumentSliceResponse(slice=_slice(value))

    async def UpdateArtifact(self, request, context):  # type: ignore[no-untyped-def]
        user_id, _, _ = _actor(request)
        payload = UpdateArtifactInput(
            user_id=user_id,
            **{
                field: getattr(request, field)
                for field in ("title", "filename", "content", "mime_type")
                if request.HasField(field)
            },
            expected_updated_at=request.expected_updated_at.ToJsonString()
            if request.HasField("expected_updated_at")
            else None,
        )
        async with get_session_factory()() as session:
            value = await _call(context, document_operations.update_artifact(request.document_id, payload, session))
        return knowledge_pb2.UpdateArtifactResponse(document=_document(value))

    async def DeleteDocument(self, request, context):  # type: ignore[no-untyped-def]
        user_id, _, _ = _actor(request)
        async with get_session_factory()() as session:
            await _call(context, document_operations.delete_document(request.document_id, session, user_id))
        return knowledge_pb2.DeleteDocumentResponse()

    async def CreateMediaDocument(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        payload = CreateMediaDocumentInput(
            user_id=user_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            conversation_id=request.conversation_id if request.HasField("conversation_id") else None,
            title=request.title,
            asset_id=request.asset_id,
            revision_id=request.revision_id,
            idempotency_key=request.idempotency_key if request.HasField("idempotency_key") else None,
        )
        async with get_session_factory()() as session:
            value = await _call(context, document_operations.create_media_document(payload, session))
        return knowledge_pb2.CreateMediaDocumentResponse(document=_document(value))

    async def CreateStagedMedia(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        payload = CreateStagedMediaInput(
            user_id=user_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            conversation_id=request.conversation_id if request.HasField("conversation_id") else None,
            title=request.title,
            asset_id=request.asset_id,
            revision_id=request.revision_id,
            idempotency_key=request.idempotency_key if request.HasField("idempotency_key") else None,
        )
        async with get_session_factory()() as session:
            value = await _call(context, document_operations.create_staged_media(payload, session))
        return knowledge_pb2.CreateStagedMediaResponse(staged_media=_staged(value))

    async def GetStagedMedia(self, request, context):  # type: ignore[no-untyped-def]
        user_id, _, _ = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(
                context, document_operations.get_staged_media(request.staged_media_id, session, user_id)
            )
        return knowledge_pb2.GetStagedMediaResponse(staged_media=_staged(value))

    async def PublishStagedMedia(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(
                context,
                document_operations.publish_staged_media(
                    request.staged_media_id,
                    StagedMediaActionInput(user_id=user_id, tenant_id=tenant_id, workspace_id=workspace_id),
                    session,
                ),
            )
        return knowledge_pb2.PublishStagedMediaResponse(document=_document(value))

    async def DiscardStagedMedia(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(
                context,
                document_operations.discard_staged_media(
                    request.staged_media_id,
                    StagedMediaActionInput(user_id=user_id, tenant_id=tenant_id, workspace_id=workspace_id),
                    session,
                ),
            )
        return knowledge_pb2.DiscardStagedMediaResponse(staged_media=_staged(value))

    async def CleanupArtifacts(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        value = await _call(
            context,
            cleanup_conversation_artifacts(
                CleanupConversationArtifactsInput(
                    conversation_id=request.conversation_id,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    workspace_id=workspace_id,
                )
            ),
        )
        return knowledge_pb2.CleanupArtifactsResponse(**value.model_dump())

    async def ForkDocuments(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        async with get_session_factory()() as session:
            value = await _call(
                context,
                fork_conversation_documents(
                    session,
                    ForkConversationDocumentsInput(
                        source_conversation_id=request.source_conversation_id,
                        conversation_id=request.conversation_id,
                        user_id=user_id,
                        tenant_id=tenant_id,
                        workspace_id=workspace_id,
                    ),
                ),
            )
        return knowledge_pb2.ForkDocumentsResponse(document_ids=value.document_ids)

    async def Retrieve(self, request, context):  # type: ignore[no-untyped-def]
        user_id, tenant_id, workspace_id = _actor(request)
        payload = RetrieveInput(
            user_id=user_id,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            query=request.query,
            top_k=request.top_k if request.HasField("top_k") else None,
        )
        async with get_session_factory()() as session:
            value = await _call(
                context,
                retrieve(
                    session,
                    workspace_id=payload.workspace_id,
                    tenant_id=payload.tenant_id,
                    query=payload.query,
                    top_k=payload.top_k,
                ),
            )
        return _retrieval(value)


async def start_server(port: int) -> grpc.aio.Server:
    server = grpc.aio.server()
    service = KnowledgeService()
    knowledge_pb2_grpc.add_DocumentServiceServicer_to_server(service, server)
    knowledge_pb2_grpc.add_StagedMediaServiceServicer_to_server(service, server)
    knowledge_pb2_grpc.add_ConversationDocumentServiceServicer_to_server(service, server)
    knowledge_pb2_grpc.add_RetrievalServiceServicer_to_server(service, server)
    server.add_insecure_port(f"[::]:{port}")
    await server.start()
    return server
