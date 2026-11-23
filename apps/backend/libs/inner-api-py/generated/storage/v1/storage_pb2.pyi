import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ClaimKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CLAIM_KIND_UNSPECIFIED: _ClassVar[ClaimKind]
    CLAIM_KIND_STRONG: _ClassVar[ClaimKind]
    CLAIM_KIND_SNAPSHOT: _ClassVar[ClaimKind]
    CLAIM_KIND_LEASE: _ClassVar[ClaimKind]
    CLAIM_KIND_WEAK: _ClassVar[ClaimKind]

class ClaimStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CLAIM_STATUS_UNSPECIFIED: _ClassVar[ClaimStatus]
    CLAIM_STATUS_PENDING: _ClassVar[ClaimStatus]
    CLAIM_STATUS_ACTIVE: _ClassVar[ClaimStatus]
    CLAIM_STATUS_RELEASED: _ClassVar[ClaimStatus]

class UploadSessionState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    UPLOAD_SESSION_STATE_UNSPECIFIED: _ClassVar[UploadSessionState]
    UPLOAD_SESSION_STATE_PENDING: _ClassVar[UploadSessionState]
    UPLOAD_SESSION_STATE_UPLOADING: _ClassVar[UploadSessionState]
    UPLOAD_SESSION_STATE_COMPLETED: _ClassVar[UploadSessionState]
    UPLOAD_SESSION_STATE_FAILED: _ClassVar[UploadSessionState]
    UPLOAD_SESSION_STATE_ABORTED: _ClassVar[UploadSessionState]
CLAIM_KIND_UNSPECIFIED: ClaimKind
CLAIM_KIND_STRONG: ClaimKind
CLAIM_KIND_SNAPSHOT: ClaimKind
CLAIM_KIND_LEASE: ClaimKind
CLAIM_KIND_WEAK: ClaimKind
CLAIM_STATUS_UNSPECIFIED: ClaimStatus
CLAIM_STATUS_PENDING: ClaimStatus
CLAIM_STATUS_ACTIVE: ClaimStatus
CLAIM_STATUS_RELEASED: ClaimStatus
UPLOAD_SESSION_STATE_UNSPECIFIED: UploadSessionState
UPLOAD_SESSION_STATE_PENDING: UploadSessionState
UPLOAD_SESSION_STATE_UPLOADING: UploadSessionState
UPLOAD_SESSION_STATE_COMPLETED: UploadSessionState
UPLOAD_SESSION_STATE_FAILED: UploadSessionState
UPLOAD_SESSION_STATE_ABORTED: UploadSessionState

class UploadMetadata(_message.Message):
    __slots__ = ("filename", "media_type", "idempotency_key")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    filename: str
    media_type: str
    idempotency_key: str
    def __init__(self, filename: _Optional[str] = ..., media_type: _Optional[str] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class UploadRequest(_message.Message):
    __slots__ = ("metadata", "chunk")
    METADATA_FIELD_NUMBER: _ClassVar[int]
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    metadata: UploadMetadata
    chunk: bytes
    def __init__(self, metadata: _Optional[_Union[UploadMetadata, _Mapping]] = ..., chunk: _Optional[bytes] = ...) -> None: ...

class AppendRevisionMetadata(_message.Message):
    __slots__ = ("asset_id", "filename", "media_type", "idempotency_key", "base_revision_id", "owner_type", "owner_id", "slot", "generation")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    BASE_REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_TYPE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    SLOT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    filename: str
    media_type: str
    idempotency_key: str
    base_revision_id: str
    owner_type: str
    owner_id: str
    slot: str
    generation: int
    def __init__(self, asset_id: _Optional[str] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ..., idempotency_key: _Optional[str] = ..., base_revision_id: _Optional[str] = ..., owner_type: _Optional[str] = ..., owner_id: _Optional[str] = ..., slot: _Optional[str] = ..., generation: _Optional[int] = ...) -> None: ...

class AppendRevisionRequest(_message.Message):
    __slots__ = ("metadata", "chunk")
    METADATA_FIELD_NUMBER: _ClassVar[int]
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    metadata: AppendRevisionMetadata
    chunk: bytes
    def __init__(self, metadata: _Optional[_Union[AppendRevisionMetadata, _Mapping]] = ..., chunk: _Optional[bytes] = ...) -> None: ...

class UploadResult(_message.Message):
    __slots__ = ("asset_id", "revision_id", "filename", "media_type", "size_bytes", "sha256")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., sha256: _Optional[str] = ...) -> None: ...

