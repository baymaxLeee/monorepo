package persistence

import (
	"gorm.io/gorm"
	"time"
)

type Project struct {
	ID           string `gorm:"primaryKey"`
	TenantID     string `json:"tenantId"`
	WorkspaceID  string
	Name         string
	Description  string
	CoverAssetID string
	CreatedBy    string
	Revision     int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
	DeletedAt    gorm.DeletedAt
}
type Member struct {
	ProjectID string `gorm:"primaryKey"`
	UserID    string `gorm:"primaryKey"`
	Role      string
}

func (Member) TableName() string { return "project_members" }

type Board struct {
	ID           string `gorm:"primaryKey"`
	ProjectID    string
	Name         string
	CoverAssetID string
	CreatedBy    string
	DefaultView  int16
	Revision     int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
	DeletedAt    gorm.DeletedAt
}

func (Board) TableName() string { return "canvases" }

type Node struct {
	AssetID          string
	ResourceID       string
	ResourceAssetID  string
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
	ID                   string `gorm:"primaryKey"`
	CanvasID             string
	NodeID               string
	TenantID             string `json:"tenantId"`
	WorkspaceID          string
	UserID               string
	OperationID          string
	NodeRevision         int64
	ProviderID           string
	Prompt               string
	Status               string
	TaskID               string
	TaskType             string
	InputPayload         string `gorm:"type:jsonb"`
	OutputAssetID        string
	OutputText           string
	Error                string
	Applied              bool
	CancelRequested      bool
	ReservedAmountMicros int64
	UsageSettled         bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func (Generation) TableName() string { return "canvas_generations" }

type Asset struct {
	ID           string `gorm:"primaryKey"`
	TenantID     string `json:"tenantId"`
	WorkspaceID  string
	ProjectID    string
	ArtifactID   string
	MimeType     string
	OriginalName string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	DeletedAt    gorm.DeletedAt
}
type AssetReference struct {
	AssetID   string `gorm:"primaryKey"`
	OwnerType string `gorm:"primaryKey"`
	OwnerKey  string `gorm:"primaryKey"`
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt
}
type AssetGCCandidate struct {
	AssetID        string `gorm:"primaryKey"`
	TenantID       string
	WorkspaceID    string
	ProjectID      string
	ArtifactID     string
	PurgeNotBefore time.Time
	NextAttemptAt  time.Time
	LeaseUntil     *time.Time
	StateVersion   int64
	Attempts       int32
	LastError      string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

func (AssetGCCandidate) TableName() string { return "asset_gc_candidates" }

type Resource struct {
	ID                     string `gorm:"primaryKey"`
	TenantID               string `json:"tenantId"`
	WorkspaceID            string
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

type AssetReview struct {
	ID                  string `gorm:"primaryKey"`
	TenantID            string
	WorkspaceID         string
	ProjectID           string
	ResourceAssetID     string
	AssetID             string
	BenefitPackageID    string
	PackageName         string
	IsPreset            bool
	ReservationID       string
	OperationID         string
	CreatedBy           string
	ProviderAssetID     string
	SubmissionStartedAt *time.Time
	Status              string
	FailureReason       string
	SubmittedAt         *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
	DeletedAt           gorm.DeletedAt
}

func (AssetReview) TableName() string { return "asset_reviews" }

type AssetReviewCleanup struct {
	ID               string `gorm:"primaryKey"`
	ReviewID         string
	AssetID          string
	TenantID         string
	WorkspaceID      string
	BenefitPackageID string
	ReservationID    string
	ProviderAssetID  string
	Status           string
	Attempts         int32
	NextAttemptAt    time.Time
	LeaseUntil       *time.Time
	LeaseToken       string
	LastError        string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	CompletedAt      *time.Time
}

func (AssetReviewCleanup) TableName() string { return "asset_review_cleanups" }
