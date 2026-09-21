package application

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	archiveRepo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/canvasarchive"
	taskRepo "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/task"
	txctx "github.com/example/monorepo/canvas/internal/server/adapters/outbound/persistence/transaction"
	archive "github.com/example/monorepo/canvas/internal/server/application/canvasarchive"
	task "github.com/example/monorepo/canvas/internal/server/domain/task"
	media "github.com/example/monorepo/canvas/internal/worker/application/canvasarchive"
	"gorm.io/gorm/clause"
)

type archiveClock struct{}

func (archiveClock) Now() time.Time         { return time.Now().UTC() }
func (archiveClock) NewID() (string, error) { return newID(), nil }

type archiveSnapshot struct {
	service *Service
	actor   Actor
}

func (s archiveSnapshot) Validate(ctx context.Context, scope archive.Scope, projectID, canvasID string) error {
	b, err := boardAccess(txctx.DB(ctx, s.service.DB), s.actor, canvasID, false)
	if err != nil {
		return err
	}
	if b.ProjectID != projectID {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound()
		}
		return err
	}
	return nil
}
func (s archiveSnapshot) SnapshotSelectedVideos(ctx context.Context, scope archive.Scope, projectID, canvasID string) ([]archive.SelectedVideo, error) {
	db := txctx.DB(ctx, s.service.DB)
	if err := s.Validate(ctx, scope, projectID, canvasID); err != nil {
		return nil, err
	}
	var board p.Board
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
		return nil, err
	}
	var nodes []p.Node
	if err := db.Where("canvas_id = ? AND type = ? AND asset_id <> ''", canvasID, 6).Order("storyboard_rank, created_at, id").Find(&nodes).Error; err != nil {
		return nil, err
	}
	items := make([]archive.SelectedVideo, 0, len(nodes))
	for _, node := range nodes {
		var output p.Generation
		if err := db.Where("canvas_id = ? AND node_id = ? AND output_asset_id = ? AND status = 'completed'", canvasID, node.ID, node.AssetID).First(&output).Error; err != nil {
			return nil, archive.ErrSelectedVideoUnavailable
		}
		var asset p.Asset
		if err := db.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND mime_type LIKE 'video/%'", node.AssetID, s.actor.TenantID, s.actor.WorkspaceID, projectID).First(&asset).Error; err != nil {
			return nil, archive.ErrSelectedVideoUnavailable
		}
		items = append(items, archive.SelectedVideo{CanvasName: board.Name, NodeID: node.ID, OutputID: output.ID, AssetID: asset.ID, ArtifactID: asset.ArtifactID, ArtifactNamespace: storage.Scope(s.actor.TenantID, s.actor.WorkspaceID, projectID)})
	}
	return items, nil
}
func (s *Service) archives(actor Actor) *archive.Service {
	repo := archiveRepo.NewRepository(s.DB)
	runs := taskRepo.NewRepository(s.DB)
	return archive.NewService(repo, archiveSnapshot{s, actor}, runs, archiveDispatch{s.DB}, txctx.New(s.DB), archiveClock{}, archiveClock{}, archive.WithCancellation(runs, archiveDispatch{s.DB}), archive.WithCanvasAccessValidator(archiveSnapshot{s, actor}))
}
func archiveScope(actor Actor) archive.Scope {
	return archive.Scope{TenantID: actor.TenantID, WorkspaceID: &actor.WorkspaceID, CallerID: actor.UserID}
}
func archiveDTO(v archive.Export) c.Archive {
	return c.Archive{ID: v.TaskRunID, Status: string(v.Status), Filename: v.OutputFilename, InputCount: v.InputCount, Size: v.OutputSize, CreatedAt: isoTime(v.CreatedAt), Error: v.ErrorMessage, Downloadable: v.DownloadPath(time.Now()) != nil}
}
func (s *Service) CreateArchive(ctx context.Context, actor Actor, canvasID string) (c.Archive, error) {
	var result archive.Export
	err := txctx.New(s.DB).WithinTransaction(ctx, func(ctx context.Context) error {
		db := txctx.DB(ctx, s.DB)
		board, err := boardAccess(db, actor, canvasID, true)
		if err != nil {
			return err
		}
		result, err = s.archives(actor).Create(ctx, archiveScope(actor), board.ProjectID, canvasID)
		if errors.Is(err, archive.ErrNoSelectedVideos) {
			return Invalid("画布中没有已选中的生成视频")
		}
		if err != nil {
			return err
		}

		return nil
	})
	return archiveDTO(result), err
}
func (s *Service) ListArchives(ctx context.Context, actor Actor, canvasID string) (c.ArchiveList, error) {
	board, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, false)
	if err != nil {
		return c.ArchiveList{}, err
	}
	rows, _, err := s.archives(actor).List(ctx, archive.ListInput{Scope: archiveScope(actor), ProjectID: board.ProjectID, CanvasID: canvasID, Page: archive.Page{PageSize: 100, PageNum: 1}})
	result := c.ArchiveList{Items: []c.Archive{}}
	for _, row := range rows {
		result.Items = append(result.Items, archiveDTO(row))
	}
	return result, err
}
func (s *Service) CancelArchive(ctx context.Context, actor Actor, canvasID, id string) (c.Deleted, error) {
	board, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, true)
	if err != nil {
		return c.Deleted{}, err
	}
	err = s.archives(actor).Cancel(ctx, archive.GetInput{Scope: archiveScope(actor), ProjectID: board.ProjectID, CanvasID: canvasID, TaskRunID: id})
	return c.Deleted{Deleted: err == nil}, err
}
func (s *Service) ArchiveContent(ctx context.Context, actor Actor, canvasID, id string) (MediaContent, error) {
	board, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, false)
	if err != nil {
		return MediaContent{}, err
	}
	row, err := s.archives(actor).Get(ctx, archive.GetInput{Scope: archiveScope(actor), ProjectID: board.ProjectID, CanvasID: canvasID, TaskRunID: id})
	if err != nil {
		return MediaContent{}, err
	}
	if row.DownloadPath(time.Now()) == nil {
		return MediaContent{}, NotFound()
	}
	body, err := s.Storage.Get(ctx, storage.Scope(actor.TenantID, actor.WorkspaceID, board.ProjectID), row.OutputPath)
	return MediaContent{Body: body, MIME: "application/zip"}, err
}

