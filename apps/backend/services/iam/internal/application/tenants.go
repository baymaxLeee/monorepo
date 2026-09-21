package application

import (
	"context"
	"github.com/example/monorepo/iam/internal/application/contracts"
	"github.com/example/monorepo/iam/internal/domain"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/models"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/repositories"
	"strings"
	"time"
)

func tenantView(row models.Tenant) contracts.Tenant {
	return contracts.Tenant{ID: row.ID, Name: row.Name, Slug: row.Slug}
}

func (s *WorkspaceService) ListTenants(ctx context.Context) ([]contracts.Tenant, error) {
	rows, err := s.store.ListTenants(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]contracts.Tenant, 0, len(rows))
	for _, row := range rows {
		result = append(result, tenantView(row))
	}
	return result, nil
}

func (s *WorkspaceService) CreateTenant(ctx context.Context, req contracts.CreateTenant, meta AuditMeta) (contracts.Tenant, error) {
	name, slug := strings.TrimSpace(req.Name), domain.NormalizeSlug(req.Slug)
	if name == "" || len(name) > 120 || !domain.ValidSlug(slug) {
		return contracts.Tenant{}, ErrInvalidWorkspace
	}
	now := time.Now().UTC()
	row := models.Tenant{ID: NewID(), Name: name, Slug: slug, CreatedAt: now, UpdatedAt: now}
	err := mutateWithAudit(ctx, s.store, auditEntry{Action: "tenant.create", Actor: meta.ActorUserID, After: map[string]any{"tenantId": row.ID, "name": name}, Trace: meta.TraceID}, func(store *repositories.Store) error { return store.CreateTenant(ctx, row) })
	if err != nil {
		return contracts.Tenant{}, ErrConflict
	}
	return tenantView(row), nil
}
