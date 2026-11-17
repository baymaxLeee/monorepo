import datetime

from common.v1 import context_pb2 as _context_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProviderKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PROVIDER_KIND_UNSPECIFIED: _ClassVar[ProviderKind]
    PROVIDER_KIND_CHAT: _ClassVar[ProviderKind]
    PROVIDER_KIND_IMAGE: _ClassVar[ProviderKind]
    PROVIDER_KIND_VIDEO: _ClassVar[ProviderKind]
    PROVIDER_KIND_EMBEDDING: _ClassVar[ProviderKind]
    PROVIDER_KIND_RERANK: _ClassVar[ProviderKind]

class ResponsesDialect(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RESPONSES_DIALECT_UNSPECIFIED: _ClassVar[ResponsesDialect]
    RESPONSES_DIALECT_OPENAI: _ClassVar[ResponsesDialect]
    RESPONSES_DIALECT_ARK: _ClassVar[ResponsesDialect]
    RESPONSES_DIALECT_DEEPSEEK: _ClassVar[ResponsesDialect]

class PricingUnit(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PRICING_UNIT_UNSPECIFIED: _ClassVar[PricingUnit]
    PRICING_UNIT_GENERATED_ITEM: _ClassVar[PricingUnit]
    PRICING_UNIT_GENERATED_SECOND: _ClassVar[PricingUnit]
PROVIDER_KIND_UNSPECIFIED: ProviderKind
PROVIDER_KIND_CHAT: ProviderKind
PROVIDER_KIND_IMAGE: ProviderKind
PROVIDER_KIND_VIDEO: ProviderKind
PROVIDER_KIND_EMBEDDING: ProviderKind
PROVIDER_KIND_RERANK: ProviderKind
RESPONSES_DIALECT_UNSPECIFIED: ResponsesDialect
RESPONSES_DIALECT_OPENAI: ResponsesDialect
RESPONSES_DIALECT_ARK: ResponsesDialect
RESPONSES_DIALECT_DEEPSEEK: ResponsesDialect
PRICING_UNIT_UNSPECIFIED: PricingUnit
PRICING_UNIT_GENERATED_ITEM: PricingUnit
PRICING_UNIT_GENERATED_SECOND: PricingUnit

class ProviderPricing(_message.Message):
    __slots__ = ("currency", "unit", "unit_price_micros")
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    UNIT_FIELD_NUMBER: _ClassVar[int]
    UNIT_PRICE_MICROS_FIELD_NUMBER: _ClassVar[int]
    currency: str
    unit: PricingUnit
    unit_price_micros: int
    def __init__(self, currency: _Optional[str] = ..., unit: _Optional[_Union[PricingUnit, str]] = ..., unit_price_micros: _Optional[int] = ...) -> None: ...

class ModelProvider(_message.Message):
    __slots__ = ("id", "user_id", "name", "model", "provider_kind", "responses_dialect", "base_url", "api_key", "extra_body", "pricing", "context_window", "max_output_tokens", "supports_image_input", "is_default", "is_enabled")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_KIND_FIELD_NUMBER: _ClassVar[int]
    RESPONSES_DIALECT_FIELD_NUMBER: _ClassVar[int]
    BASE_URL_FIELD_NUMBER: _ClassVar[int]
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    EXTRA_BODY_FIELD_NUMBER: _ClassVar[int]
    PRICING_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_FIELD_NUMBER: _ClassVar[int]
    MAX_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_IMAGE_INPUT_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    IS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    name: str
    model: str
    provider_kind: ProviderKind
    responses_dialect: ResponsesDialect
    base_url: str
    api_key: str
    extra_body: _struct_pb2.Struct
    pricing: ProviderPricing
    context_window: int
    max_output_tokens: int
    supports_image_input: bool
    is_default: bool
    is_enabled: bool
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., name: _Optional[str] = ..., model: _Optional[str] = ..., provider_kind: _Optional[_Union[ProviderKind, str]] = ..., responses_dialect: _Optional[_Union[ResponsesDialect, str]] = ..., base_url: _Optional[str] = ..., api_key: _Optional[str] = ..., extra_body: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., pricing: _Optional[_Union[ProviderPricing, _Mapping]] = ..., context_window: _Optional[int] = ..., max_output_tokens: _Optional[int] = ..., supports_image_input: _Optional[bool] = ..., is_default: _Optional[bool] = ..., is_enabled: _Optional[bool] = ...) -> None: ...

class ProviderCatalogItem(_message.Message):
    __slots__ = ("id", "name", "model", "provider_kind", "pricing", "is_default", "is_enabled")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_KIND_FIELD_NUMBER: _ClassVar[int]
    PRICING_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    IS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    model: str
    provider_kind: ProviderKind
    pricing: ProviderPricing
    is_default: bool
    is_enabled: bool
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., model: _Optional[str] = ..., provider_kind: _Optional[_Union[ProviderKind, str]] = ..., pricing: _Optional[_Union[ProviderPricing, _Mapping]] = ..., is_default: _Optional[bool] = ..., is_enabled: _Optional[bool] = ...) -> None: ...

