package resource

import (
	"context"
	"time"
)

type GenerationDeleter interface {
	DeleteGeneration(context.Context, Scope, string, time.Time) error
}

func WithGenerationDeletion(deleter GenerationDeleter) Option {
	return func(s *Service) { s.generationDeleter = deleter }
}
