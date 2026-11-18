package repositories

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/sqlc"
)

func (s *Store) CreateRefreshToken(ctx context.Context, v application.RefreshToken) error {
	return s.q.CreateRefreshToken(ctx, sqlc.CreateRefreshTokenParams{
		ID:                v.ID,
		UserID:            v.UserID,
		TokenHash:         v.TokenHash,
		UserAgent:         v.UserAgent,
		IPAddress:         v.IPAddress,
		ExpiresAt:         v.ExpiresAt,
		RevokedAt:         v.RevokedAt,
		CreatedAt:         v.CreatedAt,
		LastUsedAt:        v.LastUsedAt,
		ReplacedByTokenID: v.ReplacedByTokenID,
		ActiveWorkspaceID: v.ActiveWorkspaceID,
	})
}

func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	return s.q.RevokeRefreshToken(ctx, tokenHash)
}

func (s *Store) RevokeUserRefreshTokens(ctx context.Context, userID string) error {
	return s.q.RevokeUserRefreshTokens(ctx, userID)
}

func (s *Store) rotate(ctx context.Context, hash string, next application.RefreshToken, target *string, expectedUserID string) (application.User, *string, error) {
	var user application.User
	var workspace *string
	err := s.inTx(ctx, func(tx *Store) error {
		old, err := tx.q.LockToken(ctx, hash)
		if err != nil {
			return missing(err)
		}
		if old.RevokedAt != nil || !old.ExpiresAt.After(time.Now()) || (target != nil && old.UserID != expectedUserID) {
			return ErrNotFound
		}
		workspace = old.ActiveWorkspaceID
		if target != nil {
			workspace = target
		}
		if workspace != nil {
			_, status, err := tx.MemberRoleStatus(ctx, *workspace, old.UserID)
			if err != nil && !errors.Is(err, ErrNotFound) {
				return err
			}
			if status != "active" {
				if target != nil {
					return ErrNotActiveMember
				}
				workspace = nil
			}
		}
		next.UserID = old.UserID
		next.ActiveWorkspaceID = workspace
		if err = tx.CreateRefreshToken(ctx, next); err != nil {
			return err
		}
		if err = tx.q.ReplaceToken(ctx, sqlc.ReplaceTokenParams{ID: old.ID, ReplacedByTokenID: &next.ID}); err != nil {
			return err
		}
		user, err = tx.UserByID(ctx, old.UserID)
		return err
	})
	if err != nil {
		return application.User{}, nil, err
	}
	return user, workspace, nil
}
func (s *Store) RotateRefreshToken(ctx context.Context, hash string, next application.RefreshToken) (application.User, *string, error) {
	return s.rotate(ctx, hash, next, nil, "")
}
func (s *Store) RotateRefreshTokenToWorkspace(ctx context.Context, hash string, next application.RefreshToken, workspaceID, expectedUserID string) (application.User, error) {
	user, _, err := s.rotate(ctx, hash, next, &workspaceID, expectedUserID)
	return user, err
}
