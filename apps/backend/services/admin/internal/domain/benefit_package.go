package domain

import "time"

type BenefitPackage struct {
	ID, TenantID, WorkspaceID                string
	IsPreset                                 bool
	Name, ProjectName, AssetGroupID          string
	AccessKeyIDEncrypted, SecretKeyEncrypted string
	Enabled                                  bool
	ModelIDs                                 []string
	MaterialUsed, MaterialReserved           int64
	MaterialLimit                            *int64
	Revision                                 int64
	CreatedBy, UpdatedBy                     string
	CreatedAt, UpdatedAt                     time.Time
	DeletedAt                                *time.Time
}

type ReviewReservation struct {
	ID, TenantID, WorkspaceID, BenefitPackageID string
	ProjectID, AssetID, OperationID, Status     string
	CreatedAt, UpdatedAt                        time.Time
}

type ReviewCleanup struct {
	CleanupID, ReservationID, Status string
	CreatedAt                        time.Time
	CompletedAt                      *time.Time
}

type AssetGroupCleanup struct {
	ID, TenantID, WorkspaceID, BenefitPackageID string
	AssetGroupID, ProjectName                   string
	AccessKeyIDEncrypted, SecretKeyEncrypted    string
	Status, LeaseToken, LastError               string
	LeaseUntil                                  *time.Time
	Attempts                                    int
	CreatedAt, UpdatedAt                        time.Time
	CompletedAt                                 *time.Time
}