class GetProviderRequest(_message.Message):
    __slots__ = ("actor", "provider_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    provider_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., provider_id: _Optional[str] = ...) -> None: ...

class GetProviderResponse(_message.Message):
    __slots__ = ("provider",)
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    provider: ModelProvider
    def __init__(self, provider: _Optional[_Union[ModelProvider, _Mapping]] = ...) -> None: ...

class GetDefaultProviderRequest(_message.Message):
    __slots__ = ("actor",)
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ...) -> None: ...

class GetDefaultProviderResponse(_message.Message):
    __slots__ = ("provider",)
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    provider: ModelProvider
    def __init__(self, provider: _Optional[_Union[ModelProvider, _Mapping]] = ...) -> None: ...

class GetProviderByKindRequest(_message.Message):
    __slots__ = ("actor", "kind")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    kind: ProviderKind
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., kind: _Optional[_Union[ProviderKind, str]] = ...) -> None: ...

class GetProviderByKindResponse(_message.Message):
    __slots__ = ("provider",)
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    provider: ModelProvider
    def __init__(self, provider: _Optional[_Union[ModelProvider, _Mapping]] = ...) -> None: ...

class GetTaskProviderRequest(_message.Message):
    __slots__ = ("actor", "provider_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    provider_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., provider_id: _Optional[str] = ...) -> None: ...

class GetTaskProviderResponse(_message.Message):
    __slots__ = ("provider",)
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    provider: ModelProvider
    def __init__(self, provider: _Optional[_Union[ModelProvider, _Mapping]] = ...) -> None: ...

class ListProviderCatalogRequest(_message.Message):
    __slots__ = ("actor",)
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ...) -> None: ...

class ListProviderCatalogResponse(_message.Message):
    __slots__ = ("providers",)
    PROVIDERS_FIELD_NUMBER: _ClassVar[int]
    providers: _containers.RepeatedCompositeFieldContainer[ProviderCatalogItem]
    def __init__(self, providers: _Optional[_Iterable[_Union[ProviderCatalogItem, _Mapping]]] = ...) -> None: ...

class AgentSkill(_message.Message):
    __slots__ = ("id", "name", "description")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    description: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class ResolvedAgent(_message.Message):
    __slots__ = ("id", "name", "role_description", "domain_description", "audience", "tone", "text_provider", "image_provider", "video_provider", "skills")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    TONE_FIELD_NUMBER: _ClassVar[int]
    TEXT_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    IMAGE_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    VIDEO_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    role_description: str
    domain_description: str
    audience: str
    tone: str
    text_provider: ModelProvider
    image_provider: ModelProvider
    video_provider: ModelProvider
    skills: _containers.RepeatedCompositeFieldContainer[AgentSkill]
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., role_description: _Optional[str] = ..., domain_description: _Optional[str] = ..., audience: _Optional[str] = ..., tone: _Optional[str] = ..., text_provider: _Optional[_Union[ModelProvider, _Mapping]] = ..., image_provider: _Optional[_Union[ModelProvider, _Mapping]] = ..., video_provider: _Optional[_Union[ModelProvider, _Mapping]] = ..., skills: _Optional[_Iterable[_Union[AgentSkill, _Mapping]]] = ...) -> None: ...

class GetResolvedAgentRequest(_message.Message):
    __slots__ = ("actor", "agent_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    agent_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., agent_id: _Optional[str] = ...) -> None: ...

class GetResolvedAgentResponse(_message.Message):
    __slots__ = ("agent",)
    AGENT_FIELD_NUMBER: _ClassVar[int]
    agent: ResolvedAgent
    def __init__(self, agent: _Optional[_Union[ResolvedAgent, _Mapping]] = ...) -> None: ...

class Skill(_message.Message):
    __slots__ = ("id", "name", "description", "body", "files")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    FILES_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    description: str
    body: str
    files: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., body: _Optional[str] = ..., files: _Optional[_Iterable[str]] = ...) -> None: ...

