package quota

import (
	"errors"
	"time"
)

type Mode string
type ResourceType string

const (
	ModeReportOnly Mode = "report-only"
	ModeEnforce    Mode = "enforce"
)

const (
	ScopePlatform             = "platform"
	ScopeTenant               = "tenant"
	PlatformScopeID           = "agentframe"
	ResourcePresetEntitlement = ResourceType("PresetEntitlementAsset")
	ResourceProject           = ResourceType("AgentFrameProject")
	ResourceStorage           = ResourceType("AgentFrameStorageUsage")
	ReservationPending        = "pending"
	ReservationCommitted      = "committed"
	ReservationReleasing      = "releasing"
	ReservationReacquiring    = "reacquiring"
	ReservationReleased       = "released"
	BillingBillable           = "billable"
	BillingBuiltin            = "builtin"
	BillingBorrowed           = "borrowed"
	StorageActive             = "active"
	StorageReleasing          = "releasing"
	StorageReleased           = "released"
)

var (
	ErrExceeded              = errors.New("project quota exceeded")
	ErrUnavailable           = errors.New("project quota unavailable")
	ErrReservationInProgress = errors.New("quota reservation is already in progress")
)

type Limit struct {
	Tenant   int64
	Platform *int64
}

type Limits map[ResourceType]Limit

type Modes map[ResourceType]Mode

func (m Modes) Mode(resource ResourceType) Mode {
	if mode := m[resource]; mode != "" {
		return mode
	}
	return ModeReportOnly
}

type Reservation struct {
	ID          string
	TenantID    string
	Resource    ResourceType
	Value       int64
	WouldReject bool
}

type ReportClaim struct {
	TenantID   string
	Resource   ResourceType
	Value      int64
	Revision   int64
	LeaseToken string
}

type ReserveRequest struct {
	ID             string
	TenantID       string
	Resource       ResourceType
	IdempotencyKey string
	TargetType     string
	TargetID       string
	Value          int64
	TenantLimit    *int64
	PlatformLimit  *int64
	LimitAvailable bool
	Enforce        bool
	ExpiresAt      time.Time
	Now            time.Time
}

type StorageObject struct {
	TenantID     string
	WorkspaceID  *string
	ObjectType   string
	ObjectKey    string
	Category     string
	OwnerType    string
	OwnerID      string
	SizeBytes    int64
	BillingClass string
}

type Usage struct {
	Used     int64
	Reserved int64
}

type StorageBackfillResult struct {
	Incomplete int64
}

func (r StorageBackfillResult) Ready() bool {
	return r.Incomplete == 0
}
