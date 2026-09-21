package repositories

import (
	"context"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/models"
)

func (s *Store) TenantByID(ctx context.Context, id string) (models.Tenant, error) {
	var tenant models.Tenant
	err := s.db.WithContext(ctx).Where("id = ?", id).First(&tenant).Error
	return tenant, err
}

func (s *Store) ListTenants(ctx context.Context) ([]models.Tenant, error) {
	tenants := make([]models.Tenant, 0)
	err := s.db.WithContext(ctx).Order("name").Find(&tenants).Error
	return tenants, err
}

func (s *Store) CreateTenant(ctx context.Context, tenant models.Tenant) error {
	return s.db.WithContext(ctx).Create(&tenant).Error
}