class SkillFile(_message.Message):
    __slots__ = ("path", "storage_kind", "mime_type", "content", "asset_id", "revision_id", "size_bytes", "sha256", "url")
    PATH_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KIND_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    path: str
    storage_kind: str
    mime_type: str
    content: str
    asset_id: str
    revision_id: str
    size_bytes: int
    sha256: str
    url: str
    def __init__(self, path: _Optional[str] = ..., storage_kind: _Optional[str] = ..., mime_type: _Optional[str] = ..., content: _Optional[str] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., size_bytes: _Optional[int] = ..., sha256: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...

class GetSkillRequest(_message.Message):
    __slots__ = ("actor", "skill_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    skill_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., skill_id: _Optional[str] = ...) -> None: ...

class GetSkillResponse(_message.Message):
    __slots__ = ("skill",)
    SKILL_FIELD_NUMBER: _ClassVar[int]
    skill: Skill
    def __init__(self, skill: _Optional[_Union[Skill, _Mapping]] = ...) -> None: ...

class GetSkillFileRequest(_message.Message):
    __slots__ = ("actor", "skill_id", "path")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    skill_id: str
    path: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., skill_id: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...

class GetSkillFileResponse(_message.Message):
    __slots__ = ("file",)
    FILE_FIELD_NUMBER: _ClassVar[int]
    file: SkillFile
    def __init__(self, file: _Optional[_Union[SkillFile, _Mapping]] = ...) -> None: ...

class CanvasModelSelection(_message.Message):
    __slots__ = ("provider_id", "parameters")
    PROVIDER_ID_FIELD_NUMBER: _ClassVar[int]
    PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    provider_id: str
    parameters: _struct_pb2.Struct
    def __init__(self, provider_id: _Optional[str] = ..., parameters: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class CanvasDefaults(_message.Message):
    __slots__ = ("inference", "image", "video")
    INFERENCE_FIELD_NUMBER: _ClassVar[int]
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    VIDEO_FIELD_NUMBER: _ClassVar[int]
    inference: CanvasModelSelection
    image: CanvasModelSelection
    video: CanvasModelSelection
    def __init__(self, inference: _Optional[_Union[CanvasModelSelection, _Mapping]] = ..., image: _Optional[_Union[CanvasModelSelection, _Mapping]] = ..., video: _Optional[_Union[CanvasModelSelection, _Mapping]] = ...) -> None: ...

class CanvasSettings(_message.Message):
    __slots__ = ("revision", "defaults")
    REVISION_FIELD_NUMBER: _ClassVar[int]
    DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    revision: int
    defaults: CanvasDefaults
    def __init__(self, revision: _Optional[int] = ..., defaults: _Optional[_Union[CanvasDefaults, _Mapping]] = ...) -> None: ...

class GetCanvasSettingsRequest(_message.Message):
    __slots__ = ("actor",)
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ...) -> None: ...

class GetCanvasSettingsResponse(_message.Message):
    __slots__ = ("settings",)
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    settings: CanvasSettings
    def __init__(self, settings: _Optional[_Union[CanvasSettings, _Mapping]] = ...) -> None: ...

class BenefitPackage(_message.Message):
    __slots__ = ("id", "is_preset", "name", "project_name", "has_access_key_id", "has_secret_access_key", "enabled", "model_ids", "material_used", "material_reserved", "material_limit", "revision", "created_by", "updated_by", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    IS_PRESET_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROJECT_NAME_FIELD_NUMBER: _ClassVar[int]
    HAS_ACCESS_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    HAS_SECRET_ACCESS_KEY_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    MODEL_IDS_FIELD_NUMBER: _ClassVar[int]
    MATERIAL_USED_FIELD_NUMBER: _ClassVar[int]
    MATERIAL_RESERVED_FIELD_NUMBER: _ClassVar[int]
    MATERIAL_LIMIT_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    UPDATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    is_preset: bool
    name: str
    project_name: str
    has_access_key_id: bool
    has_secret_access_key: bool
    enabled: bool
    model_ids: _containers.RepeatedScalarFieldContainer[str]
    material_used: int
    material_reserved: int
    material_limit: int
    revision: int
    created_by: str
    updated_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., is_preset: _Optional[bool] = ..., name: _Optional[str] = ..., project_name: _Optional[str] = ..., has_access_key_id: _Optional[bool] = ..., has_secret_access_key: _Optional[bool] = ..., enabled: _Optional[bool] = ..., model_ids: _Optional[_Iterable[str]] = ..., material_used: _Optional[int] = ..., material_reserved: _Optional[int] = ..., material_limit: _Optional[int] = ..., revision: _Optional[int] = ..., created_by: _Optional[str] = ..., updated_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListAvailableBenefitPackagesRequest(_message.Message):
    __slots__ = ("actor",)
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ...) -> None: ...

class ListAvailableBenefitPackagesResponse(_message.Message):
    __slots__ = ("packages",)
    PACKAGES_FIELD_NUMBER: _ClassVar[int]
    packages: _containers.RepeatedCompositeFieldContainer[BenefitPackage]
    def __init__(self, packages: _Optional[_Iterable[_Union[BenefitPackage, _Mapping]]] = ...) -> None: ...

class ReviewReservation(_message.Message):
    __slots__ = ("id", "status")
    ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    id: str
    status: str
    def __init__(self, id: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class ReserveReviewResponse(_message.Message):
    __slots__ = ("reservation",)
    RESERVATION_FIELD_NUMBER: _ClassVar[int]
    reservation: ReviewReservation
    def __init__(self, reservation: _Optional[_Union[ReviewReservation, _Mapping]] = ...) -> None: ...

class ReserveReviewRequest(_message.Message):
    __slots__ = ("actor", "package_id", "reservation_id", "project_id", "asset_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    reservation_id: str
    project_id: str
    asset_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., reservation_id: _Optional[str] = ..., project_id: _Optional[str] = ..., asset_id: _Optional[str] = ...) -> None: ...

class TransitionReviewRequest(_message.Message):
    __slots__ = ("actor", "package_id", "reservation_id", "status")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    reservation_id: str
    status: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., reservation_id: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class TransitionReviewResponse(_message.Message):
    __slots__ = ("reservation",)
    RESERVATION_FIELD_NUMBER: _ClassVar[int]
    reservation: ReviewReservation
    def __init__(self, reservation: _Optional[_Union[ReviewReservation, _Mapping]] = ...) -> None: ...

class ReviewCleanup(_message.Message):
    __slots__ = ("cleanup_id", "reservation_id", "status")
    CLEANUP_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    cleanup_id: str
    reservation_id: str
    status: str
    def __init__(self, cleanup_id: _Optional[str] = ..., reservation_id: _Optional[str] = ..., status: _Optional[str] = ...) -> None: ...

class BeginReviewCleanupResponse(_message.Message):
    __slots__ = ("cleanup",)
    CLEANUP_FIELD_NUMBER: _ClassVar[int]
    cleanup: ReviewCleanup
    def __init__(self, cleanup: _Optional[_Union[ReviewCleanup, _Mapping]] = ...) -> None: ...

class BeginReviewCleanupRequest(_message.Message):
    __slots__ = ("actor", "package_id", "reservation_id", "cleanup_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    CLEANUP_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    reservation_id: str
    cleanup_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., reservation_id: _Optional[str] = ..., cleanup_id: _Optional[str] = ...) -> None: ...

class CompleteReviewCleanupRequest(_message.Message):
    __slots__ = ("actor", "package_id", "reservation_id", "cleanup_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    CLEANUP_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    reservation_id: str
    cleanup_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., reservation_id: _Optional[str] = ..., cleanup_id: _Optional[str] = ...) -> None: ...

class CompleteReviewCleanupResponse(_message.Message):
    __slots__ = ("cleanup",)
    CLEANUP_FIELD_NUMBER: _ClassVar[int]
    cleanup: ReviewCleanup
    def __init__(self, cleanup: _Optional[_Union[ReviewCleanup, _Mapping]] = ...) -> None: ...

class ReviewedAsset(_message.Message):
    __slots__ = ("id", "status", "failure_reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    FAILURE_REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    status: str
    failure_reason: str
    def __init__(self, id: _Optional[str] = ..., status: _Optional[str] = ..., failure_reason: _Optional[str] = ...) -> None: ...

class SubmitReviewedAssetRequest(_message.Message):
    __slots__ = ("actor", "package_id", "url", "asset_type", "name")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    ASSET_TYPE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    url: str
    asset_type: str
    name: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., url: _Optional[str] = ..., asset_type: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class SubmitReviewedAssetResponse(_message.Message):
    __slots__ = ("asset",)
    ASSET_FIELD_NUMBER: _ClassVar[int]
    asset: ReviewedAsset
    def __init__(self, asset: _Optional[_Union[ReviewedAsset, _Mapping]] = ...) -> None: ...

class GetReviewedAssetRequest(_message.Message):
    __slots__ = ("actor", "package_id", "asset_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    asset_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., asset_id: _Optional[str] = ...) -> None: ...

class GetReviewedAssetResponse(_message.Message):
    __slots__ = ("asset",)
    ASSET_FIELD_NUMBER: _ClassVar[int]
    asset: ReviewedAsset
    def __init__(self, asset: _Optional[_Union[ReviewedAsset, _Mapping]] = ...) -> None: ...

class DeleteReviewedAssetRequest(_message.Message):
    __slots__ = ("actor", "package_id", "asset_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    package_id: str
    asset_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., package_id: _Optional[str] = ..., asset_id: _Optional[str] = ...) -> None: ...

class DeleteReviewedAssetResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
