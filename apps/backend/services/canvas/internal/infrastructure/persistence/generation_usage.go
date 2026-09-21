package persistence

type GenerationUsageMetadata struct {
	GenerationID  string `gorm:"primaryKey"`
	TenantID      string
	WorkspaceID   string
	ProjectID     string
	ModelName     string
	ModelID       string
	Currency      string
	EstimateKnown bool
}

func (GenerationUsageMetadata) TableName() string { return "generation_usage_metadata" }