class UploadResponse(_message.Message):
    __slots__ = ("result",)
    RESULT_FIELD_NUMBER: _ClassVar[int]
    result: UploadResult
    def __init__(self, result: _Optional[_Union[UploadResult, _Mapping]] = ...) -> None: ...

class AppendRevisionResponse(_message.Message):
    __slots__ = ("result",)
    RESULT_FIELD_NUMBER: _ClassVar[int]
    result: UploadResult
    def __init__(self, result: _Optional[_Union[UploadResult, _Mapping]] = ...) -> None: ...

class DescribeRevisionRequest(_message.Message):
    __slots__ = ("asset_id", "revision_id")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ...) -> None: ...

class RevisionMetadata(_message.Message):
    __slots__ = ("asset_id", "revision_id", "filename", "media_type", "size_bytes", "sha256")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., sha256: _Optional[str] = ...) -> None: ...

class DescribeRevisionResponse(_message.Message):
    __slots__ = ("revision",)
    REVISION_FIELD_NUMBER: _ClassVar[int]
    revision: RevisionMetadata
    def __init__(self, revision: _Optional[_Union[RevisionMetadata, _Mapping]] = ...) -> None: ...

class ReadContentRequest(_message.Message):
    __slots__ = ("asset_id", "revision_id", "offset", "limit")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    offset: int
    limit: int
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., offset: _Optional[int] = ..., limit: _Optional[int] = ...) -> None: ...

class ReadImageVariantRequest(_message.Message):
    __slots__ = ("asset_id", "revision_id", "max_dimension")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    MAX_DIMENSION_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    max_dimension: int
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., max_dimension: _Optional[int] = ...) -> None: ...

class ContentMetadata(_message.Message):
    __slots__ = ("filename", "media_type", "size_bytes", "sha256")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    filename: str
    media_type: str
    size_bytes: int
    sha256: str
    def __init__(self, filename: _Optional[str] = ..., media_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., sha256: _Optional[str] = ...) -> None: ...

class ContentChunk(_message.Message):
    __slots__ = ("metadata", "chunk")
    METADATA_FIELD_NUMBER: _ClassVar[int]
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    metadata: ContentMetadata
    chunk: bytes
    def __init__(self, metadata: _Optional[_Union[ContentMetadata, _Mapping]] = ..., chunk: _Optional[bytes] = ...) -> None: ...

