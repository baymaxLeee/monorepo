package coverimage

import (
	"context"
	"errors"
	"strconv"
)

const (
	QuotaObjectType = "cover_attachment"
	MaximumBytes    = int64(2 << 20)
)

func SupportedMediaType(value string) bool { return value == "image/png" || value == "image/jpeg" }

var (
	// ErrIDGeneration identifies failures in locally generated cover registration IDs.
	ErrIDGeneration = errors.New("cover image ID generation failed")
	// ErrTooLarge identifies cover registrations whose trusted artifact storage size exceeds the limit.
	ErrTooLarge          = errors.New("cover image is too large")
	ErrUnsupportedFormat = errors.New("unsupported cover image format")
	ErrInvalidReference  = errors.New("invalid cover image reference")
)

type RevisionRef struct{ AssetID, RevisionID string }

func (ref RevisionRef) Valid() bool { return ref.AssetID != "" && ref.RevisionID != "" }

type RegisterInput struct {
	TenantID                   string
	WorkspaceID                *string
	UserID, OwnerType, OwnerID string
	Generation                 int64
	Revision                   RevisionRef
}
type Registration struct {
	TenantID           string
	WorkspaceID        *string
	Revision           RevisionRef
	OwnerType, OwnerID string
	Generation         int64
	SHA256             string
	ContentType        string
	SizeBytes          int64
}

func LifecycleKey(ownerType, ownerID string, generation int64) string {
	if ownerType == "" || ownerID == "" || generation <= 0 {
		return ""
	}
	return ownerType + ":" + ownerID + ":" + strconv.FormatInt(generation, 10)
}

type Store interface {
	Register(context.Context, RegisterInput) (Registration, error)
	EnsureActive(context.Context, Registration) error
	Release(context.Context, Registration) error
	Presign(context.Context, []Registration) (map[RevisionRef]string, error)
}
