package persistence

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/example/monorepo/chat/internal/application"
	"github.com/example/monorepo/chat/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

func Open(ctx context.Context, databaseURL string) (*Repository, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL config: %w", err)
	}
	config.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open PostgreSQL: %w", err)
	}
	return &Repository{pool: pool, queries: sqlc.New(pool)}, nil
}

func (repository *Repository) Close() { repository.pool.Close() }

func (repository *Repository) Ping(ctx context.Context) error { return repository.pool.Ping(ctx) }

func (repository *Repository) Create(ctx context.Context, scope application.AuthContext, runtimeSessionID string, input application.CreateConversationInput) (application.Conversation, error) {
	id, err := conversationID()
	if err != nil {
		return application.Conversation{}, err
	}
	title := "新对话"
	if input.Title != nil {
		title = *input.Title
	}
	now := time.Now()
	row, err := repository.queries.CreateConversation(ctx, sqlc.CreateConversationParams{
		ID:               id,
		RuntimeSessionID: runtimeSessionID,
		CreateRequestID:  input.RequestID,
		UserID:           scope.UserID,
		TenantID:         scope.TenantID,
		WorkspaceID:      scope.WorkspaceID,
		Title:            title,
		ProjectID:        input.ProjectID,
		CanvasID:         input.CanvasID,
		CreatedAt:        pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err == nil {
		return conversationFromRow(row), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return application.Conversation{}, err
	}
	row, err = repository.queries.FindConversationByIdempotency(ctx, sqlc.FindConversationByIdempotencyParams{
		TenantID:        scope.TenantID,
		WorkspaceID:     scope.WorkspaceID,
		UserID:          scope.UserID,
		CreateRequestID: input.RequestID,
		ProjectID:       input.ProjectID,
		CanvasID:        input.CanvasID,
	})
	if err != nil {
		return application.Conversation{}, err
	}
	existing := conversationFromRow(row)
	if existing.RuntimeSessionID != runtimeSessionID {
		return application.Conversation{}, errors.New("conversation mapping conflict")
	}
	return existing, nil
}

func (repository *Repository) List(ctx context.Context, scope application.AuthContext) ([]application.Conversation, error) {
	rows, err := repository.queries.ListConversations(ctx, sqlc.ListConversationsParams{
		UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if err != nil {
		return nil, err
	}
	result := make([]application.Conversation, len(rows))
	for index, row := range rows {
		result[index] = conversationFromRow(row)
	}
	return result, nil
}

func (repository *Repository) Get(ctx context.Context, scope application.AuthContext, id string) (*application.Conversation, error) {
	row, err := repository.queries.GetConversation(ctx, sqlc.GetConversationParams{
		ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	conversation := conversationFromRow(row)
	return &conversation, err
}

func (repository *Repository) UpdateTitle(ctx context.Context, scope application.AuthContext, id, title string) (*application.Conversation, error) {
	row, err := repository.queries.UpdateConversationTitle(ctx, sqlc.UpdateConversationTitleParams{
		Title: title, ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	conversation := conversationFromRow(row)
	return &conversation, err
}

func (repository *Repository) UpdateTitleIfDefault(ctx context.Context, scope application.AuthContext, id, title string) (*application.Conversation, error) {
	row, err := repository.queries.UpdateConversationTitleIfDefault(ctx, sqlc.UpdateConversationTitleIfDefaultParams{
		Title: title, ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	conversation := conversationFromRow(row)
	return &conversation, err
}

func (repository *Repository) Delete(ctx context.Context, scope application.AuthContext, id string) (*application.Conversation, error) {
	row, err := repository.queries.DeleteConversation(ctx, sqlc.DeleteConversationParams{
		ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	conversation := conversationFromRow(row)
	return &conversation, err
}

func conversationFromRow(row sqlc.Conversation) application.Conversation {
	return application.Conversation{
		ID: row.ID, RuntimeSessionID: row.RuntimeSessionID, CreateRequestID: row.CreateRequestID,
		UserID: row.UserID, TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, Title: row.Title,
		ProjectID: row.ProjectID, CanvasID: row.CanvasID, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
	}
}

func conversationID() (string, error) {
	value := make([]byte, 6)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("create conversation id: %w", err)
	}
	return hex.EncodeToString(value), nil
}
