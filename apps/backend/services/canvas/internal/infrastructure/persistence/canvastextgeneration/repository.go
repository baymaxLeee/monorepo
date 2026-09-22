package canvastextgeneration

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	app "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	"github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository              { return &Repository{db: db} }
func (r *Repository) dbFor(ctx context.Context) *gorm.DB { return persistencetransaction.DB(ctx, r.db) }
func (r *Repository) Create(ctx context.Context, scope applicationcanvas.Scope, state app.Session) error {
	value, err := toRow(scope, state)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Create(&value).Error
}
func (r *Repository) Get(ctx context.Context, scope applicationcanvas.Scope, taskRunID string) (app.Session, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return app.Session{}, app.ErrNotFound
	}
	var value row
	err = scopeQuery(r.dbFor(ctx), scope).Where("task_run_id = ? AND created_by = ?", id, scope.CallerID).First(&value).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app.Session{}, app.ErrNotFound
	}
	if err != nil {
		return app.Session{}, err
	}
	return fromRow(value), nil
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
	var value row
	err = scopeQuery(r.dbFor(ctx), scope).Where(
		"project_id = ? AND canvas_id = ? AND node_id = ? AND task_run_id = ? AND created_by = ?",
		project, canvas, node, id, scope.CallerID,
	).First(&value).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return app.Session{}, app.ErrNotFound
	}
	if err != nil {
		return app.Session{}, err
	}
	return fromRow(value), nil
}
func (r *Repository) List(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID string) ([]app.Session, error) {
	project, canvas, node, err := parseHistoryScopeIDs(projectID, canvasID, nodeID)
	if err != nil {
		return nil, app.ErrNotFound
	}
	var rows []row
	err = scopeQuery(r.dbFor(ctx), scope).Where(
		"project_id = ? AND canvas_id = ? AND node_id = ? AND created_by = ?",
		project, canvas, node, scope.CallerID,
	).Order("created_at DESC").Order("task_run_id DESC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	items := make([]app.Session, 0, len(rows))
	for index := range rows {
		items = append(items, fromRow(rows[index]))
	}
	return items, nil
}
func (r *Repository) MarkRunning(ctx context.Context, scope applicationcanvas.Scope, id string, now time.Time) error {
	return r.update(ctx, scope, id, map[string]any{"status": task.StatusRunning, "updated_at": now}, task.StatusQueued)
}
func (r *Repository) Append(ctx context.Context, scope applicationcanvas.Scope, id, delta string, now time.Time) error {
	parsed, err := persistenceid.Parse(id)
	if err != nil {
		return app.ErrNotFound
	}
	result := scopeQuery(r.dbFor(ctx).Model(&row{}), scope).Where("task_run_id = ? AND created_by = ? AND status = ?", parsed, scope.CallerID, task.StatusRunning).Updates(map[string]any{"content": gorm.Expr("CONCAT(content, ?)", delta), "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return app.ErrNotFound
	}
	return nil
}
func (r *Repository) Finish(ctx context.Context, scope applicationcanvas.Scope, id string, status task.Status, failure *app.Failure, now time.Time) error {
	updates := map[string]any{"status": status, "updated_at": now, "finished_at": now}
	if failure != nil {
		updates["error_code"], updates["error_message"] = failure.Code, failure.Message
	}
	parsed, err := persistenceid.Parse(id)
	if err != nil {
		return app.ErrNotFound
	}
	result := scopeQuery(r.dbFor(ctx).Model(&row{}), scope).Where("task_run_id = ? AND created_by = ? AND status IN ?", parsed, scope.CallerID, []task.Status{task.StatusQueued, task.StatusRunning}).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return app.ErrNotFound
	}
	return nil
}
func (r *Repository) update(ctx context.Context, scope applicationcanvas.Scope, id string, updates map[string]any, expected task.Status) error {
	parsed, err := persistenceid.Parse(id)
	if err != nil {
		return app.ErrNotFound
	}
	result := scopeQuery(r.dbFor(ctx).Model(&row{}), scope).Where("task_run_id = ? AND created_by = ? AND status = ?", parsed, scope.CallerID, expected).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return app.ErrNotFound
	}
	return nil
}
func toRow(scope applicationcanvas.Scope, state app.Session) (row, error) {
	id, e := persistenceid.Parse(state.ID)
	if e != nil {
		return row{}, e
	}
	project, e := persistenceid.Parse(state.ProjectID)
	if e != nil {
		return row{}, e
	}
	canvas, e := persistenceid.Parse(state.CanvasID)
	if e != nil {
		return row{}, e
	}
	node, e := persistenceid.Parse(state.NodeID)
	if e != nil {
		return row{}, e
	}
	return row{TaskRunID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: project, CanvasID: canvas, NodeID: node, CreatedBy: scope.CallerID, Prompt: state.Prompt, ModelServiceID: state.ModelServiceID, Inputs: state.Inputs, Content: state.Content, Status: string(state.Status), CreatedAt: state.CreatedAt, UpdatedAt: state.UpdatedAt}, nil
}
func fromRow(v row) app.Session {
	state := app.Session{ID: v.TaskRunID.String(), ProjectID: v.ProjectID.String(), CanvasID: v.CanvasID.String(), NodeID: v.NodeID.String(), Prompt: v.Prompt, ModelServiceID: v.ModelServiceID, Inputs: append([]domaingenerationinput.Input(nil), v.Inputs...), Content: v.Content, Status: task.Status(v.Status), CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt, FinishedAt: v.FinishedAt}
	if v.ErrorCode != "" || v.ErrorMessage != "" {
		state.Failure = &app.Failure{Code: v.ErrorCode, Message: v.ErrorMessage}
	}
	return state
}
func scopeQuery(db *gorm.DB, scope applicationcanvas.Scope) *gorm.DB {
	q := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return q.Where("workspace_id IS NULL")
	}
	return q.Where("workspace_id = ?", *scope.WorkspaceID)
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
