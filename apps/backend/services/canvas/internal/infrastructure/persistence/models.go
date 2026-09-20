package persistence

import (
	"gorm.io/gorm"
	"time"
)

type Project struct {
	ID          string `gorm:"primaryKey"`
	OrgID       string
	Name        string
	Description string
	CreatedBy   string
	Revision    int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   gorm.DeletedAt
}
type Member struct {
	ProjectID string `gorm:"primaryKey"`
	UserID    string `gorm:"primaryKey"`
	Role      string
}

func (Member) TableName() string { return "project_members" }

type Board struct {
	ID        string `gorm:"primaryKey"`
	ProjectID string
	Name      string
	Revision  int64
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt
}

func (Board) TableName() string { return "canvases" }

type Node struct {
	AssetID          string
	GenerationConfig string `gorm:"type:jsonb"`
	VideoInputMode   int16
	ID               string `gorm:"primaryKey"`
	CanvasID         string
	Type             int16
	Name             string
	Text             string
	Prompt           string
	X                float64
	Y                float64
	StoryboardRank   int64
	Revision         int64
	IncomingEdges    string `gorm:"type:jsonb"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        gorm.DeletedAt
}

func (Node) TableName() string { return "canvas_nodes" }

type Operation struct {
	CanvasID    string `gorm:"primaryKey"`
	UserID      string `gorm:"primaryKey"`
	OperationID string `gorm:"primaryKey"`
	RequestHash string
	Result      string `gorm:"type:jsonb"`
	CreatedAt   time.Time
}

func (Operation) TableName() string { return "canvas_operations" }

type Generation struct {
	ID              string `gorm:"primaryKey"`
	CanvasID        string
	NodeID          string
	OrgID           string
	UserID          string
	OperationID     string
	NodeRevision    int64
	ProviderID      string
	Prompt          string
	Status          string
	TaskID          string
	OutputText      string
	Error           string
	Applied         bool
	CancelRequested bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (Generation) TableName() string { return "canvas_generations" }

type Asset struct {
	ID        string `gorm:"primaryKey"`
	OrgID     string
	ProjectID string
	ObjectKey string
	MimeType  string
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt
}
type AssetReference struct {
	AssetID   string `gorm:"primaryKey"`
	OwnerType string `gorm:"primaryKey"`
	OwnerKey  string `gorm:"primaryKey"`
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt
}

type Resource struct {
	ID                     string `gorm:"primaryKey"`
	OrgID                  string
	ProjectID              string
	Type                   int16
	Name                   string
	Description            string
	PrimaryResourceAssetID string
	Revision               int64
	ResourceAssetCount     int32
	CreatedBy              string
	CreatedAt              time.Time
	UpdatedAt              time.Time
	DeletedAt              gorm.DeletedAt
}
type ResourceAsset struct {
	ID             string `gorm:"primaryKey"`
	ResourceID     string
	Name           string
	SequenceNo     int64
	SourceType     int16
	CurrentAssetID string
	MediaType      int16
	Revision       int64
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DeletedAt      gorm.DeletedAt
}
type ResourceAssetRevision struct {
	ResourceAssetID string `gorm:"primaryKey"`
	AssetID         string
	MediaType       int16
	RevisionNo      int64 `gorm:"primaryKey"`
	CreatedAt       time.Time
}
