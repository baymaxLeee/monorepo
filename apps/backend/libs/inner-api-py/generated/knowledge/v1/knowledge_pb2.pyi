import datetime

from common.v1 import context_pb2 as _context_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DocumentKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_KIND_UNSPECIFIED: _ClassVar[DocumentKind]
    DOCUMENT_KIND_SOURCE: _ClassVar[DocumentKind]
    DOCUMENT_KIND_ARTIFACT: _ClassVar[DocumentKind]

class IngestStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INGEST_STATUS_UNSPECIFIED: _ClassVar[IngestStatus]
    INGEST_STATUS_PENDING: _ClassVar[IngestStatus]
    INGEST_STATUS_STORING: _ClassVar[IngestStatus]
    INGEST_STATUS_RECEIVED: _ClassVar[IngestStatus]
    INGEST_STATUS_CONVERTING: _ClassVar[IngestStatus]
    INGEST_STATUS_READY: _ClassVar[IngestStatus]
    INGEST_STATUS_FAILED: _ClassVar[IngestStatus]

class IndexStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INDEX_STATUS_UNSPECIFIED: _ClassVar[IndexStatus]
    INDEX_STATUS_PENDING: _ClassVar[IndexStatus]
    INDEX_STATUS_INDEXING: _ClassVar[IndexStatus]
    INDEX_STATUS_INDEXED: _ClassVar[IndexStatus]
    INDEX_STATUS_SKIPPED: _ClassVar[IndexStatus]
    INDEX_STATUS_FAILED: _ClassVar[IndexStatus]

class DocumentSliceState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_SLICE_STATE_UNSPECIFIED: _ClassVar[DocumentSliceState]
    DOCUMENT_SLICE_STATE_READY: _ClassVar[DocumentSliceState]
    DOCUMENT_SLICE_STATE_PROCESSING: _ClassVar[DocumentSliceState]
    DOCUMENT_SLICE_STATE_FAILED: _ClassVar[DocumentSliceState]

class StagedMediaStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    STAGED_MEDIA_STATUS_UNSPECIFIED: _ClassVar[StagedMediaStatus]
    STAGED_MEDIA_STATUS_STAGED: _ClassVar[StagedMediaStatus]
    STAGED_MEDIA_STATUS_PUBLISHED: _ClassVar[StagedMediaStatus]
    STAGED_MEDIA_STATUS_DISCARDED: _ClassVar[StagedMediaStatus]
DOCUMENT_KIND_UNSPECIFIED: DocumentKind
DOCUMENT_KIND_SOURCE: DocumentKind
DOCUMENT_KIND_ARTIFACT: DocumentKind
INGEST_STATUS_UNSPECIFIED: IngestStatus
INGEST_STATUS_PENDING: IngestStatus
INGEST_STATUS_STORING: IngestStatus
INGEST_STATUS_RECEIVED: IngestStatus
INGEST_STATUS_CONVERTING: IngestStatus
INGEST_STATUS_READY: IngestStatus
INGEST_STATUS_FAILED: IngestStatus
INDEX_STATUS_UNSPECIFIED: IndexStatus
INDEX_STATUS_PENDING: IndexStatus
INDEX_STATUS_INDEXING: IndexStatus
INDEX_STATUS_INDEXED: IndexStatus
INDEX_STATUS_SKIPPED: IndexStatus
INDEX_STATUS_FAILED: IndexStatus
DOCUMENT_SLICE_STATE_UNSPECIFIED: DocumentSliceState
DOCUMENT_SLICE_STATE_READY: DocumentSliceState
DOCUMENT_SLICE_STATE_PROCESSING: DocumentSliceState
DOCUMENT_SLICE_STATE_FAILED: DocumentSliceState
STAGED_MEDIA_STATUS_UNSPECIFIED: StagedMediaStatus
STAGED_MEDIA_STATUS_STAGED: StagedMediaStatus
STAGED_MEDIA_STATUS_PUBLISHED: StagedMediaStatus
STAGED_MEDIA_STATUS_DISCARDED: StagedMediaStatus

