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

class SkillSummary(_message.Message):
    __slots__ = ("id", "name", "description")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    description: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class ListSkillsRequest(_message.Message):
    __slots__ = ("actor",)
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ...) -> None: ...

class ListSkillsResponse(_message.Message):
    __slots__ = ("skills",)
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    skills: _containers.RepeatedCompositeFieldContainer[SkillSummary]
    def __init__(self, skills: _Optional[_Iterable[_Union[SkillSummary, _Mapping]]] = ...) -> None: ...

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

class ListAgentPluginsRequest(_message.Message):
    __slots__ = ("actor",)
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ...) -> None: ...

class ListAgentPluginsResponse(_message.Message):
    __slots__ = ("plugins",)
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    plugins: _containers.RepeatedCompositeFieldContainer[AgentPluginCatalogItem]
    def __init__(self, plugins: _Optional[_Iterable[_Union[AgentPluginCatalogItem, _Mapping]]] = ...) -> None: ...

class AgentPluginCatalogItem(_message.Message):
    __slots__ = ("plugin_id", "display_name", "description", "source", "trust", "install_policy", "availability", "installed", "enabled", "state_revision", "latest_release")
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    TRUST_FIELD_NUMBER: _ClassVar[int]
    INSTALL_POLICY_FIELD_NUMBER: _ClassVar[int]
    AVAILABILITY_FIELD_NUMBER: _ClassVar[int]
    INSTALLED_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    STATE_REVISION_FIELD_NUMBER: _ClassVar[int]
    LATEST_RELEASE_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    display_name: str
    description: str
    source: str
    trust: str
    install_policy: str
    availability: str
    installed: bool
    enabled: bool
    state_revision: int
    latest_release: AgentPluginManifest
    def __init__(self, plugin_id: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., source: _Optional[str] = ..., trust: _Optional[str] = ..., install_policy: _Optional[str] = ..., availability: _Optional[str] = ..., installed: _Optional[bool] = ..., enabled: _Optional[bool] = ..., state_revision: _Optional[int] = ..., latest_release: _Optional[_Union[AgentPluginManifest, _Mapping]] = ...) -> None: ...

class AgentPluginActivation(_message.Message):
    __slots__ = ("plugin_id", "bindings")
    class BindingsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    BINDINGS_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    bindings: _containers.ScalarMap[str, str]
    def __init__(self, plugin_id: _Optional[str] = ..., bindings: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ResolveAgentPluginsRequest(_message.Message):
    __slots__ = ("actor", "activations", "workspace_role")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    ACTIVATIONS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ROLE_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    activations: _containers.RepeatedCompositeFieldContainer[AgentPluginActivation]
    workspace_role: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., activations: _Optional[_Iterable[_Union[AgentPluginActivation, _Mapping]]] = ..., workspace_role: _Optional[str] = ...) -> None: ...

class AgentPluginToolPolicy(_message.Message):
    __slots__ = ("capability", "callable_by_code_mode", "effect", "trust", "execution", "source_projection", "streaming", "ui_kind")
    CAPABILITY_FIELD_NUMBER: _ClassVar[int]
    CALLABLE_BY_CODE_MODE_FIELD_NUMBER: _ClassVar[int]
    EFFECT_FIELD_NUMBER: _ClassVar[int]
    TRUST_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_FIELD_NUMBER: _ClassVar[int]
    SOURCE_PROJECTION_FIELD_NUMBER: _ClassVar[int]
    STREAMING_FIELD_NUMBER: _ClassVar[int]
    UI_KIND_FIELD_NUMBER: _ClassVar[int]
    capability: str
    callable_by_code_mode: bool
    effect: str
    trust: str
    execution: str
    source_projection: _struct_pb2.Struct
    streaming: bool
    ui_kind: str
    def __init__(self, capability: _Optional[str] = ..., callable_by_code_mode: _Optional[bool] = ..., effect: _Optional[str] = ..., trust: _Optional[str] = ..., execution: _Optional[str] = ..., source_projection: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., streaming: _Optional[bool] = ..., ui_kind: _Optional[str] = ...) -> None: ...

class AgentPluginToolPlanning(_message.Message):
    __slots__ = ("summary", "constraints", "prerequisites", "parallelizable")
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    CONSTRAINTS_FIELD_NUMBER: _ClassVar[int]
    PREREQUISITES_FIELD_NUMBER: _ClassVar[int]
    PARALLELIZABLE_FIELD_NUMBER: _ClassVar[int]
    summary: str
    constraints: _containers.RepeatedScalarFieldContainer[str]
    prerequisites: _containers.RepeatedScalarFieldContainer[str]
    parallelizable: bool
    def __init__(self, summary: _Optional[str] = ..., constraints: _Optional[_Iterable[str]] = ..., prerequisites: _Optional[_Iterable[str]] = ..., parallelizable: _Optional[bool] = ...) -> None: ...

class AgentPluginMCPTool(_message.Message):
    __slots__ = ("name", "description", "input_schema", "output_schema", "policy", "planning")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INPUT_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    POLICY_FIELD_NUMBER: _ClassVar[int]
    PLANNING_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    input_schema: _struct_pb2.Struct
    output_schema: _struct_pb2.Struct
    policy: AgentPluginToolPolicy
    planning: AgentPluginToolPlanning
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., input_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., output_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., policy: _Optional[_Union[AgentPluginToolPolicy, _Mapping]] = ..., planning: _Optional[_Union[AgentPluginToolPlanning, _Mapping]] = ...) -> None: ...

