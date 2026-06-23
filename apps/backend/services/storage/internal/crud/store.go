package crud

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/monorepo/storage/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db *gorm.DB
}

func Connect(_ context.Context, databaseURL string) (*Store, error) {
	db, err := gorm.Open(mysql.Open(databaseURL), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open mysql: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(4)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	store := &Store{db: db}
	if err := store.Ping(context.Background()); err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Ping(ctx context.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return sqlDB.PingContext(ctx)
}

func (s *Store) Close() {
	sqlDB, err := s.db.DB()
	if err == nil {
		_ = sqlDB.Close()
	}
}

func (s *Store) UpsertObject(ctx context.Context, obj model.Object) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "bucket"}, {Name: "object_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"backend",
			"storage_path",
			"etag",
			"sha256",
			"size_bytes",
			"content_type",
			"content_disposition",
			"metadata_json",
			"owner_user_id",
			"updated_at",
			"deleted_at",
		}),
	}).Create(&obj).Error
}

func (s *Store) Object(ctx context.Context, bucket, key string) (model.Object, error) {
	var obj model.Object
	err := s.db.WithContext(ctx).
		Where("bucket = ? AND object_key = ? AND deleted_at IS NULL", bucket, key).
		First(&obj).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Object{}, ErrNotFound
	}
	return obj, err
}

func (s *Store) DeleteObject(ctx context.Context, bucket, key string) (model.Object, error) {
	var obj model.Object
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("bucket = ? AND object_key = ? AND deleted_at IS NULL", bucket, key).
			First(&obj).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		return tx.Model(&model.Object{}).
			Where("id = ?", obj.ID).
			Updates(map[string]any{"deleted_at": now, "updated_at": now}).Error
	})
	return obj, err
}
