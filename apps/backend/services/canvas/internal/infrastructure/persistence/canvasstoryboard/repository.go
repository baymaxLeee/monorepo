package canvasstoryboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

type nodeRow struct {
	ID          persistenceid.UUID
	TenantID    string
	WorkspaceID *string
	ProjectID   persistenceid.UUID
	CanvasID    persistenceid.UUID
	Type        int16
	NodeData    []byte
	CreatedBy   string
	DeletedAt   int64
}

func (nodeRow) TableName() string { return "canvas_nodes" }

type nodeDocument struct {
	Payload json.RawMessage `json:"payload"`
}

type storyboardPayload struct {
	Version    int                                         `json:"version"`
	Plot       string                                      `json:"plot"`
	Session    applicationcanvas.StoryboardSession         `json:"session"`
	Generation applicationcanvas.StoryboardGenerationState `json:"generation"`
}

func (r *Repository) dbFor(ctx context.Context) *gorm.DB { return persistencetransaction.DB(ctx, r.db) }

func (r *Repository) Create(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string, state applicationcanvas.StoryboardSession, now time.Time) error {
	return r.save(ctx, scope, projectID, canvasID, state.ID, state, now)
}

func (r *Repository) ListUnresolved(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string) ([]applicationcanvas.StoryboardSession, error) {
	project, canvas, err := parseScopeIDs(projectID, canvasID)
	if err != nil {
		return nil, applicationcanvas.ErrStoryboardNotFound
	}
	var rows []nodeRow
	query := scoped(r.dbFor(ctx), scope).Where(
		"project_id = ? AND canvas_id = ? AND created_by = ? AND type = ? AND deleted_at = 0",
		project, canvas, scope.CallerID, domaincanvas.NodeTypeStoryboardDraft,
	).Order("created_at ASC").Order("id ASC")
	if err = query.Find(&rows).Error; err != nil {
		return nil, err
	}
	states := make([]applicationcanvas.StoryboardSession, 0, len(rows))
	for _, row := range rows {
		state, decodeErr := decodeState(row)
		if decodeErr != nil {
			return nil, decodeErr
		}
		states = append(states, state)
	}
	return states, nil
}

func (r *Repository) GetByTaskRunID(ctx context.Context, scope applicationcanvas.Scope, taskRunID string) (applicationcanvas.StoryboardSession, error) {
	row, err := r.get(ctx, scope, "", "", taskRunID, false)
	if err != nil {
		return applicationcanvas.StoryboardSession{}, err
	}
	return decodeState(row)
}

func (r *Repository) MarkRunning(ctx context.Context, scope applicationcanvas.Scope, taskRunID string, now time.Time) error {
	return r.mutate(ctx, scope, "", "", taskRunID, now, func(state *applicationcanvas.StoryboardSession) error {
		if state.Status != applicationcanvas.StoryboardStatusQueued {
			return applicationcanvas.ErrStoryboardNotFound
		}
		state.Status = applicationcanvas.StoryboardStatusRunning
		return nil
	})
}

func (r *Repository) Append(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, draft applicationcanvas.Draft, now time.Time) (bool, error) {
	added := false
	err := r.mutate(ctx, scope, projectID, canvasID, taskRunID, now, func(state *applicationcanvas.StoryboardSession) error {
		if state.Status != applicationcanvas.StoryboardStatusRunning {
			return applicationcanvas.ErrStoryboardNotFound
		}
		for index := range state.Drafts {
			if state.Drafts[index].CanvasNodeNo == draft.CanvasNodeNo {
				if state.Drafts[index].ID == draft.ID {
					state.Drafts[index] = draft
				}
				return nil
			}
		}
		state.Drafts = append(state.Drafts, draft)
		added = true
		sort.Slice(state.Drafts, func(i, j int) bool { return state.Drafts[i].CanvasNodeNo < state.Drafts[j].CanvasNodeNo })
		return nil
	})
	return added, err
}

func (r *Repository) SaveGenerationState(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, generation applicationcanvas.StoryboardGenerationState, now time.Time) error {
	return r.mutate(ctx, scope, projectID, canvasID, taskRunID, now, func(state *applicationcanvas.StoryboardSession) error {
		if state.Status != applicationcanvas.StoryboardStatusRunning {
			return applicationcanvas.ErrStoryboardNotFound
		}
		state.Generation = generation
		return nil
	})
}

