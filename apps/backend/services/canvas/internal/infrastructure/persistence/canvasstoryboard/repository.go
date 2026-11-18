package canvasstoryboard

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type Repository struct{ store *persistencetransaction.Store }

func NewRepository(store *persistencetransaction.Store) *Repository { return &Repository{store: store} }

type nodeRow = sqlc.CanvasNode

type nodeDocument struct {
	Payload json.RawMessage `json:"payload"`
}

type storyboardPayload struct {
	Version    int                                         `json:"version"`
	Plot       string                                      `json:"plot"`
	Session    applicationcanvas.StoryboardSession         `json:"session"`
	Generation applicationcanvas.StoryboardGenerationState `json:"generation"`
}

func (r *Repository) Create(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string, state applicationcanvas.StoryboardSession, now time.Time) error {
	return r.save(ctx, scope, projectID, canvasID, state.ID, state, now)
}

func (r *Repository) ListUnresolved(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID string) ([]applicationcanvas.StoryboardSession, error) {
	project, canvas, err := parseScopeIDs(projectID, canvasID)
	if err != nil {
		return nil, applicationcanvas.ErrStoryboardNotFound
	}
	rows, err := r.store.Queries(ctx).StoryboardList(ctx, sqlc.StoryboardListParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		CreatedBy:   scope.CallerID,
		Type:        int16(domaincanvas.NodeTypeStoryboardDraft),
		ProjectID:   project.String(),
		CanvasID:    canvas.String(),
	})
	if err != nil {
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
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error {
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
	})
}

func (r *Repository) save(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, state applicationcanvas.StoryboardSession, now time.Time) error {
	return r.store.WithinTransaction(ctx, func(ctx context.Context) error {
		row, err := r.get(ctx, scope, projectID, canvasID, taskRunID, true)
		if err != nil {
			return err
		}
		return r.saveRow(ctx, scope, row, state, now)
	})
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
	affected, err := r.store.Queries(ctx).StoryboardSave(ctx, sqlc.StoryboardSaveParams{
		NodeData:     encoded,
		UpdatedAt:    now.UTC(),
		CreatedBy:    scope.CallerID,
		TenantID:     scope.TenantID,
		WorkspaceID:  scope.WorkspaceID,
		Type:         int16(domaincanvas.NodeTypeStoryboardDraft),
		ID:           row.ID,
		FilterCanvas: true,
		ProjectID:    row.ProjectID,
		CanvasID:     row.CanvasID,
	})
	if err != nil {
		return err
	}
	if affected != 1 {
		return applicationcanvas.ErrStoryboardNotFound
	}
	return nil
}

func (r *Repository) get(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, taskRunID string, lock bool) (nodeRow, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return nodeRow{}, applicationcanvas.ErrStoryboardNotFound
	}
	args := sqlc.StoryboardGetParams{
		TenantID:    scope.TenantID,
		WorkspaceID: scope.WorkspaceID,
		CreatedBy:   scope.CallerID,
		Type:        int16(domaincanvas.NodeTypeStoryboardDraft),
		ID:          id.String(),
	}
	if projectID != "" && canvasID != "" {
		p, c, e := parseScopeIDs(projectID, canvasID)
		if e != nil {
			return nodeRow{}, applicationcanvas.ErrStoryboardNotFound
		}
		args.FilterCanvas = true
		args.ProjectID = p.String()
		args.CanvasID = c.String()
	}
	var row nodeRow
	if lock {
		row, err = r.store.Queries(ctx).StoryboardGetLocked(ctx, sqlc.StoryboardGetLockedParams(args))
	} else {
		row, err = r.store.Queries(ctx).StoryboardGet(ctx, args)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
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
	if payload.Version != 1 || payload.Session.ID != row.ID || payload.Session.ProjectID != row.ProjectID ||
		payload.Session.CanvasID != row.CanvasID {
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
