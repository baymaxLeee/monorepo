package firstlastframe

type Execution struct {
	TaskRunID, GenerationTaskRunID string
	TenantID, ProjectID, CreatedBy string
	WorkspaceID                    *string
	SourceArtifactID               string
	SourceArtifactNamespace        string
	FirstFrameCheckpointID         string
	LastFrameCheckpointID          string
	FirstFrameCheckpointSizeBytes  int64
	LastFrameCheckpointSizeBytes   int64
}

type Result struct {
	FirstFrameArtifactID string `json:"FirstFrameArtifactID"`
	LastFrameArtifactID  string `json:"LastFrameArtifactID"`
	FirstFrameSizeBytes  int64  `json:"FirstFrameSizeBytes"`
	LastFrameSizeBytes   int64  `json:"LastFrameSizeBytes"`
}