func (r *Repository) Finish(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, status applicationcanvas.StoryboardStatus, failure *applicationcanvas.StoryboardFailure, now time.Time) error {
	return r.mutate(ctx, scope, projectID, canvasID, taskRunID, now, func(state *applicationcanvas.StoryboardSession) error {
		if state.Status != applicationcanvas.StoryboardStatusRunning {
			return applicationcanvas.ErrStoryboardNotFound
		}
		state.Status, state.Failure = status, failure
		return nil
	})
}

// Resolve is represented by deleting the temporary canvas node in the same transaction.
func (r *Repository) Resolve(context.Context, applicationcanvas.Scope, string, string, string, applicationcanvas.StoryboardStatus, time.Time) error {
	return nil
}

func (r *Repository) mutate(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, now time.Time, update func(*applicationcanvas.StoryboardSession) error) error {
	row, err := r.get(ctx, scope, projectID, canvasID, taskRunID, true)
	if err != nil {
		return err
	}
	state, err := decodeState(row)
	if err != nil {
		return err
	}
	if err = update(&state); err != nil {
		return err
	}
	return r.saveRow(ctx, scope, row, state, now)
}

func (r *Repository) save(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, state applicationcanvas.StoryboardSession, now time.Time) error {
	row, err := r.get(ctx, scope, projectID, canvasID, taskRunID, true)
	if err != nil {
		return err
	}
	return r.saveRow(ctx, scope, row, state, now)
}

func (r *Repository) saveRow(ctx context.Context, scope applicationcanvas.Scope, row nodeRow, state applicationcanvas.StoryboardSession, now time.Time) error {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(row.NodeData, &document); err != nil {
		return err
	}
	payload, err := json.Marshal(storyboardPayload{Version: 1, Plot: state.Plot, Session: state, Generation: state.Generation})
	if err != nil {
		return err
	}
	document["payload"] = payload
	encoded, err := json.Marshal(document)
	if err != nil {
		return err
	}
	result := scoped(r.dbFor(ctx).Model(&nodeRow{}), scope).
		Where("id = ? AND project_id = ? AND canvas_id = ? AND type = ? AND deleted_at = 0", row.ID, row.ProjectID, row.CanvasID, domaincanvas.NodeTypeStoryboardDraft).
		Updates(map[string]any{"node_data": encoded, "updated_at": now.UTC(), "updated_by": scope.CallerID})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return applicationcanvas.ErrStoryboardNotFound
	}
	return nil
}

func (r *Repository) get(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, lock bool) (nodeRow, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return nodeRow{}, applicationcanvas.ErrStoryboardNotFound
	}
	query := scoped(r.dbFor(ctx), scope).Where("id = ? AND created_by = ? AND type = ? AND deleted_at = 0", id, scope.CallerID, domaincanvas.NodeTypeStoryboardDraft)
	if projectID != "" && canvasID != "" {
		project, canvas, parseErr := parseScopeIDs(projectID, canvasID)
		if parseErr != nil {
			return nodeRow{}, applicationcanvas.ErrStoryboardNotFound
		}
		query = query.Where("project_id = ? AND canvas_id = ?", project, canvas)
	}
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var row nodeRow
	if err = query.First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nodeRow{}, applicationcanvas.ErrStoryboardNotFound
		}
		return nodeRow{}, err
	}
	return row, nil
}

func decodeState(row nodeRow) (applicationcanvas.StoryboardSession, error) {
	var document nodeDocument
	if err := json.Unmarshal(row.NodeData, &document); err != nil {
		return applicationcanvas.StoryboardSession{}, err
	}
	var payload storyboardPayload
	if err := json.Unmarshal(document.Payload, &payload); err != nil {
		return applicationcanvas.StoryboardSession{}, err
	}
	if payload.Version != 1 || payload.Session.ID != row.ID.String() || payload.Session.ProjectID != row.ProjectID.String() ||
		payload.Session.CanvasID != row.CanvasID.String() {
		return applicationcanvas.StoryboardSession{}, fmt.Errorf("invalid storyboard draft node payload identity")
	}
	state := payload.Session
	state.Generation = payload.Generation
	return state, nil
}

func parseScopeIDs(projectID, canvasID string) (persistenceid.UUID, persistenceid.UUID, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvas, err := persistenceid.Parse(canvasID)
	return project, canvas, err
}

func scoped(db *gorm.DB, scope applicationcanvas.Scope) *gorm.DB {
	query := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}
