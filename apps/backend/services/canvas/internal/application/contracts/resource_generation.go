package contracts

type ResourceGenerationConfig struct {
	Prompt             string   `json:"prompt"`
	ProviderID         string   `json:"provider_id"`
	Resolution         string   `json:"resolution"`
	AspectRatio        string   `json:"aspect_ratio"`
	Watermark          bool     `json:"watermark"`
	UploadedAssetIDs   []string `json:"uploaded_asset_ids"`
	ReferenceSequences []int64  `json:"reference_sequences"`
}
type ResourceGenerationDraft struct {
	Config      ResourceGenerationConfig `json:"config"`
	Revision    int64                    `json:"revision"`
	ActiveRunID string                   `json:"active_run_id"`
}
type UpdateResourceGeneration struct {
	ExpectedRevision int64                    `json:"expected_revision"`
	Config           ResourceGenerationConfig `json:"config"`
}
