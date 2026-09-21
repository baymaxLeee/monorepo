package persistence

type ResourceGeneration struct {
	Generation      `gorm:"embedded"`
	ProjectID       string
	ResourceID      string
	ResourceAssetID string
}

func (ResourceGeneration) TableName() string { return "resource_image_runs" }
