from common.v1 import context_pb2 as _context_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetGraphRequest(_message.Message):
    __slots__ = ("actor", "workspace_role", "project_id", "canvas_id")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ROLE_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    workspace_role: str
    project_id: str
    canvas_id: str
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., workspace_role: _Optional[str] = ..., project_id: _Optional[str] = ..., canvas_id: _Optional[str] = ...) -> None: ...

class GetGraphResponse(_message.Message):
    __slots__ = ("graph",)
    GRAPH_FIELD_NUMBER: _ClassVar[int]
    graph: CanvasGraph
    def __init__(self, graph: _Optional[_Union[CanvasGraph, _Mapping]] = ...) -> None: ...

class CanvasGraph(_message.Message):
    __slots__ = ("archives", "canvas", "cursor", "nodes", "protected_node_ids", "tasks", "texts")
    ARCHIVES_FIELD_NUMBER: _ClassVar[int]
    CANVAS_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    NODES_FIELD_NUMBER: _ClassVar[int]
    PROTECTED_NODE_IDS_FIELD_NUMBER: _ClassVar[int]
    TASKS_FIELD_NUMBER: _ClassVar[int]
    TEXTS_FIELD_NUMBER: _ClassVar[int]
    archives: _containers.RepeatedCompositeFieldContainer[CanvasVideoArchiveExport]
    canvas: CanvasSummary
    cursor: int
    nodes: _containers.RepeatedCompositeFieldContainer[CanvasNode]
    protected_node_ids: _containers.RepeatedScalarFieldContainer[str]
    tasks: _containers.RepeatedCompositeFieldContainer[CanvasTask]
    texts: _containers.RepeatedCompositeFieldContainer[CanvasTextCheckpoint]
    def __init__(self, archives: _Optional[_Iterable[_Union[CanvasVideoArchiveExport, _Mapping]]] = ..., canvas: _Optional[_Union[CanvasSummary, _Mapping]] = ..., cursor: _Optional[int] = ..., nodes: _Optional[_Iterable[_Union[CanvasNode, _Mapping]]] = ..., protected_node_ids: _Optional[_Iterable[str]] = ..., tasks: _Optional[_Iterable[_Union[CanvasTask, _Mapping]]] = ..., texts: _Optional[_Iterable[_Union[CanvasTextCheckpoint, _Mapping]]] = ...) -> None: ...

class CanvasVideoArchiveExport(_message.Message):
    __slots__ = ("canvas_id", "created_at", "error_code", "error_message", "finished_at", "input_count", "output_filename", "output_size", "path", "project_id", "retention_guaranteed_until", "started_at", "status", "task_run_id")
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_CODE_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FINISHED_AT_FIELD_NUMBER: _ClassVar[int]
    INPUT_COUNT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FILENAME_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_SIZE_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    RETENTION_GUARANTEED_UNTIL_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    canvas_id: str
    created_at: str
    error_code: str
    error_message: str
    finished_at: str
    input_count: int
    output_filename: str
    output_size: int
    path: str
    project_id: str
    retention_guaranteed_until: str
    started_at: str
    status: int
    task_run_id: str
    def __init__(self, canvas_id: _Optional[str] = ..., created_at: _Optional[str] = ..., error_code: _Optional[str] = ..., error_message: _Optional[str] = ..., finished_at: _Optional[str] = ..., input_count: _Optional[int] = ..., output_filename: _Optional[str] = ..., output_size: _Optional[int] = ..., path: _Optional[str] = ..., project_id: _Optional[str] = ..., retention_guaranteed_until: _Optional[str] = ..., started_at: _Optional[str] = ..., status: _Optional[int] = ..., task_run_id: _Optional[str] = ...) -> None: ...

