package domain

import "time"

type Asset struct {
	ID, TenantID, WorkspaceID, Category, State, CreatedBy string
	CurrentRevisionID                                     string
	BlockingClaimCount                                    int64
	CandidateAt, DeleteAfter                              *time.Time
	StateVersion                                          int64
	CreatedAt, UpdatedAt                                  time.Time
}

type Revision struct {
	ID, AssetID, BlobID, Filename, MediaType, SHA256, CreatedBy string
	RevisionNumber, SizeBytes                                   int64
	CreatedAt                                                   time.Time
}

type ClaimKind string

const (
	ClaimStrong   ClaimKind = "strong"
	ClaimSnapshot ClaimKind = "snapshot"
	ClaimLease    ClaimKind = "lease"
	ClaimWeak     ClaimKind = "weak"
)

func (kind ClaimKind) Blocking() bool {
	return kind == ClaimStrong || kind == ClaimSnapshot || kind == ClaimLease
}

type Claim struct {
	ID, TenantID, WorkspaceID, OwnerService, OwnerType, OwnerID, Slot string
	AssetID, RevisionID, Status                                       string
	Kind                                                              ClaimKind
	Generation                                                        int64
	ExpiresAt                                                         *time.Time
}
