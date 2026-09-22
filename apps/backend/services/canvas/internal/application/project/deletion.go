package project

import (
	"context"
	"errors"

	applicationdeletion "github.com/example/monorepo/canvas/internal/application/deletion"
)

const CleanupJobKind = "project.cleanup.v1"

type CleanupPayload struct {
	Scope     Scope
	ProjectID string
}

func WithDeletionQueue(queue *applicationdeletion.Queue) Option {
	return func(s *Service) { s.deletion = queue }
}

// CleanupDeleted is driven only by a durable job whose parent deletion has
// committed. Each domain must make retries converge even after partial success.
func (s *Service) CleanupDeleted(ctx context.Context, input CleanupPayload) error {
	if input.Scope.TenantID == "" || input.ProjectID == "" {
		return errors.New("invalid project cleanup target")
	}
	if err := s.children.Cleanup(ctx, input.Scope, input.ProjectID); err != nil {
		return err
	}
	policy, err := s.getUsagePolicy(ctx, input.Scope, input.ProjectID)
	if err != nil {
		return err
	}
	if policy != nil {
		if err = s.usagePolicies.Delete(ctx, input.Scope, policy.ID); err != nil {
			return err
		}
	}
	if s.memberCache != nil {
		if err = s.memberCache.Invalidate(ctx, input.Scope.TenantID, input.Scope.WorkspaceID, input.ProjectID); err != nil {
			return err
		}
	}
	return nil
}
