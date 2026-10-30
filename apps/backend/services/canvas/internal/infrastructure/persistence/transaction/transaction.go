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
		txCtx := context.WithValue(ctx, contextKey{}, tx)
		parent, nested := ctx.Value(hooksKey{}).(*hooks)
		h := &hooks{callbacks: map[string]func(context.Context) error{}}
		txCtx = context.WithValue(txCtx, hooksKey{}, h)
		if err := run(txCtx); err != nil {
			return err
		}
		if nested {
			for _, key := range h.order {
				if _, exists := parent.callbacks[key]; !exists {
					parent.order = append(parent.order, key)
				}
				parent.callbacks[key] = h.callbacks[key]
			}
			return nil
		}
		for _, key := range h.order {
			if err := h.callbacks[key](txCtx); err != nil {
				return err
			}
		}
		return nil
	})
}

func DB(ctx context.Context, fallback *gorm.DB) *gorm.DB {
	if tx, ok := ctx.Value(contextKey{}).(*gorm.DB); ok && tx != nil {
		return tx.WithContext(ctx)
	}
	return fallback.WithContext(ctx)
}
