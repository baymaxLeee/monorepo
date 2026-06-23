package model

import "time"

type Object struct {
	ID                 string     `gorm:"column:id;primaryKey"`
	Bucket             string     `gorm:"column:bucket"`
	ObjectKey          string     `gorm:"column:object_key"`
	Backend            string     `gorm:"column:backend"`
	StoragePath        string     `gorm:"column:storage_path"`
	ETag               string     `gorm:"column:etag"`
	SHA256             string     `gorm:"column:sha256"`
	SizeBytes          int64      `gorm:"column:size_bytes"`
	ContentType        string     `gorm:"column:content_type"`
	ContentDisposition string     `gorm:"column:content_disposition"`
	MetadataJSON       string     `gorm:"column:metadata_json"`
	OwnerUserID        string     `gorm:"column:owner_user_id"`
	CreatedAt          time.Time  `gorm:"column:created_at"`
	UpdatedAt          time.Time  `gorm:"column:updated_at"`
	DeletedAt          *time.Time `gorm:"column:deleted_at"`
}

func (Object) TableName() string { return "storage_objects" }
