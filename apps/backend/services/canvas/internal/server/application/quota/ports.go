package quota

import (
	"context"
	"time"
)

type LimitSource interface {
	Limits(context.Context, string) (Limits, error)
}

type LimitProvider interface {
	Limit(context.Context, string, ResourceType) (Limit, error)
}

type Store interface {
	Reserve(context.Context, ReserveRequest) (Reservation, error)
	Commit(context.Context, Reservation, time.Time) error
	Release(context.Context, Reservation, time.Time) error
	BeginPresetEntitlementRelease(context.Context, string, time.Time) error
	CompletePresetEntitlementCleanup(context.Context, string, time.Time) (bool, error)
	Decrement(context.Context, string, ResourceType, int64, time.Time) error
	CommitStorage(context.Context, Reservation, StorageObject, time.Time) error
	RecordStorage(context.Context, StorageObject, time.Time) error
	RecordAdmittedStorage(context.Context, StorageObject, time.Time) error
	Usage(context.Context, string, ResourceType) (Usage, error)
	MarkStorageReleasing(context.Context, string, string, time.Time) (bool, error)
	ReleaseStorage(context.Context, string, string, time.Time) (bool, error)
}

type Clock interface {
	Now() time.Time
}

type ReportingStore interface {
	ClaimDirty(context.Context, string, time.Time, time.Time, int) ([]ReportClaim, error)
	CompleteReport(context.Context, ReportClaim, time.Time) (bool, error)
	ReconcileAll(context.Context, time.Time, bool) error
}

type UsagePublisher interface {
	PublishTotal(context.Context, string, ResourceType, int64) error
}