class CanvasSummary(_message.Message):
    __slots__ = ("canvas_id", "cover_image_asset_id", "cover_image_revision_id", "cover_image_url", "created_at", "created_by", "default_view", "fallback_cover_image_url", "name", "project_id", "revision", "stats", "updated_at")
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    COVER_IMAGE_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    COVER_IMAGE_REVISION_ID_FIELD_NUMBER: _ClassVar[int]
    COVER_IMAGE_URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VIEW_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_COVER_IMAGE_URL_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    STATS_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    canvas_id: str
    cover_image_asset_id: str
    cover_image_revision_id: str
    cover_image_url: str
    created_at: str
    created_by: str
    default_view: int
    fallback_cover_image_url: str
    name: str
    project_id: str
    revision: int
    stats: CanvasStats
    updated_at: str
    def __init__(self, canvas_id: _Optional[str] = ..., cover_image_asset_id: _Optional[str] = ..., cover_image_revision_id: _Optional[str] = ..., cover_image_url: _Optional[str] = ..., created_at: _Optional[str] = ..., created_by: _Optional[str] = ..., default_view: _Optional[int] = ..., fallback_cover_image_url: _Optional[str] = ..., name: _Optional[str] = ..., project_id: _Optional[str] = ..., revision: _Optional[int] = ..., stats: _Optional[_Union[CanvasStats, _Mapping]] = ..., updated_at: _Optional[str] = ...) -> None: ...

class CanvasStats(_message.Message):
    __slots__ = ("canvas_node_count", "selected_video_duration_millis")
    CANVAS_NODE_COUNT_FIELD_NUMBER: _ClassVar[int]
    SELECTED_VIDEO_DURATION_MILLIS_FIELD_NUMBER: _ClassVar[int]
    canvas_node_count: int
    selected_video_duration_millis: int
    def __init__(self, canvas_node_count: _Optional[int] = ..., selected_video_duration_millis: _Optional[int] = ...) -> None: ...

class CanvasNode(_message.Message):
    __slots__ = ("active_task_run_id", "active_task_type", "asset_id", "canvas_id", "canvas_node_no", "created_at", "created_by", "current_asset_id", "draft_session", "first_frame_asset_id", "first_frame_url", "generation_config", "incoming_edges", "last_frame_asset_id", "latest_generation_failure", "name", "node_id", "position", "preview_url", "prompt", "reference_status", "reference_type", "resource_asset_id", "resource_asset_is_primary", "resource_asset_revision", "resource_id", "reviews", "revision", "selected_asset_id", "selected_output_duration_seconds", "selected_output_id", "selected_output_text", "selected_output_url", "status", "storyboard_rank", "text", "type", "updated_at", "updated_by", "video_input_mode")
    ACTIVE_TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    CANVAS_NODE_NO_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CURRENT_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_SESSION_FIELD_NUMBER: _ClassVar[int]
    FIRST_FRAME_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    FIRST_FRAME_URL_FIELD_NUMBER: _ClassVar[int]
    GENERATION_CONFIG_FIELD_NUMBER: _ClassVar[int]
    INCOMING_EDGES_FIELD_NUMBER: _ClassVar[int]
    LAST_FRAME_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    LATEST_GENERATION_FAILURE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    POSITION_FIELD_NUMBER: _ClassVar[int]
    PREVIEW_URL_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    REFERENCE_STATUS_FIELD_NUMBER: _ClassVar[int]
    REFERENCE_TYPE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ASSET_IS_PRIMARY_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ASSET_REVISION_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    REVIEWS_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    SELECTED_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    SELECTED_OUTPUT_DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    SELECTED_OUTPUT_ID_FIELD_NUMBER: _ClassVar[int]
    SELECTED_OUTPUT_TEXT_FIELD_NUMBER: _ClassVar[int]
    SELECTED_OUTPUT_URL_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STORYBOARD_RANK_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_BY_FIELD_NUMBER: _ClassVar[int]
    VIDEO_INPUT_MODE_FIELD_NUMBER: _ClassVar[int]
    active_task_run_id: str
    active_task_type: int
    asset_id: str
    canvas_id: str
    canvas_node_no: int
    created_at: str
    created_by: str
    current_asset_id: str
    draft_session: CanvasNodeDraftSession
    first_frame_asset_id: str
    first_frame_url: str
    generation_config: GenerationConfig
    incoming_edges: _containers.RepeatedCompositeFieldContainer[CanvasEdge]
    last_frame_asset_id: str
    latest_generation_failure: GenerationFailure
    name: str
    node_id: str
    position: Position
    preview_url: str
    prompt: str
    reference_status: int
    reference_type: int
    resource_asset_id: str
    resource_asset_is_primary: bool
    resource_asset_revision: int
    resource_id: str
    reviews: _containers.RepeatedCompositeFieldContainer[AssetReview]
    revision: int
    selected_asset_id: str
    selected_output_duration_seconds: int
    selected_output_id: str
    selected_output_text: str
    selected_output_url: str
    status: int
    storyboard_rank: int
    text: str
    type: int
    updated_at: str
    updated_by: str
    video_input_mode: int
    def __init__(self, active_task_run_id: _Optional[str] = ..., active_task_type: _Optional[int] = ..., asset_id: _Optional[str] = ..., canvas_id: _Optional[str] = ..., canvas_node_no: _Optional[int] = ..., created_at: _Optional[str] = ..., created_by: _Optional[str] = ..., current_asset_id: _Optional[str] = ..., draft_session: _Optional[_Union[CanvasNodeDraftSession, _Mapping]] = ..., first_frame_asset_id: _Optional[str] = ..., first_frame_url: _Optional[str] = ..., generation_config: _Optional[_Union[GenerationConfig, _Mapping]] = ..., incoming_edges: _Optional[_Iterable[_Union[CanvasEdge, _Mapping]]] = ..., last_frame_asset_id: _Optional[str] = ..., latest_generation_failure: _Optional[_Union[GenerationFailure, _Mapping]] = ..., name: _Optional[str] = ..., node_id: _Optional[str] = ..., position: _Optional[_Union[Position, _Mapping]] = ..., preview_url: _Optional[str] = ..., prompt: _Optional[str] = ..., reference_status: _Optional[int] = ..., reference_type: _Optional[int] = ..., resource_asset_id: _Optional[str] = ..., resource_asset_is_primary: _Optional[bool] = ..., resource_asset_revision: _Optional[int] = ..., resource_id: _Optional[str] = ..., reviews: _Optional[_Iterable[_Union[AssetReview, _Mapping]]] = ..., revision: _Optional[int] = ..., selected_asset_id: _Optional[str] = ..., selected_output_duration_seconds: _Optional[int] = ..., selected_output_id: _Optional[str] = ..., selected_output_text: _Optional[str] = ..., selected_output_url: _Optional[str] = ..., status: _Optional[int] = ..., storyboard_rank: _Optional[int] = ..., text: _Optional[str] = ..., type: _Optional[int] = ..., updated_at: _Optional[str] = ..., updated_by: _Optional[str] = ..., video_input_mode: _Optional[int] = ...) -> None: ...

