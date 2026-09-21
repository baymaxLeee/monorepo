package coverimage

import (
	"context"
	"errors"
)

var (
	// ErrIDGeneration identifies failures in locally generated cover registration IDs.
	ErrIDGeneration = errors.New("cover image ID generation failed")
	// ErrTooLarge identifies cover registrations whose trusted Up size exceeds the limit.
	ErrTooLarge = errors.New("cover image is too large")
)

type Registration struct {
	Path      string
	ID        string
	SHA256    string
	SizeBytes int64
}

type Store interface {
	Register(context.Context, string, string, string) (Registration, error)
	Release(context.Context, Registration) error
}
