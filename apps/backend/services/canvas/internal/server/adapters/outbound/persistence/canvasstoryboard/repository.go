package canvasstoryboard

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/persistenceid"
	persistencetransaction "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	applicationcanvasnode "github.com/example/monorepo/canvas/internal/server/application/canvas"
	domainvideo "github.com/example/monorepo/canvas/internal/server/domain/videogeneration"
)

type Repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) dbFor(ctx context.Context) *gorm.DB {
	return persistencetransaction.DB(ctx, r.db)
}

func (r *Repository) Create(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID string, state applicationcanvasnode.StoryboardSession, now time.Time) error {
	value, err := toRow(scope, projectID, canvasID, state, now)
	if err != nil {
		return err
	}
	return r.dbFor(ctx).Create(&value).Error
}

func (r *Repository) ListUnresolved(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID string) ([]applicationcanvasnode.StoryboardSession, error) {
	project, canvas, err := parseScopeIDs(projectID, canvasID)
	if err != nil {
		return nil, applicationcanvasnode.ErrStoryboardNotFound
	}
	var values []row
	query := scopeQuery(r.dbFor(ctx), scope).Where(
		"project_id = ? AND canvas_id = ? AND created_by = ? AND resolved_at IS NULL",
		project, canvas, scope.CallerID,
	).Order("created_at ASC").Order("task_run_id ASC")
	if err = query.Find(&values).Error; err != nil {
		return nil, err
	}
	states := make([]applicationcanvasnode.StoryboardSession, 0, len(values))
	for index := range values {
		state, mapErr := fromRow(values[index])
		if mapErr != nil {
			return nil, mapErr
		}
		states = append(states, state)
	}
	return states, nil
}

func (r *Repository) GetByTaskRunID(ctx context.Context, scope applicationcanvasnode.Scope, taskRunID string) (applicationcanvasnode.StoryboardSession, error) {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return applicationcanvasnode.StoryboardSession{}, applicationcanvasnode.ErrStoryboardNotFound
	}
	var value row
	query := scopeQuery(r.dbFor(ctx), scope).Where("task_run_id = ? AND created_by = ? AND resolved_at IS NULL", id, scope.CallerID)
	if err = query.First(&value).Error; err != nil {
		return applicationcanvasnode.StoryboardSession{}, readErr(err)
	}
	return fromRow(value)
}

