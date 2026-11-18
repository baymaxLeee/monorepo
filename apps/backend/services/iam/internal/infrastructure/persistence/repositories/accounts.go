package repositories

import (
	"context"
	"errors"

	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/sqlc"
	"github.com/example/monorepo/iam/internal/infrastructure/security"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func fromUser(row sqlc.User) application.User {
	return application.User(row)
}

func (s *Store) createUser(ctx context.Context, v application.User) error {
	return s.q.CreateUser(ctx, sqlc.CreateUserParams(v))
}

func (s *Store) upsertUser(ctx context.Context, v application.User) error {
	return s.q.UpsertUser(ctx, sqlc.UpsertUserParams(v))
}

func (s *Store) UserByID(ctx context.Context, id string) (application.User, error) {
	row, err := s.q.UserByID(ctx, id)
	return fromUser(row), missing(err)
}

func (s *Store) UserExistsByAccount(ctx context.Context, account string) (bool, error) {
	return s.q.UserExistsByAccount(ctx, account)
}

func (s *Store) MarkLogin(ctx context.Context, userID string) error {
	return s.q.MarkLogin(ctx, userID)
}

func (s *Store) UserByAccount(ctx context.Context, account string) (application.User, string, error) {
	row, err := s.q.UserByAccount(ctx, account)
	return fromUser(row.User), row.PasswordHash, missing(err)
}

func (s *Store) createAccount(ctx context.Context, user application.User, hash string) error {
	if err := s.createUser(ctx, user); err != nil {
		return err
	}
	return s.q.CreateCredential(ctx, sqlc.CreateCredentialParams{UserID: user.ID, PasswordHash: hash})
}
func (s *Store) CreateUserWithMembership(ctx context.Context, user application.User, passwordHash, guestWorkspaceID, workspaceID, role, status string) error {
	return s.inTx(ctx, func(tx *Store) error {
		if err := tx.createAccount(ctx, user, passwordHash); err != nil {
			return err
		}
		if workspaceID != guestWorkspaceID {
			if err := tx.q.CreateMember(ctx, sqlc.CreateMemberParams{WorkspaceID: guestWorkspaceID, UserID: user.ID, Role: "member", Status: "active"}); err != nil {
				return err
			}
		}
		return tx.q.CreateMember(ctx, sqlc.CreateMemberParams{WorkspaceID: workspaceID, UserID: user.ID, Role: role, Status: status})
	})
}
func (s *Store) CreateRegisteredUser(ctx context.Context, user application.User, passwordHash, guestWorkspaceID, targetWorkspaceID string) error {
	if targetWorkspaceID == "" || targetWorkspaceID == guestWorkspaceID {
		return s.CreateUserWithMembership(ctx, user, passwordHash, guestWorkspaceID, guestWorkspaceID, "member", "active")
	}
	return s.CreateUserWithMembership(ctx, user, passwordHash, guestWorkspaceID, targetWorkspaceID, "member", "pending")
}
func (s *Store) EnsureUserWithPassword(ctx context.Context, user application.User, password, passwordHash string) error {
	return s.inTx(ctx, func(tx *Store) error {
		// Isolate the insert so a conflicting email can be reconciled after rollback to the savepoint.
		err := tx.inTx(ctx, func(nested *Store) error { return nested.upsertUser(ctx, user) })
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uq_users_email_normalized" {
			err = tx.q.AdoptSeedAccount(ctx, sqlc.AdoptSeedAccountParams{ID: user.ID, Email: user.Email, DisplayName: user.DisplayName, EmailNormalized: user.EmailNormalized})
		}
		if err != nil {
			return err
		}
		current, err := tx.q.LockPassword(ctx, user.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return tx.q.CreateCredential(ctx, sqlc.CreateCredentialParams{UserID: user.ID, PasswordHash: passwordHash})
		}
		if err != nil {
			return err
		}
		if security.VerifyPassword(current, password) {
			return nil
		}
		if err = tx.q.ChangePassword(ctx, sqlc.ChangePasswordParams{UserID: user.ID, PasswordHash: passwordHash}); err != nil {
			return err
		}
		return tx.RevokeUserRefreshTokens(ctx, user.ID)
	})
}
func (s *Store) RecordAudit(ctx context.Context, e application.IamAuditEvent) error {
	var before, after []byte
	if e.BeforeJSON != nil {
		before = []byte(*e.BeforeJSON)
	}
	if e.AfterJSON != nil {
		after = []byte(*e.AfterJSON)
	}
	return s.q.RecordAudit(ctx, sqlc.RecordAuditParams{ID: e.ID, Action: e.Action, ActorUserID: e.ActorUserID, TargetUserID: e.TargetUserID, WorkspaceID: e.WorkspaceID, BeforeJSON: before, AfterJSON: after, Result: e.Result, Reason: e.Reason, TraceID: e.TraceID, CreatedAt: e.CreatedAt})
}