class Position(_message.Message):
    __slots__ = ("position_x", "position_y")
    POSITION_X_FIELD_NUMBER: _ClassVar[int]
    POSITION_Y_FIELD_NUMBER: _ClassVar[int]
    position_x: float
    position_y: float
    def __init__(self, position_x: _Optional[float] = ..., position_y: _Optional[float] = ...) -> None: ...

class GenerationConfig(_message.Message):
    __slots__ = ("model_service_id", "resolution", "aspect_ratio", "duration_seconds", "generate_audio", "watermark")
    MODEL_SERVICE_ID_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    ASPECT_RATIO_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    GENERATE_AUDIO_FIELD_NUMBER: _ClassVar[int]
    WATERMARK_FIELD_NUMBER: _ClassVar[int]
    model_service_id: str
    resolution: int
    aspect_ratio: int
    duration_seconds: int
    generate_audio: bool
    watermark: bool
    def __init__(self, model_service_id: _Optional[str] = ..., resolution: _Optional[int] = ..., aspect_ratio: _Optional[int] = ..., duration_seconds: _Optional[int] = ..., generate_audio: _Optional[bool] = ..., watermark: _Optional[bool] = ...) -> None: ...

class CanvasEdge(_message.Message):
    __slots__ = ("edge_id", "source_node_id", "source_port", "target_order", "target_port")
    EDGE_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_NODE_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_PORT_FIELD_NUMBER: _ClassVar[int]
    TARGET_ORDER_FIELD_NUMBER: _ClassVar[int]
    TARGET_PORT_FIELD_NUMBER: _ClassVar[int]
    edge_id: str
    source_node_id: str
    source_port: int
    target_order: int
    target_port: int
    def __init__(self, edge_id: _Optional[str] = ..., source_node_id: _Optional[str] = ..., source_port: _Optional[int] = ..., target_order: _Optional[int] = ..., target_port: _Optional[int] = ...) -> None: ...

