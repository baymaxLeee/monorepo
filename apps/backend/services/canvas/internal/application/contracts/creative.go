package contracts

type CopyNode struct {
	NodeID           string `json:"node_id"`
	ExpectedRevision int64  `json:"expected_revision"`
}
type ResourceFromNode struct {
	ResourceID  string `json:"resource_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        int16  `json:"type"`
}
type CanvasView struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}
type CopyAsset struct {
	AssetID          string  `json:"asset_id"`
	NodeID           string  `json:"node_id"`
	ExpectedRevision int64   `json:"expected_revision"`
	X                float64 `json:"x"`
	Y                float64 `json:"y"`
}
type NodeFrames struct {
	Status       string `json:"status"`
	FirstAssetID string `json:"first_asset_id"`
	LastAssetID  string `json:"last_asset_id"`
}
