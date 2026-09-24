package firstlastframe

type Execution struct {
	TaskRunID, GenerationTaskRunID string
	TenantID, ProjectID, CreatedBy string
	WorkspaceID                    *string
	SourceSourceAssetID            string
	SourceSourceRevisionID         string
	FirstFrameCheckpointAssetID    string
	FirstFrameCheckpointRevisionID string
	LastFrameCheckpointAssetID     string
	LastFrameCheckpointRevisionID  string
	FirstFrameCheckpointSizeBytes  int64
	LastFrameCheckpointSizeBytes   int64
}

type Result struct {
	FirstFrameSourceAssetID    string `json:"FirstFrameSourceAssetID"`
	FirstFrameSourceRevisionID string `json:"FirstFrameSourceRevisionID"`
	LastFrameSourceAssetID     string `json:"LastFrameSourceAssetID"`
	LastFrameSourceRevisionID  string `json:"LastFrameSourceRevisionID"`
	FirstFrameSizeBytes        int64  `json:"FirstFrameSizeBytes"`
	LastFrameSizeBytes         int64  `json:"LastFrameSizeBytes"`
}
