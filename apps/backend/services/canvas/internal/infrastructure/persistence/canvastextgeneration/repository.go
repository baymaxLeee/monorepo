package canvastextgeneration

import (
	"context"
	"errors"
	"time"

	"encoding/json"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	app "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	"github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ store *persistencetransaction.Store }

func NewRepository(store *persistencetransaction.Store) *Repository { return &Repository{store: store} }
func (r *Repository) Create(ctx context.Context, scope applicationcanvas.Scope, state app.Session) error {
	value, err := toRow(scope, state)
	if err != nil {
		return err
	}
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error { return r.store.Queries(ctx).TextGenCreate(ctx, value) })
}

func (r *Repository) Get(ctx context.Context, scope applicationcanvas.Scope, taskRunID string) (app.Session, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.Session{}, app.ErrNotFound
	}
	value, err := r.store.Queries(ctx).TextGenGet(ctx, sqlc.TextGenGetParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		CreatedBy:   scope.CallerID,
		TaskRunID:   id.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Session{}, app.ErrNotFound
	}
	if err != nil {
		return app.Session{}, err
	}
	return fromRow(value)
}

func (r *Repository) GetHistory(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, taskRunID string) (app.Session, error) {
	project, canvas, node, err := parseHistoryScopeIDs(projectID, canvasID, nodeID)
	if err != nil {
		return app.Session{}, app.ErrNotFound
	}
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.Session{}, app.ErrNotFound
	}
	value, err := r.store.Queries(ctx).TextGenGetHistory(ctx, sqlc.TextGenGetHistoryParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		CreatedBy:   scope.CallerID,
		TaskRunID:   id.String(),
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		NodeID:      node.String(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Session{}, app.ErrNotFound
	}
	if err != nil {
		return app.Session{}, err
	}
	return fromRow(value)
}

func (r *Repository) List(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) ([]app.Session, error) {
	project, canvas, node, err := parseHistoryScopeIDs(projectID, canvasID, nodeID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	rows, err := r.store.Queries(ctx).TextGenList(ctx, sqlc.TextGenListParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		CreatedBy:   scope.CallerID,
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
		NodeID:      node.String(),
	})
	if err != nil {
		return nil, err
	}
	items := make([]app.Session, 0, len(rows))
	for index := range rows {
		item, err := fromRow(rows[index])
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) MarkRunning(ctx context.Context, scope applicationcanvas.Scope, id string, now time.Time) error {
	parsed, err := persistenceid.Parse(id)
	if err != nil {
		return app.ErrNotFound
	}
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		affected, err := r.store.Queries(ctx).TextGenStart(ctx, sqlc.TextGenStartParams{
			TenantID:    scope.TenantID,
			WorkspaceID: scope.WorkspaceID,
			CreatedBy:   scope.CallerID,
			TaskRunID:   parsed.String(),
			UpdatedAt:   now,
		})
		if err != nil {
			return err
		}
		if affected != 1 {
			return app.ErrNotFound
		}
		return nil
	})
}

func (r *Repository) Finish(ctx context.Context, scope applicationcanvas.Scope, id string, status task.Status, failure *app.Failure, content string, now time.Time) error {
	var code, message *string
	if failure != nil {
		code = &failure.Code
		message = &failure.Message
	}
	parsed, err := persistenceid.Parse(id)
	if err != nil {
		return app.ErrNotFound
	}
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		affected, err := r.store.Queries(ctx).TextGenFinish(ctx, sqlc.TextGenFinishParams{
			TenantID:     scope.TenantID,
			WorkspaceID:  scope.WorkspaceID,
			CreatedBy:    scope.CallerID,
			TaskRunID:    parsed.String(),
			UpdatedAt:    now,
			Status:       string(status),
			ErrorCode:    code,
			ErrorMessage: message,
			Content:      content,
		})
		if err != nil {
			return err
		}
		if affected != 1 {
			return app.ErrNotFound
		}
		return nil
	})
}

func toRow(scope applicationcanvas.Scope, state app.Session) (sqlc.TextGenCreateParams, error) {
	id, e := persistenceid.Parse(state.ID)
	if e != nil {
		return sqlc.TextGenCreateParams{}, e
	}
	project, e := persistenceid.Parse(state.ProjectID)
	if e != nil {
		return sqlc.TextGenCreateParams{}, e
	}
	canvas, e := persistenceid.Parse(state.CanvasID)
	if e != nil {
		return sqlc.TextGenCreateParams{}, e
	}
	node, e := persistenceid.Parse(state.NodeID)
	if e != nil {
		return sqlc.TextGenCreateParams{}, e
	}
	inputs, e := json.Marshal(state.Inputs)
	if e != nil {
		return sqlc.TextGenCreateParams{}, e
	}
	return sqlc.TextGenCreateParams{
		TaskRunID:      id.String(),
		TenantID:       scope.TenantID,
		WorkspaceID:    scope.WorkspaceID,
		ProjectID:      project.String(),
		CanvasID:       canvas.String(),
		NodeID:         node.String(),
		CreatedBy:      scope.CallerID,
		Prompt:         state.Prompt,
		ModelServiceID: state.ModelServiceID,
		Inputs:         inputs,
		Content:        state.Content,
		Status:         string(state.Status),
		CreatedAt:      state.CreatedAt,
		UpdatedAt:      state.UpdatedAt,
	}, nil
}

func fromRow(v sqlc.CanvasTextGeneration) (app.Session, error) {
	var inputs []domaingenerationinput.Input
	if len(v.Inputs) > 0 {
		if err := json.Unmarshal(v.Inputs, &inputs); err != nil {
			return app.Session{}, err
		}
	}
	state := app.Session{ID: v.TaskRunID, ProjectID: v.ProjectID, CanvasID: v.CanvasID, NodeID: v.NodeID, Prompt: v.Prompt, ModelServiceID: v.ModelServiceID, Inputs: inputs, Content: v.Content, Status: task.Status(v.Status), CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt, FinishedAt: v.FinishedAt}
	if v.ErrorCode != "" || v.ErrorMessage != "" {
		state.Failure = &app.Failure{Code: v.ErrorCode, Message: v.ErrorMessage}
	}
	return state, nil
}

func parseHistoryScopeIDs(projectID, canvasID, nodeID string) (persistenceid.UUID, persistenceid.UUID, persistenceid.UUID, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvas, err := persistenceid.Parse(canvasID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	node, err := persistenceid.Parse(nodeID)
	return project, canvas, node, err
}

// Offset fences duplicate/out-of-order provider writes. The journal callback
// persists this checkpoint and its UTF-8 suffix in the same database transaction.
func (r *Repository) Append(ctx context.Context, scope applicationcanvas.Scope, id string, offset int64, delta string, now time.Time) error {
	parsed, err := persistenceid.Parse(id)
	if err != nil {
		return app.ErrNotFound
	}
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		affected, err := r.store.Queries(ctx).TextGenAppend(ctx, sqlc.TextGenAppendParams{
			TenantID:       scope.TenantID,
			WorkspaceID:    scope.WorkspaceID,
			CreatedBy:      scope.CallerID,
			TaskRunID:      parsed.String(),
			UpdatedAt:      now,
			Delta:          delta,
			ExpectedOffset: offset,
		})
		if err != nil {
			return err
		}
		if affected != 1 {
			return app.ErrNotFound
		}
		return nil
	})
}
