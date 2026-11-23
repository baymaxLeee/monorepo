package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/example/monorepo/chat/internal/application"
	"github.com/example/monorepo/chat/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
)

func memoryScope(scope application.AuthContext) sqlc.ListActiveMemoriesParams {
	return sqlc.ListActiveMemoriesParams{
		TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, UserID: scope.UserID,
	}
}

func activeMemory(row sqlc.UserMemory) application.UserMemory {
	return application.UserMemory{
		ID: row.ID, Category: application.MemoryCategory(row.Category), Content: row.Content, Confidence: row.Confidence,
	}
}

func memoryCandidate(row sqlc.UserMemory) application.MemoryCandidate {
	return application.MemoryCandidate{
		ID: row.ID, Category: application.MemoryCategory(row.Category), Content: row.Content,
		Reason: row.Reason, SupersedesID: row.SupersedesID, CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
	}
}

func (repository *Repository) ListActiveMemories(
	ctx context.Context,
	scope application.AuthContext,
) ([]application.UserMemory, error) {
	rows, err := repository.queries.ListActiveMemories(ctx, memoryScope(scope))
	if err != nil {
		return nil, err
	}
	result := make([]application.UserMemory, len(rows))
	for index, row := range rows {
		result[index] = activeMemory(row)
	}
	return result, nil
}

func (repository *Repository) ListMemoryCandidates(
	ctx context.Context,
	scope application.AuthContext,
) ([]application.MemoryCandidate, error) {
	rows, err := repository.queries.ListPendingMemoryCandidates(ctx, sqlc.ListPendingMemoryCandidatesParams(memoryScope(scope)))
	if err != nil {
		return nil, err
	}
	result := make([]application.MemoryCandidate, len(rows))
	for index, row := range rows {
		result[index] = memoryCandidate(row)
	}
	return result, nil
}

func (repository *Repository) ApproveMemoryCandidate(
	ctx context.Context,
	scope application.AuthContext,
	id string,
) (*application.UserMemory, error) {
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := repository.queries.WithTx(tx)
	owned, err := queries.GetMemoryForUpdate(ctx, sqlc.GetMemoryForUpdateParams{
		ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, UserID: scope.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) || owned.Status != "pending" {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	now := timestamp(time.Now())
	if owned.SupersedesID != nil {
		if err := queries.SupersedeActiveMemory(ctx, sqlc.SupersedeActiveMemoryParams{
			UpdatedAt: now, ID: *owned.SupersedesID, TenantID: scope.TenantID,
			WorkspaceID: scope.WorkspaceID, UserID: scope.UserID,
		}); err != nil {
			return nil, err
		}
	}
	row, err := queries.ActivateMemoryCandidate(ctx, sqlc.ActivateMemoryCandidateParams{
		UpdatedAt: now, ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, UserID: scope.UserID,
	})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	value := activeMemory(row)
	return &value, nil
}

func (repository *Repository) RejectMemoryCandidate(
	ctx context.Context,
	scope application.AuthContext,
	id string,
) (bool, error) {
	_, err := repository.queries.RejectMemoryCandidate(ctx, sqlc.RejectMemoryCandidateParams{
		UpdatedAt: timestamp(time.Now()), ID: id, TenantID: scope.TenantID,
		WorkspaceID: scope.WorkspaceID, UserID: scope.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (repository *Repository) UpdateMemoryCandidate(
	ctx context.Context,
	scope application.AuthContext,
	id string,
	category *application.MemoryCategory,
	content *string,
) (*application.MemoryCandidate, error) {
	var categoryValue *string
	if category != nil {
		value := string(*category)
		categoryValue = &value
	}
	row, err := repository.queries.UpdateMemoryCandidate(ctx, sqlc.UpdateMemoryCandidateParams{
		UpdatedAt: timestamp(time.Now()), ID: id, TenantID: scope.TenantID,
		WorkspaceID: scope.WorkspaceID, UserID: scope.UserID, Category: categoryValue, Content: content,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	value := memoryCandidate(row)
	return &value, nil
}

func (repository *Repository) DeleteMemory(
	ctx context.Context,
	scope application.AuthContext,
	id string,
) (bool, error) {
	_, err := repository.queries.DeleteMemory(ctx, sqlc.DeleteMemoryParams{
		ID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, UserID: scope.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
