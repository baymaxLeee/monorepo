package transaction

import (
	"context"

	"gorm.io/gorm"
)

type contextKey struct{}

type Manager struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Manager {
	return &Manager{db: db}
}

func (m *Manager) WithinTransaction(ctx context.Context, run func(context.Context) error) error {
	return DB(ctx, m.db).Transaction(func(tx *gorm.DB) error {
		return run(context.WithValue(ctx, contextKey{}, tx))
	})
}

func DB(ctx context.Context, fallback *gorm.DB) *gorm.DB {
	if tx, ok := ctx.Value(contextKey{}).(*gorm.DB); ok && tx != nil {
		return tx.WithContext(ctx)
	}
	return fallback.WithContext(ctx)
}