class Document(_message.Message):
    __slots__ = ("id", "user_id", "workspace_id", "tenant_id", "conversation_id", "kind", "title", "filename", "mime_type", "editable_source", "content_markdown", "source_size", "source_mime_type", "asset_id", "source_revision_id", "source_sha256", "source_filename", "ingest_status", "ingest_progress", "ingest_error", "index_status", "index_error", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    EDITABLE_SOURCE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_MARKDOWN_FIELD_NUMBER: _ClassVar[int]
    SOURCE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SOURCE_MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_SHA256_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FILENAME_FIELD_NUMBER: _ClassVar[int]
    INGEST_STATUS_FIELD_NUMBER: _ClassVar[int]
    INGEST_PROGRESS_FIELD_NUMBER: _ClassVar[int]
    INGEST_ERROR_FIELD_NUMBER: _ClassVar[int]
    INDEX_STATUS_FIELD_NUMBER: _ClassVar[int]
    INDEX_ERROR_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    workspace_id: str
    tenant_id: str
    conversation_id: str
    kind: DocumentKind
    title: str
    filename: str
    mime_type: str
    editable_source: bool
    content_markdown: str
    source_size: int
    source_mime_type: str
    asset_id: str
    source_revision_id: str
    source_sha256: str
    source_filename: str
    ingest_status: IngestStatus
    ingest_progress: int
    ingest_error: str
    index_status: IndexStatus
    index_error: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., tenant_id: _Optional[str] = ..., conversation_id: _Optional[str] = ..., kind: _Optional[_Union[DocumentKind, str]] = ..., title: _Optional[str] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., editable_source: _Optional[bool] = ..., content_markdown: _Optional[str] = ..., source_size: _Optional[int] = ..., source_mime_type: _Optional[str] = ..., asset_id: _Optional[str] = ..., source_revision_id: _Optional[str] = ..., source_sha256: _Optional[str] = ..., source_filename: _Optional[str] = ..., ingest_status: _Optional[_Union[IngestStatus, str]] = ..., ingest_progress: _Optional[int] = ..., ingest_error: _Optional[str] = ..., index_status: _Optional[_Union[IndexStatus, str]] = ..., index_error: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListDocumentsRequest(_message.Message):
    __slots__ = ("actor", "conversation_id", "kind")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    conversation_id: str
    kind: DocumentKind
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., conversation_id: _Optional[str] = ..., kind: _Optional[_Union[DocumentKind, str]] = ...) -> None: ...

class ListDocumentsResponse(_message.Message):
    __slots__ = ("documents",)
    DOCUMENTS_FIELD_NUMBER: _ClassVar[int]
    documents: _containers.RepeatedCompositeFieldContainer[Document]
    def __init__(self, documents: _Optional[_Iterable[_Union[Document, _Mapping]]] = ...) -> None: ...