func (s *Service) ExecuteArchive(ctx context.Context, id string) (c.Archive, error) {
	repo := archiveRepo.NewRepository(s.DB)
	runs := taskRepo.NewRepository(s.DB)
	item, err := repo.GetByTaskRunID(ctx, id)
	if err != nil {
		return c.Archive{}, err
	}
	if item.Status == task.StatusSucceeded {
		return archiveDTO(item), nil
	}
	if item.WorkspaceID == nil {
		return c.Archive{}, NotFound()
	}
	actor := Actor{TenantID: item.TenantID, WorkspaceID: *item.WorkspaceID, UserID: item.CreatedBy}
	service := s.archives(actor)
	if err = s.archiveExecutionAccess(ctx, item); err != nil {
		return c.Archive{}, err
	}
	if item.Status == task.StatusQueued {
		run, err := runs.GetTaskRun(ctx, id)
		if err != nil {
			return c.Archive{}, err
		}
		if err = archive.NewAsyncExecutionStarter(repo, runs, txctx.New(s.DB)).MarkStarted(ctx, run, task.AsyncDispatch{}, time.Now().UTC()); err != nil {
			return c.Archive{}, err
		}
	}
	execution, err := service.LoadExecution(ctx, id)
	if err != nil {
		return c.Archive{}, err
	}
	item = execution.Export
	result := archive.SuccessResult{Path: item.OutputPath, SHA256: item.OutputSHA256, Size: item.OutputSize, UploadID: item.UploadID, PartSize: item.PartSize}
	if item.RetentionStartedAt != nil {
		result.RetentionStartedAt = *item.RetentionStartedAt
	}
	if result.Path == "" {
		dir, err := os.MkdirTemp("", "canvas-export-")
		if err != nil {
			return c.Archive{}, err
		}
		defer os.RemoveAll(dir)
		inputs := make([]media.Input, 0, len(execution.Inputs))
		for _, input := range execution.Inputs {
			inputs = append(inputs, media.Input{EntryName: input.EntryName, ArtifactID: input.ArtifactID, ExpectedSize: input.MediaSize, Open: func(ctx context.Context) (io.ReadCloser, error) {
				return s.Storage.Get(ctx, input.ArtifactNamespace, input.ArtifactID)
			}})
		}
		artifact, err := media.NewBuilder(media.NewFFprobeProber(nil)).Build(ctx, filepath.Join(dir, "archive.zip"), item.CreatedAt, strings.TrimSuffix(item.OutputFilename, ".zip")+".fcpxml", inputs)
		if err != nil {
			return c.Archive{}, err
		}
		file, err := os.Open(artifact.Path)
		if err != nil {
			return c.Archive{}, err
		}
		defer file.Close()
		key, err := s.Storage.Put(ctx, storage.Scope(item.TenantID, *item.WorkspaceID, item.ProjectID), file)
		if err != nil {
			return c.Archive{}, err
		}
		result = archive.SuccessResult{Path: key, SHA256: artifact.SHA256, Size: artifact.Size, RetentionStartedAt: time.Now().UTC()}
		if err = service.RecordOutput(ctx, id, result); err != nil {
			return c.Archive{}, err
		}
	}
	if err = ctx.Err(); err != nil {
		return c.Archive{}, err
	}
	if err = txctx.New(s.DB).WithinTransaction(ctx, func(ctx context.Context) error {
		if err := s.archiveExecutionAccess(ctx, item); err != nil {
			return err
		}
		return service.CommitSuccess(ctx, id, result)
	}); err != nil {
		return c.Archive{}, err
	}
	item, err = repo.GetByTaskRunID(ctx, id)
	return archiveDTO(item), err
}

func (s *Service) archiveExecutionAccess(ctx context.Context, item archive.Export) error {
	db := txctx.DB(ctx, s.DB)
	var project p.Project
	if err := db.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND tenant_id = ? AND workspace_id = ?", item.ProjectID, item.TenantID, item.WorkspaceID).First(&project).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound()
		}
		return err
	}
	var board p.Board
	if err := db.Clauses(clause.Locking{Strength: "SHARE"}).Where("id = ? AND project_id = ?", item.CanvasID, item.ProjectID).First(&board).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound()
		}
		return err
	}
	return nil
}