class GenerationFailure(_message.Message):
    __slots__ = ("error_code", "error_message", "seedance_task_id", "task_run_id")
    ERROR_CODE_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SEEDANCE_TASK_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    error_code: str
    error_message: str
    seedance_task_id: str
    task_run_id: str
    def __init__(self, error_code: _Optional[str] = ..., error_message: _Optional[str] = ..., seedance_task_id: _Optional[str] = ..., task_run_id: _Optional[str] = ...) -> None: ...

class AssetReview(_message.Message):
    __slots__ = ("failure_reason", "package_id", "package_name", "status", "submitted_at", "updated_at")
    FAILURE_REASON_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_ID_FIELD_NUMBER: _ClassVar[int]
    PACKAGE_NAME_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SUBMITTED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    failure_reason: str
    package_id: str
    package_name: str
    status: int
    submitted_at: str
    updated_at: str
    def __init__(self, failure_reason: _Optional[str] = ..., package_id: _Optional[str] = ..., package_name: _Optional[str] = ..., status: _Optional[int] = ..., submitted_at: _Optional[str] = ..., updated_at: _Optional[str] = ...) -> None: ...

class CanvasTask(_message.Message):
    __slots__ = ("error_code", "error_message", "node_id", "seedance_task_id", "status", "task_run_id", "task_type", "video_provider_status")
    ERROR_CODE_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    SEEDANCE_TASK_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    VIDEO_PROVIDER_STATUS_FIELD_NUMBER: _ClassVar[int]
    error_code: str
    error_message: str
    node_id: str
    seedance_task_id: str
    status: int
    task_run_id: str
    task_type: int
    video_provider_status: int
    def __init__(self, error_code: _Optional[str] = ..., error_message: _Optional[str] = ..., node_id: _Optional[str] = ..., seedance_task_id: _Optional[str] = ..., status: _Optional[int] = ..., task_run_id: _Optional[str] = ..., task_type: _Optional[int] = ..., video_provider_status: _Optional[int] = ...) -> None: ...

class CanvasTextCheckpoint(_message.Message):
    __slots__ = ("content", "node_id", "offset", "status", "task_run_id")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    content: str
    node_id: str
    offset: int
    status: str
    task_run_id: str
    def __init__(self, content: _Optional[str] = ..., node_id: _Optional[str] = ..., offset: _Optional[int] = ..., status: _Optional[str] = ..., task_run_id: _Optional[str] = ...) -> None: ...

class CanvasNodeDraftAssetReference(_message.Message):
    __slots__ = ("anchor_text", "asset_id", "label", "media_type", "resource_asset_id", "target_field")
    ANCHOR_TEXT_FIELD_NUMBER: _ClassVar[int]
    ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ASSET_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_FIELD_NUMBER: _ClassVar[int]
    anchor_text: str
    asset_id: str
    label: str
    media_type: int
    resource_asset_id: str
    target_field: str
    def __init__(self, anchor_text: _Optional[str] = ..., asset_id: _Optional[str] = ..., label: _Optional[str] = ..., media_type: _Optional[int] = ..., resource_asset_id: _Optional[str] = ..., target_field: _Optional[str] = ...) -> None: ...

class CanvasNodeDraft(_message.Message):
    __slots__ = ("asset_references", "canvas_node_no", "draft_id", "duration_seconds", "prompt")
    ASSET_REFERENCES_FIELD_NUMBER: _ClassVar[int]
    CANVAS_NODE_NO_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    asset_references: _containers.RepeatedCompositeFieldContainer[CanvasNodeDraftAssetReference]
    canvas_node_no: int
    draft_id: str
    duration_seconds: int
    prompt: str
    def __init__(self, asset_references: _Optional[_Iterable[_Union[CanvasNodeDraftAssetReference, _Mapping]]] = ..., canvas_node_no: _Optional[int] = ..., draft_id: _Optional[str] = ..., duration_seconds: _Optional[int] = ..., prompt: _Optional[str] = ...) -> None: ...