class GetDocumentRequest(_message.Message):
    __slots__ = ("actor", "document_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    document_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., document_id: _Optional[str] = ...) -> None: ...

class GetDocumentResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class GetWorkspaceDocumentRequest(_message.Message):
    __slots__ = ("actor", "document_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    document_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., document_id: _Optional[str] = ...) -> None: ...

class GetWorkspaceDocumentResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class GetDocumentSliceRequest(_message.Message):
    __slots__ = ("actor", "document_id", "start", "max_chars", "wait_millis")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    START_FIELD_NUMBER: _ClassVar[int]
    MAX_CHARS_FIELD_NUMBER: _ClassVar[int]
    WAIT_MILLIS_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    document_id: str
    start: int
    max_chars: int
    wait_millis: int
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., document_id: _Optional[str] = ..., start: _Optional[int] = ..., max_chars: _Optional[int] = ..., wait_millis: _Optional[int] = ...) -> None: ...

class DocumentSlice(_message.Message):
    __slots__ = ("id", "title", "filename", "mime_type", "content", "start", "total_chars", "next_start", "state", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    START_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CHARS_FIELD_NUMBER: _ClassVar[int]
    NEXT_START_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    filename: str
    mime_type: str
    content: str
    start: int
    total_chars: int
    next_start: int
    state: DocumentSliceState
    error: str
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., content: _Optional[str] = ..., start: _Optional[int] = ..., total_chars: _Optional[int] = ..., next_start: _Optional[int] = ..., state: _Optional[_Union[DocumentSliceState, str]] = ..., error: _Optional[str] = ...) -> None: ...

class GetDocumentSliceResponse(_message.Message):
    __slots__ = ("slice",)
    SLICE_FIELD_NUMBER: _ClassVar[int]
    slice: DocumentSlice
    def __init__(self, slice: _Optional[_Union[DocumentSlice, _Mapping]] = ...) -> None: ...

class UpdateArtifactRequest(_message.Message):
    __slots__ = ("actor", "document_id", "title", "filename", "content", "mime_type", "expected_updated_at")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    document_id: str
    title: str
    filename: str
    content: str
    mime_type: str
    expected_updated_at: _timestamp_pb2.Timestamp
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., document_id: _Optional[str] = ..., title: _Optional[str] = ..., filename: _Optional[str] = ..., content: _Optional[str] = ..., mime_type: _Optional[str] = ..., expected_updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class UpdateArtifactResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class DeleteDocumentRequest(_message.Message):
    __slots__ = ("actor", "document_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    document_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., document_id: _Optional[str] = ...) -> None: ...

class DeleteDocumentResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class CreateMediaDocumentRequest(_message.Message):
    __slots__ = ("actor", "conversation_id", "title", "asset_id", "revision_id", "idempotency_key")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    conversation_id: str
    title: str
    asset_id: str
    revision_id: str
    idempotency_key: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., conversation_id: _Optional[str] = ..., title: _Optional[str] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class CreateMediaDocumentResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class StagedMedia(_message.Message):
    __slots__ = ("id", "user_id", "workspace_id", "tenant_id", "conversation_id", "title", "filename", "mime_type", "size", "asset_id", "revision_id", "sha256", "status", "document_id", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    workspace_id: str
    tenant_id: str
    conversation_id: str
    title: str
    filename: str
    mime_type: str
    size: int
    asset_id: str
    revision_id: str
    sha256: str
    status: StagedMediaStatus
    document_id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., tenant_id: _Optional[str] = ..., conversation_id: _Optional[str] = ..., title: _Optional[str] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., size: _Optional[int] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., sha256: _Optional[str] = ..., status: _Optional[_Union[StagedMediaStatus, str]] = ..., document_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateStagedMediaRequest(_message.Message):
    __slots__ = ("actor", "conversation_id", "title", "asset_id", "revision_id", "idempotency_key")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    conversation_id: str
    title: str
    asset_id: str
    revision_id: str
    idempotency_key: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., conversation_id: _Optional[str] = ..., title: _Optional[str] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class CreateStagedMediaResponse(_message.Message):
    __slots__ = ("staged_media",)
    STAGED_MEDIA_FIELD_NUMBER: _ClassVar[int]
    staged_media: StagedMedia
    def __init__(self, staged_media: _Optional[_Union[StagedMedia, _Mapping]] = ...) -> None: ...

class GetStagedMediaRequest(_message.Message):
    __slots__ = ("actor", "staged_media_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    STAGED_MEDIA_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    staged_media_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., staged_media_id: _Optional[str] = ...) -> None: ...

class GetStagedMediaResponse(_message.Message):
    __slots__ = ("staged_media",)
    STAGED_MEDIA_FIELD_NUMBER: _ClassVar[int]
    staged_media: StagedMedia
    def __init__(self, staged_media: _Optional[_Union[StagedMedia, _Mapping]] = ...) -> None: ...

class PublishStagedMediaRequest(_message.Message):
    __slots__ = ("actor", "staged_media_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    STAGED_MEDIA_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    staged_media_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., staged_media_id: _Optional[str] = ...) -> None: ...

class PublishStagedMediaResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class DiscardStagedMediaRequest(_message.Message):
    __slots__ = ("actor", "staged_media_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    STAGED_MEDIA_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    staged_media_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., staged_media_id: _Optional[str] = ...) -> None: ...

class DiscardStagedMediaResponse(_message.Message):
    __slots__ = ("staged_media",)
    STAGED_MEDIA_FIELD_NUMBER: _ClassVar[int]
    staged_media: StagedMedia
    def __init__(self, staged_media: _Optional[_Union[StagedMedia, _Mapping]] = ...) -> None: ...

class CleanupArtifactsRequest(_message.Message):
    __slots__ = ("actor", "conversation_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    conversation_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., conversation_id: _Optional[str] = ...) -> None: ...

class CleanupArtifactsResponse(_message.Message):
    __slots__ = ("conversation_id", "deleted_documents", "deleted_generations", "deleted_staged_media", "released_asset_claims")
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    DELETED_DOCUMENTS_FIELD_NUMBER: _ClassVar[int]
    DELETED_GENERATIONS_FIELD_NUMBER: _ClassVar[int]
    DELETED_STAGED_MEDIA_FIELD_NUMBER: _ClassVar[int]
    RELEASED_ASSET_CLAIMS_FIELD_NUMBER: _ClassVar[int]
    conversation_id: str
    deleted_documents: int
    deleted_generations: int
    deleted_staged_media: int
    released_asset_claims: int
    def __init__(self, conversation_id: _Optional[str] = ..., deleted_documents: _Optional[int] = ..., deleted_generations: _Optional[int] = ..., deleted_staged_media: _Optional[int] = ..., released_asset_claims: _Optional[int] = ...) -> None: ...

class ForkDocumentsRequest(_message.Message):
    __slots__ = ("actor", "source_conversation_id", "conversation_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    SOURCE_CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    source_conversation_id: str
    conversation_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., source_conversation_id: _Optional[str] = ..., conversation_id: _Optional[str] = ...) -> None: ...

class ForkDocumentsResponse(_message.Message):
    __slots__ = ("document_ids",)
    class DocumentIdsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    document_ids: _containers.ScalarMap[str, str]
    def __init__(self, document_ids: _Optional[_Mapping[str, str]] = ...) -> None: ...

class RetrieveRequest(_message.Message):
    __slots__ = ("actor", "query", "top_k")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    TOP_K_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    query: str
    top_k: int
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., query: _Optional[str] = ..., top_k: _Optional[int] = ...) -> None: ...

class RetrievedChunk(_message.Message):
    __slots__ = ("document_id", "chunk_index", "content", "score", "title", "filename", "media_type")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    chunk_index: int
    content: str
    score: float
    title: str
    filename: str
    media_type: str
    def __init__(self, document_id: _Optional[str] = ..., chunk_index: _Optional[int] = ..., content: _Optional[str] = ..., score: _Optional[float] = ..., title: _Optional[str] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ...) -> None: ...

class RetrieveResponse(_message.Message):
    __slots__ = ("query", "chunks", "note")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    CHUNKS_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    query: str
    chunks: _containers.RepeatedCompositeFieldContainer[RetrievedChunk]
    note: str
    def __init__(self, query: _Optional[str] = ..., chunks: _Optional[_Iterable[_Union[RetrievedChunk, _Mapping]]] = ..., note: _Optional[str] = ...) -> None: ...
