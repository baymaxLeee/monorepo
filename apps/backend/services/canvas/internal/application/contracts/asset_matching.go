package contracts

type StartAssetMatch struct {
	OperationID      string `json:"operation_id"`
	ExpectedRevision int64  `json:"expected_revision"`
}

type AssetMatchRun struct {
	ID              string `json:"id"`
	NodeID          string `json:"node_id"`
	Status          string `json:"status"`
	Error           string `json:"error"`
	CancelRequested bool   `json:"cancel_requested"`
	Applied         bool   `json:"applied"`
	CreatedAt       string `json:"created_at"`
}