class StoryboardPlanningConfig(_message.Message):
    __slots__ = ("canvas_node_duration_max_seconds", "canvas_node_duration_min_seconds", "total_duration_max_seconds", "total_duration_min_seconds")
    CANVAS_NODE_DURATION_MAX_SECONDS_FIELD_NUMBER: _ClassVar[int]
    CANVAS_NODE_DURATION_MIN_SECONDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_DURATION_MAX_SECONDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_DURATION_MIN_SECONDS_FIELD_NUMBER: _ClassVar[int]
    canvas_node_duration_max_seconds: int
    canvas_node_duration_min_seconds: int
    total_duration_max_seconds: int
    total_duration_min_seconds: int
    def __init__(self, canvas_node_duration_max_seconds: _Optional[int] = ..., canvas_node_duration_min_seconds: _Optional[int] = ..., total_duration_max_seconds: _Optional[int] = ..., total_duration_min_seconds: _Optional[int] = ...) -> None: ...

class StoryboardVideoParameters(_message.Message):
    __slots__ = ("aspect_ratio", "generate_audio", "resolution", "watermark")
    ASPECT_RATIO_FIELD_NUMBER: _ClassVar[int]
    GENERATE_AUDIO_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    WATERMARK_FIELD_NUMBER: _ClassVar[int]
    aspect_ratio: int
    generate_audio: bool
    resolution: int
    watermark: bool
    def __init__(self, aspect_ratio: _Optional[int] = ..., generate_audio: _Optional[bool] = ..., resolution: _Optional[int] = ..., watermark: _Optional[bool] = ...) -> None: ...

class StoryboardModelConfig(_message.Message):
    __slots__ = ("inference_model_service_id", "video_model_service_id", "video_parameters")
    INFERENCE_MODEL_SERVICE_ID_FIELD_NUMBER: _ClassVar[int]
    VIDEO_MODEL_SERVICE_ID_FIELD_NUMBER: _ClassVar[int]
    VIDEO_PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    inference_model_service_id: str
    video_model_service_id: str
    video_parameters: StoryboardVideoParameters
    def __init__(self, inference_model_service_id: _Optional[str] = ..., video_model_service_id: _Optional[str] = ..., video_parameters: _Optional[_Union[StoryboardVideoParameters, _Mapping]] = ...) -> None: ...

class CanvasNodeDraftSession(_message.Message):
    __slots__ = ("canvas_nodes", "model_config", "planning_config", "plot", "status", "task_run_id")
    CANVAS_NODES_FIELD_NUMBER: _ClassVar[int]
    MODEL_CONFIG_FIELD_NUMBER: _ClassVar[int]
    PLANNING_CONFIG_FIELD_NUMBER: _ClassVar[int]
    PLOT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    canvas_nodes: _containers.RepeatedCompositeFieldContainer[CanvasNodeDraft]
    model_config: StoryboardModelConfig
    planning_config: StoryboardPlanningConfig
    plot: str
    status: int
    task_run_id: str
    def __init__(self, canvas_nodes: _Optional[_Iterable[_Union[CanvasNodeDraft, _Mapping]]] = ..., model_config: _Optional[_Union[StoryboardModelConfig, _Mapping]] = ..., planning_config: _Optional[_Union[StoryboardPlanningConfig, _Mapping]] = ..., plot: _Optional[str] = ..., status: _Optional[int] = ..., task_run_id: _Optional[str] = ...) -> None: ...

class StartStoryboardDraftsRequest(_message.Message):
    __slots__ = ("actor", "workspace_role", "project_id", "canvas_id", "plot", "planning_config", "model_config")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ROLE_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    PLOT_FIELD_NUMBER: _ClassVar[int]
    PLANNING_CONFIG_FIELD_NUMBER: _ClassVar[int]
    MODEL_CONFIG_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    workspace_role: str
    project_id: str
    canvas_id: str
    plot: str
    planning_config: StoryboardPlanningConfig
    model_config: StoryboardModelConfig
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., workspace_role: _Optional[str] = ..., project_id: _Optional[str] = ..., canvas_id: _Optional[str] = ..., plot: _Optional[str] = ..., planning_config: _Optional[_Union[StoryboardPlanningConfig, _Mapping]] = ..., model_config: _Optional[_Union[StoryboardModelConfig, _Mapping]] = ...) -> None: ...