class AgentPluginMCPServer(_message.Message):
    __slots__ = ("name", "url", "required_bindings", "optional_bindings", "tools")
    NAME_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_BINDINGS_FIELD_NUMBER: _ClassVar[int]
    OPTIONAL_BINDINGS_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    name: str
    url: str
    required_bindings: _containers.RepeatedScalarFieldContainer[str]
    optional_bindings: _containers.RepeatedScalarFieldContainer[str]
    tools: _containers.RepeatedCompositeFieldContainer[AgentPluginMCPTool]
    def __init__(self, name: _Optional[str] = ..., url: _Optional[str] = ..., required_bindings: _Optional[_Iterable[str]] = ..., optional_bindings: _Optional[_Iterable[str]] = ..., tools: _Optional[_Iterable[_Union[AgentPluginMCPTool, _Mapping]]] = ...) -> None: ...

class AgentPluginSkillContribution(_message.Message):
    __slots__ = ("id", "name", "description", "asset_id", "revision_id", "sha256")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    description: str
    asset_id: str
    revision_id: str
    sha256: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., asset_id: _Optional[str] = ..., revision_id: _Optional[str] = ..., sha256: _Optional[str] = ...) -> None: ...

class AgentPluginManifest(_message.Message):
    __slots__ = ("schema_version", "plugin_id", "version", "digest", "display_name", "description", "source", "trust", "mcp_servers", "skills")
    SCHEMA_VERSION_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    TRUST_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    schema_version: int
    plugin_id: str
    version: str
    digest: str
    display_name: str
    description: str
    source: str
    trust: str
    mcp_servers: _containers.RepeatedCompositeFieldContainer[AgentPluginMCPServer]
    skills: _containers.RepeatedCompositeFieldContainer[AgentPluginSkillContribution]
    def __init__(self, schema_version: _Optional[int] = ..., plugin_id: _Optional[str] = ..., version: _Optional[str] = ..., digest: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., source: _Optional[str] = ..., trust: _Optional[str] = ..., mcp_servers: _Optional[_Iterable[_Union[AgentPluginMCPServer, _Mapping]]] = ..., skills: _Optional[_Iterable[_Union[AgentPluginSkillContribution, _Mapping]]] = ...) -> None: ...

class ResolvedAgentPlugin(_message.Message):
    __slots__ = ("manifest", "activation")
    MANIFEST_FIELD_NUMBER: _ClassVar[int]
    ACTIVATION_FIELD_NUMBER: _ClassVar[int]
    manifest: AgentPluginManifest
    activation: AgentPluginActivation
    def __init__(self, manifest: _Optional[_Union[AgentPluginManifest, _Mapping]] = ..., activation: _Optional[_Union[AgentPluginActivation, _Mapping]] = ...) -> None: ...

class AgentPluginConnectionGrant(_message.Message):
    __slots__ = ("plugin_id", "server_name", "headers", "expires_at")
    class HeadersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    SERVER_NAME_FIELD_NUMBER: _ClassVar[int]
    HEADERS_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    server_name: str
    headers: _containers.ScalarMap[str, str]
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, plugin_id: _Optional[str] = ..., server_name: _Optional[str] = ..., headers: _Optional[_Mapping[str, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ResolvedAgentPluginSnapshot(_message.Message):
    __slots__ = ("schema_version", "snapshot_id", "snapshot_digest", "workspace_revision", "tenant_id", "workspace_id", "resolved_at", "plugins", "connection_grants")
    SCHEMA_VERSION_FIELD_NUMBER: _ClassVar[int]
    SNAPSHOT_ID_FIELD_NUMBER: _ClassVar[int]
    SNAPSHOT_DIGEST_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_REVISION_FIELD_NUMBER: _ClassVar[int]
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_AT_FIELD_NUMBER: _ClassVar[int]
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_GRANTS_FIELD_NUMBER: _ClassVar[int]
    schema_version: int
    snapshot_id: str
    snapshot_digest: str
    workspace_revision: int
    tenant_id: str
    workspace_id: str
    resolved_at: _timestamp_pb2.Timestamp
    plugins: _containers.RepeatedCompositeFieldContainer[ResolvedAgentPlugin]
    connection_grants: _containers.RepeatedCompositeFieldContainer[AgentPluginConnectionGrant]
    def __init__(self, schema_version: _Optional[int] = ..., snapshot_id: _Optional[str] = ..., snapshot_digest: _Optional[str] = ..., workspace_revision: _Optional[int] = ..., tenant_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., resolved_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., plugins: _Optional[_Iterable[_Union[ResolvedAgentPlugin, _Mapping]]] = ..., connection_grants: _Optional[_Iterable[_Union[AgentPluginConnectionGrant, _Mapping]]] = ...) -> None: ...

class ResolveAgentPluginsResponse(_message.Message):
    __slots__ = ("snapshot",)
    SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    snapshot: ResolvedAgentPluginSnapshot
    def __init__(self, snapshot: _Optional[_Union[ResolvedAgentPluginSnapshot, _Mapping]] = ...) -> None: ...

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