func (r *Repository) MarkRunning(ctx context.Context, scope applicationcanvasnode.Scope, taskRunID string, now time.Time) error {
	id, err := persistenceid.Parse(taskRunID)
	if err != nil {
		return applicationcanvasnode.ErrStoryboardNotFound
	}
	result := scopeQuery(r.dbFor(ctx).Model(&row{}), scope).Where(
		"task_run_id = ? AND created_by = ? AND resolved_at IS NULL AND status = ?",
		id, scope.CallerID, applicationcanvasnode.StoryboardStatusQueued,
	).Updates(map[string]any{"status": applicationcanvasnode.StoryboardStatusRunning, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return applicationcanvasnode.ErrStoryboardNotFound
	}
	return nil
}

func (r *Repository) Append(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID, taskRunID string, draft applicationcanvasnode.Draft, now time.Time) (bool, error) {
	added := false
	err := r.mutate(ctx, scope, projectID, canvasID, taskRunID, func(value *row, drafts *[]applicationcanvasnode.Draft) error {
		if value.Status != string(applicationcanvasnode.StoryboardStatusRunning) {
			return applicationcanvasnode.ErrStoryboardNotFound
		}
		for index := range *drafts {
			if (*drafts)[index].CanvasNodeNo == draft.CanvasNodeNo {
				if (*drafts)[index].ID == draft.ID {
					// Asset matching enriches an already visible prompt under the same
					// stable ID. A different ID is a recovery retry and must not replace
					// the first durably accepted creative result.
					(*drafts)[index] = draft
					value.UpdatedAt = now
				}
				return nil
			}
		}
		*drafts = append(*drafts, draft)
		added = true
		sort.Slice(*drafts, func(left, right int) bool {
			return (*drafts)[left].CanvasNodeNo < (*drafts)[right].CanvasNodeNo
		})
		value.UpdatedAt = now
		return nil
	})
	return added, err
}

func (r *Repository) SaveGenerationState(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID, taskRunID string,
	state applicationcanvasnode.StoryboardGenerationState,
	now time.Time,
) error {
	if state.ProtocolVersion != applicationcanvasnode.StoryboardGenerationProtocolVersion {
		return errors.New("invalid storyboard generation state")
	}
	sourceBeats, err := json.Marshal(state.SourceBeats)
	if err != nil {
		return err
	}
	plan, err := json.Marshal(state.Plan)
	if err != nil {
		return err
	}
	return r.mutate(ctx, scope, projectID, canvasID, taskRunID, func(value *row, _ *[]applicationcanvasnode.Draft) error {
		if value.Status != string(applicationcanvasnode.StoryboardStatusRunning) {
			return applicationcanvasnode.ErrStoryboardNotFound
		}
		value.ProtocolVersion = int32(state.ProtocolVersion)
		value.SourceBeatsJSON = stringPointer(string(sourceBeats))
		value.PlanJSON = stringPointer(string(plan))
		value.UpdatedAt = now
		return nil
	})
}

func (r *Repository) Finish(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID, taskRunID string, status applicationcanvasnode.StoryboardStatus, failure *applicationcanvasnode.StoryboardFailure, now time.Time) error {
	return r.mutate(ctx, scope, projectID, canvasID, taskRunID, func(value *row, _ *[]applicationcanvasnode.Draft) error {
		if value.Status != string(applicationcanvasnode.StoryboardStatusRunning) {
			return applicationcanvasnode.ErrStoryboardNotFound
		}
		value.Status = string(status)
		value.UpdatedAt = now
		if failure != nil {
			value.ErrorCode, value.ErrorMessage = failure.Code, failure.Message
			diagnosticValues := failure.Diagnostics
			if diagnosticValues == nil {
				diagnosticValues = []applicationcanvasnode.StoryboardRoundDiagnostic{}
			}
			diagnostics, err := json.Marshal(diagnosticValues)
			if err != nil {
				return err
			}
			value.DiagnosticsJSON = string(diagnostics)
		}
		return nil
	})
}

func (r *Repository) Resolve(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID, taskRunID string, status applicationcanvasnode.StoryboardStatus, now time.Time) error {
	project, canvas, id, err := parseIDs(projectID, canvasID, taskRunID)
	if err != nil {
		return applicationcanvasnode.ErrStoryboardNotFound
	}
	result := scopeQuery(r.dbFor(ctx).Model(&row{}), scope).Where(
		"task_run_id = ? AND project_id = ? AND canvas_id = ? AND created_by = ? AND resolved_at IS NULL",
		id, project, canvas, scope.CallerID,
	).Updates(map[string]any{"status": status, "resolved_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return applicationcanvasnode.ErrStoryboardNotFound
	}
	return nil
}

func (r *Repository) mutate(ctx context.Context, scope applicationcanvasnode.Scope, projectID, canvasID, taskRunID string, update func(*row, *[]applicationcanvasnode.Draft) error) error {
	project, canvas, id, err := parseIDs(projectID, canvasID, taskRunID)
	if err != nil {
		return applicationcanvasnode.ErrStoryboardNotFound
	}
	db := r.dbFor(ctx)
	var value row
	query := scopeQuery(db.Clauses(clause.Locking{Strength: "UPDATE"}), scope).Where(
		"task_run_id = ? AND project_id = ? AND canvas_id = ? AND created_by = ? AND resolved_at IS NULL",
		id, project, canvas, scope.CallerID,
	)
	if err = query.First(&value).Error; err != nil {
		return readErr(err)
	}
	var drafts []applicationcanvasnode.Draft
	if err = json.Unmarshal([]byte(value.DraftsJSON), &drafts); err != nil {
		return err
	}
	if err = update(&value, &drafts); err != nil {
		return err
	}
	payload, err := json.Marshal(drafts)
	if err != nil {
		return err
	}
	return db.Model(&row{}).Where("task_run_id = ?", id).Updates(map[string]any{
		"status": value.Status, "drafts_json": string(payload),
		"protocol_version": value.ProtocolVersion, "source_beats_json": value.SourceBeatsJSON,
		"plan_json":        value.PlanJSON,
		"diagnostics_json": value.DiagnosticsJSON, "error_code": value.ErrorCode,
		"error_message": value.ErrorMessage, "updated_at": value.UpdatedAt,
	}).Error
}

func toRow(scope applicationcanvasnode.Scope, projectID, canvasID string, state applicationcanvasnode.StoryboardSession, now time.Time) (row, error) {
	project, canvas, id, err := parseIDs(projectID, canvasID, state.ID)
	if err != nil {
		return row{}, err
	}
	drafts, err := json.Marshal(state.Drafts)
	if err != nil {
		return row{}, err
	}
	protocolVersion := state.Generation.ProtocolVersion
	if protocolVersion == 0 {
		protocolVersion = 1
	}
	return row{
		TaskRunID: id, TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID,
		ProjectID: project, CanvasID: canvas, CreatedBy: scope.CallerID,
		Plot: state.Plot, VideoModelServiceID: state.ModelConfig.VideoModelServiceID,
		InferenceModelServiceID:      state.ModelConfig.InferenceModelServiceID,
		VideoResolution:              int16(state.ModelConfig.VideoParameters.Resolution),
		VideoAspectRatio:             int16(state.ModelConfig.VideoParameters.AspectRatio),
		VideoGenerateAudio:           state.ModelConfig.VideoParameters.GenerateAudio,
		VideoWatermark:               state.ModelConfig.VideoParameters.Watermark,
		CanvasNodeDurationMinSeconds: state.PlanningConfig.CanvasNodeDurationMinSeconds,
		CanvasNodeDurationMaxSeconds: state.PlanningConfig.CanvasNodeDurationMaxSeconds,
		TotalDurationMinSeconds:      state.PlanningConfig.TotalDurationMinSeconds,
		TotalDurationMaxSeconds:      state.PlanningConfig.TotalDurationMaxSeconds,
		MaxCanvasNodes:               int32(state.Limit), ProtocolVersion: int32(protocolVersion),
		Status: string(state.Status), DraftsJSON: string(drafts),
		DiagnosticsJSON: "[]",
		CreatedAt:       now, UpdatedAt: now,
	}, nil
}

func fromRow(value row) (applicationcanvasnode.StoryboardSession, error) {
	var drafts []applicationcanvasnode.Draft
	if err := json.Unmarshal([]byte(value.DraftsJSON), &drafts); err != nil {
		return applicationcanvasnode.StoryboardSession{}, err
	}
	protocolVersion := int(value.ProtocolVersion)
	if protocolVersion == 0 {
		protocolVersion = 1
	}
	state := applicationcanvasnode.StoryboardSession{
		ID: value.TaskRunID.String(), ProjectID: value.ProjectID.String(), CanvasID: value.CanvasID.String(),
		Plot: value.Plot, ModelConfig: applicationcanvasnode.StoryboardModelConfig{
			InferenceModelServiceID: value.InferenceModelServiceID,
			VideoModelServiceID:     value.VideoModelServiceID,
			VideoParameters: applicationcanvasnode.StoryboardVideoParameters{
				Resolution:    domainvideo.Resolution(value.VideoResolution),
				AspectRatio:   domainvideo.AspectRatio(value.VideoAspectRatio),
				GenerateAudio: value.VideoGenerateAudio,
				Watermark:     value.VideoWatermark,
			},
		},
		PlanningConfig: applicationcanvasnode.StoryboardPlanningConfig{
			CanvasNodeDurationMinSeconds: value.CanvasNodeDurationMinSeconds,
			CanvasNodeDurationMaxSeconds: value.CanvasNodeDurationMaxSeconds,
			TotalDurationMinSeconds:      value.TotalDurationMinSeconds,
			TotalDurationMaxSeconds:      value.TotalDurationMaxSeconds,
		},
		Limit: int(value.MaxCanvasNodes), Status: applicationcanvasnode.StoryboardStatus(value.Status), Drafts: drafts,
		Generation: applicationcanvasnode.StoryboardGenerationState{
			ProtocolVersion: protocolVersion,
		},
		CreatedAt: value.CreatedAt,
	}
	if value.SourceBeatsJSON != nil && strings.TrimSpace(*value.SourceBeatsJSON) != "" {
		if err := json.Unmarshal([]byte(*value.SourceBeatsJSON), &state.Generation.SourceBeats); err != nil {
			return applicationcanvasnode.StoryboardSession{}, err
		}
	}
	if value.PlanJSON != nil && strings.TrimSpace(*value.PlanJSON) != "" {
		if err := json.Unmarshal([]byte(*value.PlanJSON), &state.Generation.Plan); err != nil {
			return applicationcanvasnode.StoryboardSession{}, err
		}
	}
	for _, draft := range drafts {
		state.Generation.Completed = append(state.Generation.Completed, draft.CanvasNodeNo)
	}
	if value.ErrorCode != "" || value.ErrorMessage != "" {
		var diagnostics []applicationcanvasnode.StoryboardRoundDiagnostic
		if strings.TrimSpace(value.DiagnosticsJSON) != "" {
			if err := json.Unmarshal([]byte(value.DiagnosticsJSON), &diagnostics); err != nil {
				return applicationcanvasnode.StoryboardSession{}, err
			}
		}
		state.Failure = &applicationcanvasnode.StoryboardFailure{
			Code: value.ErrorCode, Message: value.ErrorMessage, Diagnostics: diagnostics,
		}
	}
	return state, nil
}

func stringPointer(value string) *string { return &value }

func parseScopeIDs(projectID, canvasID string) (persistenceid.UUID, persistenceid.UUID, error) {
	project, err := persistenceid.Parse(projectID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	canvas, err := persistenceid.Parse(canvasID)
	return project, canvas, err
}

func parseIDs(projectID, canvasID, taskRunID string) (persistenceid.UUID, persistenceid.UUID, persistenceid.UUID, error) {
	project, canvas, err := parseScopeIDs(projectID, canvasID)
	if err != nil {
		return persistenceid.UUID{}, persistenceid.UUID{}, persistenceid.UUID{}, err
	}
	id, err := persistenceid.Parse(taskRunID)
	return project, canvas, id, err
}

func scopeQuery(db *gorm.DB, scope applicationcanvasnode.Scope) *gorm.DB {
	query := db.Where("tenant_id = ?", scope.TenantID)
	if scope.WorkspaceID == nil {
		return query.Where("workspace_id IS NULL")
	}
	return query.Where("workspace_id = ?", *scope.WorkspaceID)
}

func readErr(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return applicationcanvasnode.ErrStoryboardNotFound
	}
	return err
}