class StartStoryboardDraftsResponse(_message.Message):
    __slots__ = ("canvas_node", "completed", "error", "session")
    CANVAS_NODE_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    SESSION_FIELD_NUMBER: _ClassVar[int]
    canvas_node: CanvasNodeDraft
    completed: CanvasNodesCompleted
    error: CanvasNodesError
    session: CanvasNodeDraftSession
    def __init__(self, canvas_node: _Optional[_Union[CanvasNodeDraft, _Mapping]] = ..., completed: _Optional[_Union[CanvasNodesCompleted, _Mapping]] = ..., error: _Optional[_Union[CanvasNodesError, _Mapping]] = ..., session: _Optional[_Union[CanvasNodeDraftSession, _Mapping]] = ...) -> None: ...

class CanvasNodesCompleted(_message.Message):
    __slots__ = ("count",)
    COUNT_FIELD_NUMBER: _ClassVar[int]
    count: int
    def __init__(self, count: _Optional[int] = ...) -> None: ...

class CanvasNodesError(_message.Message):
    __slots__ = ("code", "message")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    code: str
    message: str
    def __init__(self, code: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class GenerateNodesRequest(_message.Message):
    __slots__ = ("actor", "workspace_role", "project_id", "canvas_id", "node_ids")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ROLE_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_IDS_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    workspace_role: str
    project_id: str
    canvas_id: str
    node_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., workspace_role: _Optional[str] = ..., project_id: _Optional[str] = ..., canvas_id: _Optional[str] = ..., node_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class NodeGeneration(_message.Message):
    __slots__ = ("node_id", "task_run_id")
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    task_run_id: str
    def __init__(self, node_id: _Optional[str] = ..., task_run_id: _Optional[str] = ...) -> None: ...

class GenerateNodesResponse(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[NodeGeneration]
    def __init__(self, items: _Optional[_Iterable[_Union[NodeGeneration, _Mapping]]] = ...) -> None: ...

class GenerationConfigPatch(_message.Message):
    __slots__ = ("model_service_id", "resolution", "aspect_ratio", "duration_seconds", "generate_audio", "watermark")
    MODEL_SERVICE_ID_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    ASPECT_RATIO_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    GENERATE_AUDIO_FIELD_NUMBER: _ClassVar[int]
    WATERMARK_FIELD_NUMBER: _ClassVar[int]
    model_service_id: str
    resolution: int
    aspect_ratio: int
    duration_seconds: int
    generate_audio: bool
    watermark: bool
    def __init__(self, model_service_id: _Optional[str] = ..., resolution: _Optional[int] = ..., aspect_ratio: _Optional[int] = ..., duration_seconds: _Optional[int] = ..., generate_audio: _Optional[bool] = ..., watermark: _Optional[bool] = ...) -> None: ...

class UpdateNodeRequest(_message.Message):
    __slots__ = ("actor", "workspace_role", "project_id", "canvas_id", "node_id", "name", "prompt", "text", "position", "video_input_mode", "generation_config")
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ROLE_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    CANVAS_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    POSITION_FIELD_NUMBER: _ClassVar[int]
    VIDEO_INPUT_MODE_FIELD_NUMBER: _ClassVar[int]
    GENERATION_CONFIG_FIELD_NUMBER: _ClassVar[int]
    actor: _context_pb2.ActorContext
    workspace_role: str
    project_id: str
    canvas_id: str
    node_id: str
    name: str
    prompt: str
    text: str
    position: Position
    video_input_mode: int
    generation_config: GenerationConfigPatch
    def __init__(self, actor: _Optional[_Union[_context_pb2.ActorContext, _Mapping]] = ..., workspace_role: _Optional[str] = ..., project_id: _Optional[str] = ..., canvas_id: _Optional[str] = ..., node_id: _Optional[str] = ..., name: _Optional[str] = ..., prompt: _Optional[str] = ..., text: _Optional[str] = ..., position: _Optional[_Union[Position, _Mapping]] = ..., video_input_mode: _Optional[int] = ..., generation_config: _Optional[_Union[GenerationConfigPatch, _Mapping]] = ...) -> None: ...

class UpdateNodeResponse(_message.Message):
    __slots__ = ("canvas_node",)
    CANVAS_NODE_FIELD_NUMBER: _ClassVar[int]
    canvas_node: CanvasNode
    def __init__(self, canvas_node: _Optional[_Union[CanvasNode, _Mapping]] = ...) -> None: ...
