package contracts

type Project struct {
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedBy   string `json:"created_by"`
	Revision    int64  `json:"revision"`
}
type CreateProject struct {
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	MemberUserIDs    []string `json:"member_user_ids"`
	UsageLimitMicros *int64   `json:"usage_limit_micros"`
}
type Board struct {
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Name      string `json:"name"`
	Revision  int64  `json:"revision"`
}
type CreateBoard struct {
	Name string `json:"name"`
}
type Edge struct {
	ID           string `json:"id"`
	SourceNodeID string `json:"source_node_id"`
	SourcePort   string `json:"source_port"`
	TargetPort   string `json:"target_port"`
	TargetOrder  int32  `json:"target_order"`
}
type GenerationConfig struct {
	ProviderID      string `json:"provider_id"`
	Resolution      string `json:"resolution"`
	AspectRatio     string `json:"aspect_ratio"`
	DurationSeconds int32  `json:"duration_seconds"`
	GenerateAudio   bool   `json:"generate_audio"`
	Watermark       bool   `json:"watermark"`
}
type Node struct {
	AssetID          string           `json:"asset_id"`
	GenerationConfig GenerationConfig `json:"generation_config"`
	VideoInputMode   int16            `json:"video_input_mode"`
	ID               string           `json:"id"`
	Type             int16            `json:"type"`
	Name             string           `json:"name"`
	Text             string           `json:"text"`
	Prompt           string           `json:"prompt"`
	X                float64          `json:"x"`
	Y                float64          `json:"y"`
	StoryboardRank   int64            `json:"storyboard_rank"`
	Revision         int64            `json:"revision"`
	IncomingEdges    []Edge           `json:"incoming_edges"`
}
type Graph struct {
	Canvas Board  `json:"canvas"`
	Nodes  []Node `json:"nodes"`
}
type Mutation struct {
	OperationID      string   `json:"operation_id"`
	ExpectedRevision int64    `json:"expected_revision"`
	Upsert           []Node   `json:"upsert"`
	DeleteIDs        []string `json:"delete_ids"`
}
type Member struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}
type ProjectList struct {
	Items []Project `json:"items"`
}
type BoardList struct {
	Items []Board `json:"items"`
}
type MemberList struct {
	Items []Member `json:"items"`
}

type UpdateProject struct {
	Name             string `json:"name"`
	Description      string `json:"description"`
	ExpectedRevision int64  `json:"expected_revision"`
}
type UpdateBoard struct {
	Name             string `json:"name"`
	ExpectedRevision int64  `json:"expected_revision"`
}
type ExpectedRevision struct {
	ExpectedRevision int64 `json:"expected_revision"`
}
type Deleted struct {
	Deleted bool `json:"deleted"`
}

type StartGeneration struct {
	OperationID      string `json:"operation_id"`
	ExpectedRevision int64  `json:"expected_revision"`
}
type Generation struct {
	ID              string `json:"id"`
	NodeID          string `json:"node_id"`
	Status          string `json:"status"`
	OutputAssetID   string `json:"output_asset_id"`
	OutputText      string `json:"output_text"`
	Error           string `json:"error"`
	Applied         bool   `json:"applied"`
	CancelRequested bool   `json:"cancel_requested"`
	CreatedAt       string `json:"created_at"`
}
type GenerationList struct {
	Items []Generation `json:"items"`
}

type Resource struct {
	ID                     string `json:"id"`
	ProjectID              string `json:"project_id"`
	Type                   int16  `json:"type"`
	Name                   string `json:"name"`
	Description            string `json:"description"`
	PrimaryResourceAssetID string `json:"primary_resource_asset_id"`
	Revision               int64  `json:"revision"`
	ResourceAssetCount     int32  `json:"resource_asset_count"`
}
type ResourceInput struct {
	Name             string `json:"name"`
	Description      string `json:"description"`
	Type             int16  `json:"type"`
	ExpectedRevision int64  `json:"expected_revision"`
}
type ResourceList struct {
	Items []Resource `json:"items"`
}
type ResourceAsset struct {
	SourceType int16  `json:"source_type"`
	SequenceNo int64  `json:"sequence_no"`
	HasContent bool   `json:"has_content"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	MediaType  int16  `json:"media_type"`
	Revision   int64  `json:"revision"`
}
type ResourceAssetList struct {
	Items []ResourceAsset `json:"items"`
}
type CreativeAsset struct {
	NodeID          string `json:"node_id"`
	CanvasID        string `json:"canvas_id"`
	ResourceID      string `json:"resource_id"`
	ResourceName    string `json:"resource_name"`
	ResourceType    int16  `json:"resource_type"`
	ResourceAssetID string `json:"resource_asset_id"`
	CurrentAssetID  string `json:"current_asset_id"`
	Name            string `json:"name"`
	MediaType       int16  `json:"media_type"`
}
type CreativeAssetList struct {
	Items []CreativeAsset `json:"items"`
}
type MaterializeResource struct {
	NodeID          string `json:"node_id"`
	ResourceAssetID string `json:"resource_asset_id"`
}

type ResourceVersion struct {
	RevisionNo int64  `json:"revision_no"`
	Current    bool   `json:"current"`
	CreatedAt  string `json:"created_at"`
}
type ResourceVersionList struct {
	Items []ResourceVersion `json:"items"`
}
type ResourceAssetUpdate struct {
	ExpectedRevision int64  `json:"expected_revision"`
	Name             string `json:"name"`
	RevisionNo       int64  `json:"revision_no"`
}

type Archive struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Filename     string `json:"filename"`
	InputCount   int32  `json:"input_count"`
	Size         int64  `json:"size"`
	CreatedAt    string `json:"created_at"`
	Error        string `json:"error"`
	Downloadable bool   `json:"downloadable"`
}
type ArchiveList struct {
	Items []Archive `json:"items"`
}

type StartCanvasGeneration struct {
	OperationID string `json:"operation_id"`
}
type CanvasGenerationStart struct {
	NodeID    string `json:"node_id"`
	TaskRunID string `json:"task_run_id"`
}
type CanvasGenerationBatch struct {
	Started      []CanvasGenerationStart `json:"started"`
	SkippedCount int                     `json:"skipped_count"`
}

type GenerationState struct {
	ID              string `json:"id"`
	NodeID          string `json:"node_id"`
	Status          string `json:"status"`
	CancelRequested bool   `json:"cancel_requested"`
}
type GenerationStateList struct {
	Items []GenerationState `json:"items"`
}
