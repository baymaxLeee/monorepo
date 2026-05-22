package crud

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/model"
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

func (s *Store) AutoMigrate(ctx context.Context) error {
	return s.db.WithContext(ctx).AutoMigrate(
		&model.User{},
		&model.UserCredential{},
		&model.RefreshToken{},
		&model.Role{},
		&model.UserRole{},
	)
}

func (s *Store) CreateUserWithPassword(ctx context.Context, user model.User, passwordHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		credential := model.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		return tx.Create(&credential).Error
	})
}

func (s *Store) EnsureUserWithPassword(ctx context.Context, user model.User, passwordHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"email", "email_normalized", "display_name", "updated_at"}),
		}).Create(&user).Error
		if err != nil && strings.Contains(err.Error(), "uq_users_email_normalized") {
			err = tx.Model(&model.User{}).
				Where("email_normalized = ?", user.EmailNormalized).
				Updates(map[string]any{
					"id":           user.ID,
					"email":        user.Email,
					"display_name": user.DisplayName,
					"updated_at":   now,
				}).Error
		}
		if err != nil {
			return err
		}
		credential := model.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"password_hash", "password_changed_at", "updated_at"}),
		}).Create(&credential).Error
	})
}

func (s *Store) UserByAccount(ctx context.Context, account string) (model.User, string, error) {
	var credential model.UserCredential
	err := s.db.WithContext(ctx).
		Joins("User").
		Where("User.account = ? AND User.disabled_at IS NULL", account).
		First(&credential).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, "", ErrNotFound
	}
	return credential.User, credential.PasswordHash, err
}

func (s *Store) UserByID(ctx context.Context, id string) (model.User, error) {
	var user model.User
	err := s.db.WithContext(ctx).
		Where("id = ? AND disabled_at IS NULL", id).
		First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	return user, err
}

func (s *Store) CreateRefreshToken(ctx context.Context, token model.RefreshToken) error {
	return s.db.WithContext(ctx).Create(&token).Error
}

func (s *Store) RotateRefreshToken(ctx context.Context, oldHash string, next model.RefreshToken) (model.User, error) {
	var user model.User
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		var old model.RefreshToken
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("token_hash = ?", oldHash).
			First(&old).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if old.RevokedAt != nil || !old.ExpiresAt.After(now) {
			return ErrNotFound
		}
		next.UserID = old.UserID
		if err := tx.Create(&next).Error; err != nil {
			return err
		}
		old.RevokedAt = &now
		old.LastUsedAt = &now
		old.ReplacedByTokenID = &next.ID
		if err := tx.Save(&old).Error; err != nil {
			return err
		}
		err = tx.Where("id = ? AND disabled_at IS NULL", old.UserID).First(&user).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	})
	return user, err
}

func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&model.RefreshToken{}).
		Where("token_hash = ? AND revoked_at IS NULL", tokenHash).
		Update("revoked_at", now).Error
}

func (s *Store) MarkLogin(ctx context.Context, userID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]any{"last_login_at": now, "updated_at": now}).Error
}

func (s *Store) CreateRole(ctx context.Context, role model.Role) error {
	return s.db.WithContext(ctx).Create(&role).Error
}

func (s *Store) EnsureRole(ctx context.Context, role model.Role) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{"description", "updated_at"}),
	}).Create(&role).Error
}

func (s *Store) RoleByName(ctx context.Context, name string) (model.Role, error) {
	var role model.Role
	err := s.db.WithContext(ctx).Where("name = ?", name).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Role{}, ErrNotFound
	}
	return role, err
}

func (s *Store) ListRoles(ctx context.Context) ([]model.Role, error) {
	var roles []model.Role
	err := s.db.WithContext(ctx).Order("name").Find(&roles).Error
	return roles, err
}

func (s *Store) AssignRole(ctx context.Context, userID, roleID string) error {
	userRole := model.UserRole{
		UserID:    userID,
		RoleID:    roleID,
		CreatedAt: time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&userRole).Error
}

func (s *Store) RemoveRole(ctx context.Context, userID, roleID string) error {
	result := s.db.WithContext(ctx).
		Where("user_id = ? AND role_id = ?", userID, roleID).
		Delete(&model.UserRole{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UserRoles(ctx context.Context, userID string) ([]model.Role, error) {
	var roles []model.Role
	err := s.db.WithContext(ctx).
		Table("roles").
		Select("roles.*").
		Joins("JOIN user_roles ON user_roles.role_id = roles.id").
		Where("user_roles.user_id = ?", userID).
		Order("roles.name").
		Find(&roles).Error
	return roles, err
}
