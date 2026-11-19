package persistence

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
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

func (repository *Repository) Reserve(
	ctx context.Context,
	scope application.AuthContext,
	intent application.ConversationIntent,
) (application.Conversation, error) {
	title := "新对话"
	if intent.Input.Title != nil {
		title = *intent.Input.Title
	}
	pluginSelectionsJSON, err := json.Marshal(intent.Input.PluginSelections)
	if err != nil {
		return application.Conversation{}, fmt.Errorf("encode conversation plugin selections: %w", err)
	}
	now := time.Now()
	for range 2 {
		id, err := conversationID()
		if err != nil {
			return application.Conversation{}, err
		}
		row, err := repository.queries.ReserveConversation(ctx, sqlc.ReserveConversationParams{
			ID:                   id,
			Operation:            string(intent.Operation),
			CreateRequestID:      intent.Input.RequestID,
			CreateFingerprint:    intent.CreateFingerprint,
			RuntimeRequest:       intent.RuntimeRequest,
			SourceConversationID: intent.SourceConversationID,
			SourceMessageID:      intent.SourceMessageID,
			UserID:               scope.UserID,
			TenantID:             scope.TenantID,
			WorkspaceID:          scope.WorkspaceID,
			Title:                title,
			PluginSelectionsJson: pluginSelectionsJSON,
			NextAttemptAt:        timestamp(now),
		})
		if err == nil {
			return conversationFromRow(row)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return application.Conversation{}, err
		}

		row, err = repository.queries.FindConversationByIdempotency(ctx, sqlc.FindConversationByIdempotencyParams{
			TenantID:        scope.TenantID,
			WorkspaceID:     scope.WorkspaceID,
			UserID:          scope.UserID,
			CreateRequestID: intent.Input.RequestID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// The only remaining conflict is the randomly generated primary key.
			continue
		}
		if err != nil {
			return application.Conversation{}, err
		}
		existing, err := conversationFromRow(row)
		if err != nil {
			return application.Conversation{}, err
		}
		if existing.State == application.ConversationDeleting {
			return application.Conversation{}, application.Conflict(
				"conversation_deleting", "conversation is being deleted",
			)
		}
		if existing.Operation != intent.Operation || existing.CreateFingerprint != intent.CreateFingerprint {
			return application.Conversation{}, application.Conflict(
				"request_id_conflict", "conversation request is already bound to different input",
			)
		}
		return existing, nil
	}
	return application.Conversation{}, errors.New("failed to allocate a conversation id")
}

func (repository *Repository) BindRuntimeThread(
	ctx context.Context,
	scope application.AuthContext,
	id string,
	runtimeThreadID string,
) (application.Conversation, error) {
	now := time.Now()
	row, err := repository.queries.BindConversationRuntimeThread(ctx, sqlc.BindConversationRuntimeThreadParams{
		RuntimeThreadID: &runtimeThreadID,
		NextAttemptAt:   timestamp(now),
		ID:              id,
		UserID:          scope.UserID,
		TenantID:        scope.TenantID,
		WorkspaceID:     scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return application.Conversation{}, application.Conflict(
			"conversation_mapping_conflict", "conversation cannot bind this Runtime Thread",
		)
	}
	if err != nil {
		return application.Conversation{}, err
	}
	return conversationFromRow(row)
}

func (repository *Repository) RecordSagaFailure(
	ctx context.Context,
	scope application.AuthContext,
	id string,
	state application.ConversationState,
	cause error,
) error {
	message := cause.Error()
	if len(message) > 2000 {
		message = message[:2000]
	}
	_, err := repository.queries.RecordConversationSagaFailure(ctx, sqlc.RecordConversationSagaFailureParams{
		UpdatedAt:   timestamp(time.Now()),
		LastError:   &message,
		ID:          id,
		UserID:      scope.UserID,
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		State:       string(state),
	})
	return err
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
		result[index], err = conversationFromRow(row)
		if err != nil {
			return nil, err
		}
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
	if err != nil {
		return nil, err
	}
	conversation, err := conversationFromRow(row)
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (repository *Repository) UpdateTitle(ctx context.Context, scope application.AuthContext, id, title string) (*application.Conversation, error) {
	row, err := repository.queries.UpdateConversationTitle(ctx, sqlc.UpdateConversationTitleParams{
		Title: title, ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	conversation, err := conversationFromRow(row)
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (repository *Repository) UpdateTitleIfDefault(ctx context.Context, scope application.AuthContext, id, title string) (*application.Conversation, error) {
	row, err := repository.queries.UpdateConversationTitleIfDefault(ctx, sqlc.UpdateConversationTitleIfDefaultParams{
		Title: title, ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	conversation, err := conversationFromRow(row)
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (repository *Repository) BeginDelete(
	ctx context.Context,
	scope application.AuthContext,
	id string,
) (*application.Conversation, error) {
	row, err := repository.queries.BeginConversationDelete(ctx, sqlc.BeginConversationDeleteParams{
		NextAttemptAt: timestamp(time.Now()),
		ID:            id,
		UserID:        scope.UserID,
		TenantID:      scope.TenantID,
		WorkspaceID:   scope.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	conversation, err := conversationFromRow(row)
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (repository *Repository) CompleteDelete(
	ctx context.Context,
	scope application.AuthContext,
	id string,
	runtimeThreadID string,
) error {
	_, err := repository.queries.CompleteConversationDelete(ctx, sqlc.CompleteConversationDeleteParams{
		ID: id, UserID: scope.UserID, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		RuntimeThreadID: &runtimeThreadID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		remaining, getErr := repository.Get(ctx, scope, id)
		if getErr != nil {
			return getErr
		}
		if remaining == nil {
			return nil
		}
		return application.Conflict("conversation_delete_conflict", "conversation delete intent changed")
	}
	return err
}

func conversationFromRow(row sqlc.Conversation) (application.Conversation, error) {
	runtimeThreadID := ""
	if row.RuntimeThreadID != nil {
		runtimeThreadID = *row.RuntimeThreadID
	}
	var pluginSelections []application.ConversationPluginSelection
	if err := json.Unmarshal(row.PluginSelectionsJson, &pluginSelections); err != nil {
		return application.Conversation{}, fmt.Errorf("decode conversation plugin selections: %w", err)
	}
	return application.Conversation{
		ID:                   row.ID,
		State:                application.ConversationState(row.State),
		Operation:            application.ConversationOperation(row.Operation),
		RuntimeThreadID:      runtimeThreadID,
		CreateRequestID:      row.CreateRequestID,
		CreateFingerprint:    row.CreateFingerprint,
		RuntimeRequest:       append([]byte(nil), row.RuntimeRequest...),
		SourceConversationID: row.SourceConversationID,
		SourceMessageID:      row.SourceMessageID,
		UserID:               row.UserID,
		TenantID:             row.TenantID,
		WorkspaceID:          row.WorkspaceID,
		Title:                row.Title,
		PluginSelections:     pluginSelections,
		AttemptCount:         int(row.AttemptCount),
		NextAttemptAt:        row.NextAttemptAt.Time,
		LastError:            row.LastError,
		CreatedAt:            row.CreatedAt.Time,
		UpdatedAt:            row.UpdatedAt.Time,
	}, nil
}

func timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func conversationID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("create conversation id: %w", err)
	}
	return hex.EncodeToString(value), nil
}
