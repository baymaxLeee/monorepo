package coverimage

import (
	"context"
	"errors"
)

var (
	// ErrIDGeneration identifies failures in locally generated cover registration IDs.
	ErrIDGeneration = errors.New("cover image ID generation failed")
	// ErrTooLarge identifies cover registrations whose trusted Up size exceeds the limit.
	ErrTooLarge          = errors.New("cover image is too large")
	ErrUnsupportedFormat = errors.New("unsupported cover image format")
	ErrInvalidReference  = errors.New("invalid cover image reference")
)

type Registration struct {
	Path        string
	ID          string
	SHA256      string
	ContentType string
	SizeBytes   int64
}

type Store interface {
	Register(context.Context, string, string, string) (Registration, error)
	Release(context.Context, Registration) error
	Presign(context.Context, []Registration) (map[string]string, error)
}