class ReadContentResponse(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: ContentChunk
    def __init__(self, value: _Optional[_Union[ContentChunk, _Mapping]] = ...) -> None: ...

class ReadImageVariantResponse(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: ContentChunk
    def __init__(self, value: _Optional[_Union[ContentChunk, _Mapping]] = ...) -> None: ...

class Claim(_message.Message):
    __slots__ = ("claim_id", "asset_id", "revision_id", "kind", "status", "generation", "expires_at")
    CLAIM_ID_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    GENERATION_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    claim_id: str
    asset_id: str
    revision_id: str
    kind: ClaimKind
    status: ClaimStatus
    generation: int
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, claim_id: _Optional[str] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., kind: _Optional[_Union[ClaimKind, str]] = ..., status: _Optional[_Union[ClaimStatus, str]] = ..., generation: _Optional[int] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PrepareClaimRequest(_message.Message):
    __slots__ = ("owner_type", "owner_id", "slot", "generation", "asset_id", "revision_id", "kind", "expires_at")
    OWNER_TYPE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    SLOT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    owner_type: str
    owner_id: str
    slot: str
    generation: int
    asset_id: str
    revision_id: str
    kind: ClaimKind
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, owner_type: _Optional[str] = ..., owner_id: _Optional[str] = ..., slot: _Optional[str] = ..., generation: _Optional[int] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., kind: _Optional[_Union[ClaimKind, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ActivateClaimRequest(_message.Message):
    __slots__ = ("owner_type", "owner_id", "slot", "generation")
    OWNER_TYPE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    SLOT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_FIELD_NUMBER: _ClassVar[int]
    owner_type: str
    owner_id: str
    slot: str
    generation: int
    def __init__(self, owner_type: _Optional[str] = ..., owner_id: _Optional[str] = ..., slot: _Optional[str] = ..., generation: _Optional[int] = ...) -> None: ...

class ReleaseClaimRequest(_message.Message):
    __slots__ = ("owner_type", "owner_id", "slot", "generation")
    OWNER_TYPE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    SLOT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_FIELD_NUMBER: _ClassVar[int]
    owner_type: str
    owner_id: str
    slot: str
    generation: int
    def __init__(self, owner_type: _Optional[str] = ..., owner_id: _Optional[str] = ..., slot: _Optional[str] = ..., generation: _Optional[int] = ...) -> None: ...

class PrepareClaimResponse(_message.Message):
    __slots__ = ("claim",)
    CLAIM_FIELD_NUMBER: _ClassVar[int]
    claim: Claim
    def __init__(self, claim: _Optional[_Union[Claim, _Mapping]] = ...) -> None: ...

class ActivateClaimResponse(_message.Message):
    __slots__ = ("claim",)
    CLAIM_FIELD_NUMBER: _ClassVar[int]
    claim: Claim
    def __init__(self, claim: _Optional[_Union[Claim, _Mapping]] = ...) -> None: ...

class ReleaseClaimResponse(_message.Message):
    __slots__ = ("claim",)
    CLAIM_FIELD_NUMBER: _ClassVar[int]
    claim: Claim
    def __init__(self, claim: _Optional[_Union[Claim, _Mapping]] = ...) -> None: ...

class CreateUploadSessionRequest(_message.Message):
    __slots__ = ("intent_id", "filename", "media_type", "size_bytes")
    INTENT_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    intent_id: str
    filename: str
    media_type: str
    size_bytes: int
    def __init__(self, intent_id: _Optional[str] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class DescribeUploadSessionRequest(_message.Message):
    __slots__ = ("upload_session_id",)
    UPLOAD_SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    upload_session_id: str
    def __init__(self, upload_session_id: _Optional[str] = ...) -> None: ...

class UploadSession(_message.Message):
    __slots__ = ("upload_session_id", "intent_id", "state", "filename", "media_type", "size_bytes", "expires_at", "upload_url", "asset_id", "revision_id")
    UPLOAD_SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    INTENT_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    upload_session_id: str
    intent_id: str
    state: UploadSessionState
    filename: str
    media_type: str
    size_bytes: int
    expires_at: _timestamp_pb2.Timestamp
    upload_url: str
    asset_id: str
    revision_id: str
    def __init__(self, upload_session_id: _Optional[str] = ..., intent_id: _Optional[str] = ..., state: _Optional[_Union[UploadSessionState, str]] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., upload_url: _Optional[str] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ...) -> None: ...

class CreateUploadSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: UploadSession
    def __init__(self, session: _Optional[_Union[UploadSession, _Mapping]] = ...) -> None: ...

class DescribeUploadSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: UploadSession
    def __init__(self, session: _Optional[_Union[UploadSession, _Mapping]] = ...) -> None: ...

class DeliveryCapabilityItem(_message.Message):
    __slots__ = ("asset_id", "revision_id", "max_dimension")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    MAX_DIMENSION_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    max_dimension: int
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., max_dimension: _Optional[int] = ...) -> None: ...

class MintCapabilitiesRequest(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DeliveryCapabilityItem]
    def __init__(self, items: _Optional[_Iterable[_Union[DeliveryCapabilityItem, _Mapping]]] = ...) -> None: ...

class DeliveryCapability(_message.Message):
    __slots__ = ("asset_id", "revision_id", "url", "expires_at", "filename", "media_type", "size_bytes")
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    asset_id: str
    revision_id: str
    url: str
    expires_at: _timestamp_pb2.Timestamp
    filename: str
    media_type: str
    size_bytes: int
    def __init__(self, asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., filename: _Optional[str] = ..., media_type: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class MintCapabilitiesResponse(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[DeliveryCapability]
    def __init__(self, items: _Optional[_Iterable[_Union[DeliveryCapability, _Mapping]]] = ...) -> None: ...
