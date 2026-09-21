package contracts

type BenefitPackageChoice struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	IsPreset         bool     `json:"is_preset"`
	ModelIDs         []string `json:"model_ids"`
	MaterialUsed     int64    `json:"material_used"`
	MaterialReserved int64    `json:"material_reserved"`
	MaterialLimit    *int64   `json:"material_limit"`
}

type BenefitPackageChoiceList struct {
	Items []BenefitPackageChoice `json:"items"`
}

type SubmitAssetReview struct {
	PackageID   string `json:"package_id"`
	OperationID string `json:"operation_id"`
}

type AssetReview struct {
	ID               string `json:"id"`
	ResourceAssetID  string `json:"resource_asset_id"`
	AssetID          string `json:"asset_id"`
	BenefitPackageID string `json:"benefit_package_id"`
	PackageName      string `json:"package_name"`
	IsPreset         bool   `json:"is_preset"`
	Status           string `json:"status"`
	FailureReason    string `json:"failure_reason"`
	SubmittedAt      string `json:"submitted_at"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type AssetReviewList struct {
	Items []AssetReview `json:"items"`
}
