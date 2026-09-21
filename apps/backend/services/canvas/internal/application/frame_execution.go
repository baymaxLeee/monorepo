package application

import (
	"context"
	"io"
	"os"

	contract "github.com/example/monorepo/canvas/internal/contract/firstlastframe"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	worker "github.com/example/monorepo/canvas/internal/worker/application/firstlastframe"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FrameExecutionResult struct {
	Status string `json:"status"`
}
type frameControl struct{ service *Service }

type frameScope struct {
	row        p.VideoFrames
	generation p.Generation
	board      p.Board
	project    p.Project
	asset      p.Asset
}

func loadFrameScope(tx *gorm.DB, id string, lock bool) (frameScope, error) {
	var out frameScope
	if err := tx.First(&out.row, "id = ?", id).Error; err != nil {
		return out, NotFound()
	}
	if err := tx.First(&out.generation, "id = ? AND status = 'completed'", out.row.GenerationID).Error; err != nil {
		return out, NotFound()
	}
	if err := tx.First(&out.board, "id = ?", out.generation.CanvasID).Error; err != nil {
		return out, NotFound()
	}
	q := tx
	if lock {
		q = tx.Clauses(clause.Locking{Strength: "SHARE"}).Session(&gorm.Session{})
	}
	if err := q.Where("id = ? AND tenant_id = ? AND workspace_id = ?", out.board.ProjectID, out.generation.TenantID, out.generation.WorkspaceID).First(&out.project).Error; err != nil {
		return out, NotFound()
	}
	if lock {
		if err := q.First(&out.board, "id = ?", out.generation.CanvasID).Error; err != nil {
			return out, NotFound()
		}
	}
	var node p.Node
	if err := q.First(&node, "id = ? AND canvas_id = ?", out.generation.NodeID, out.board.ID).Error; err != nil {
		return out, NotFound()
	}
	if lock {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&out.row, "id = ?", id).Error; err != nil {
			return out, err
		}
	}
	if out.row.CancelRequested || out.row.Status == "failed" || out.row.Status == "cancelled" {
		return out, &Error{Status: 409, Code: "frames_terminal", Message: "提帧任务已结束"}
	}
	if err := tx.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'CANVAS_GENERATION_OUTPUT' AND owner_key = ? AND deleted_at IS NULL)", out.generation.OutputAssetID, out.project.TenantID, out.project.WorkspaceID, out.project.ID, out.generation.ID).First(&out.asset).Error; err != nil {
		return out, NotFound()
	}
	return out, nil
}
func (c frameControl) GetExecution(ctx context.Context, id string) (worker.GetExecutionResponse, error) {
	v, err := loadFrameScope(c.service.DB.WithContext(ctx), id, false)
	if err != nil {
		return worker.GetExecutionResponse{}, err
	}
	if v.row.Status == "completed" {
		return worker.GetExecutionResponse{State: worker.StateSucceeded}, nil
	}
	return worker.GetExecutionResponse{State: worker.StateReady, Execution: &contract.Execution{TaskRunID: id, GenerationTaskRunID: v.generation.ID, TenantID: v.project.TenantID, WorkspaceID: &v.project.WorkspaceID, ProjectID: v.project.ID, CreatedBy: v.generation.UserID, SourceArtifactID: v.asset.ArtifactID, SourceArtifactNamespace: storage.Scope(v.project.TenantID, v.project.WorkspaceID, v.project.ID), FirstFrameCheckpointID: v.row.FirstKey, LastFrameCheckpointID: v.row.LastKey, FirstFrameCheckpointSizeBytes: v.row.FirstSize, LastFrameCheckpointSizeBytes: v.row.LastSize}}, nil
}
func (c frameControl) RecordCheckpoint(ctx context.Context, id string, result contract.Result) error {
	return c.service.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		v, err := loadFrameScope(tx, id, true)
		if err != nil {
			return err
		}
		if v.row.Status == "completed" {
			return nil
		}
		if v.row.FirstKey == "" && result.FirstFrameArtifactID != "" {
			v.row.FirstKey = result.FirstFrameArtifactID
			v.row.FirstSize = result.FirstFrameSizeBytes
		}
		if v.row.LastKey == "" && result.LastFrameArtifactID != "" {
			v.row.LastKey = result.LastFrameArtifactID
			v.row.LastSize = result.LastFrameSizeBytes
		}
		return tx.Save(&v.row).Error
	})
}
func (c frameControl) CommitSuccess(ctx context.Context, id string, result contract.Result) error {
	return c.service.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		v, err := loadFrameScope(tx, id, true)
		if err != nil {
			return err
		}
		if v.row.Status == "completed" {
			return nil
		}
		if v.row.FirstKey == "" || v.row.LastKey == "" || v.row.FirstKey != result.FirstFrameArtifactID || v.row.LastKey != result.LastFrameArtifactID {
			return Invalid("提帧结果未完成保存")
		}
		for _, frame := range []struct {
			key, owner string
			id         *string
		}{{v.row.FirstKey, "VIDEO_GENERATION_FIRST_FRAME", &v.row.FirstAssetID}, {v.row.LastKey, "VIDEO_GENERATION_LAST_FRAME", &v.row.LastAssetID}} {
			asset := p.Asset{ID: newID(), TenantID: v.project.TenantID, WorkspaceID: v.project.WorkspaceID, ProjectID: v.project.ID, ArtifactID: frame.key, MimeType: "image/jpeg"}
			if err := tx.Create(&asset).Error; err != nil {
				return err
			}
			if err := tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: frame.owner, OwnerKey: v.generation.ID}).Error; err != nil {
				return err
			}
			*frame.id = asset.ID
		}
		v.row.Status = "completed"
		return tx.Save(&v.row).Error
	})
}
func (c frameControl) CommitFailure(ctx context.Context, id string) error {
	return c.service.DB.WithContext(ctx).Model(&p.VideoFrames{}).Where("id = ? AND status IN ?", id, []string{"queued", "running"}).Update("status", "failed").Error
}

type frameFiles struct {
	store *storage.Client
	scope string
}

func (f frameFiles) OpenArtifact(ctx context.Context, _, _, key, _ string) (io.ReadCloser, error) {
	return f.store.Get(ctx, f.scope, key)
}
func (f frameFiles) SaveArtifact(ctx context.Context, _, _, _, _, path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return f.store.Put(ctx, f.scope, file)
}
func (s *Service) ExecuteFrames(ctx context.Context, id string) (FrameExecutionResult, error) {
	v, err := loadFrameScope(s.DB.WithContext(ctx), id, false)
	if err != nil {
		return FrameExecutionResult{}, err
	}
	files := frameFiles{store: s.Storage, scope: storage.Scope(v.project.TenantID, v.project.WorkspaceID, v.project.ID)}
	err = worker.NewExecutor(frameControl{service: s}, files, worker.NewFFmpegExtractor(nil), "").Execute(ctx, id)
	return FrameExecutionResult{Status: "completed"}, err
}
