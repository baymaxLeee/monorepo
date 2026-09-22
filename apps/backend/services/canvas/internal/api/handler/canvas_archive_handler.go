package http

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	thriftbase "github.com/example/monorepo/canvas/internal/api/contracts/base"
	thriftcanvas "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	thriftcommon "github.com/example/monorepo/canvas/internal/api/contracts/common"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvasarchive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const maxArchiveBatchGetIDs = 100

type canvasArchiveService interface {
	Create(context.Context, applicationcanvasarchive.Scope, string, string) (applicationcanvasarchive.Export, error)
	Get(context.Context, applicationcanvasarchive.GetInput) (applicationcanvasarchive.Export, error)
	BatchGet(context.Context, applicationcanvasarchive.BatchGetInput) ([]applicationcanvasarchive.Export, error)
	List(context.Context, applicationcanvasarchive.ListInput) ([]applicationcanvasarchive.Export, int64, error)
	Cancel(context.Context, applicationcanvasarchive.GetInput) error
}

type CanvasArchiveHandler struct {
	service canvasArchiveService
	now     func() time.Time
	content interface {
		Open(context.Context, applicationcanvasarchive.Export) (io.ReadCloser, error)
	}
}

func NewCanvasArchiveHandler(
	service *applicationcanvasarchive.Service,
	content interface {
		Open(context.Context, applicationcanvasarchive.Export) (io.ReadCloser, error)
	},
) *CanvasArchiveHandler {
	return &CanvasArchiveHandler{service: service, content: content, now: time.Now}
}

func (h *CanvasArchiveHandler) OpenProjectCanvasVideoArchiveExport(
	ctx context.Context,
	request *thriftcanvas.GetProjectCanvasVideoArchiveExportRequest,
) (io.ReadCloser, string, error) {
	if err := requireAction(ctx, "OpenProjectCanvasVideoArchiveExport"); err != nil {
		return nil, "", err
	}
	item, err := h.service.Get(ctx, archiveGetInput(ctx, request.WorkspaceID, request.ProjectID, request.CanvasID, request.TaskRunID))
	if err != nil {
		return nil, "", classifyArchiveError(err)
	}
	if item.DownloadPath(h.now()) == nil {
		return nil, "", errno.New(errno.ErrNotFound)
	}
	body, err := h.content.Open(ctx, item)
	return body, item.OutputFilename, err
}

func (h *CanvasArchiveHandler) StartProjectCanvasVideoArchiveExport(ctx context.Context, request *thriftcanvas.StartProjectCanvasVideoArchiveExportRequest) (*thriftcanvas.StartProjectCanvasVideoArchiveExportResponse, error) {
	if err := requireAction(ctx, "StartProjectCanvasVideoArchiveExport"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if strings.TrimSpace(request.ProjectID) == "" || strings.TrimSpace(request.CanvasID) == "" {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	item, err := h.service.Create(ctx, archiveScope(ctx, request.WorkspaceID), request.ProjectID, request.CanvasID)
	if err != nil {
		return nil, classifyArchiveError(err)
	}
	return &thriftcanvas.StartProjectCanvasVideoArchiveExportResponse{Export: archiveExportDTO(item, h.now())}, nil
}

func (h *CanvasArchiveHandler) GetProjectCanvasVideoArchiveExport(ctx context.Context, request *thriftcanvas.GetProjectCanvasVideoArchiveExportRequest) (*thriftcanvas.GetProjectCanvasVideoArchiveExportResponse, error) {
	if err := requireAction(ctx, "GetProjectCanvasVideoArchiveExport"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	item, err := h.service.Get(ctx, archiveGetInput(ctx, request.WorkspaceID, request.ProjectID, request.CanvasID, request.TaskRunID))
	if err != nil {
		return nil, classifyArchiveError(err)
	}
	return &thriftcanvas.GetProjectCanvasVideoArchiveExportResponse{Export: archiveExportDTO(item, h.now())}, nil
}

func (h *CanvasArchiveHandler) BatchGetProjectCanvasVideoArchiveExports(ctx context.Context, request *thriftcanvas.BatchGetProjectCanvasVideoArchiveExportsRequest) (*thriftcanvas.BatchGetProjectCanvasVideoArchiveExportsResponse, error) {
	if err := requireAction(ctx, "BatchGetProjectCanvasVideoArchiveExports"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if len(request.TaskRunIDs) > maxArchiveBatchGetIDs {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	items, err := h.service.BatchGet(ctx, applicationcanvasarchive.BatchGetInput{
		Scope: archiveScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
		CanvasID: request.CanvasID, TaskRunIDs: request.TaskRunIDs,
	})
	if err != nil {
		return nil, classifyArchiveError(err)
	}
	now := h.now()
	response := make([]*thriftcanvas.ProjectCanvasVideoArchiveExport, 0, len(items))
	for index := range items {
		response = append(response, archiveExportDTO(items[index], now))
	}
	return &thriftcanvas.BatchGetProjectCanvasVideoArchiveExportsResponse{Items: response}, nil
}

func (h *CanvasArchiveHandler) ListProjectCanvasVideoArchiveExports(ctx context.Context, request *thriftcanvas.ListProjectCanvasVideoArchiveExportsRequest) (*thriftcanvas.ListProjectCanvasVideoArchiveExportsResponse, error) {
	if err := requireAction(ctx, "ListProjectCanvasVideoArchiveExports"); err != nil {
		return nil, err
	}
	if request.Page == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	direction, err := archiveSortDirection(request.Sort)
	if err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	items, total, err := h.service.List(ctx, applicationcanvasarchive.ListInput{
		Scope: archiveScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, CanvasID: request.CanvasID,
		SortDirection: direction,
		Page:          applicationcanvasarchive.Page{PageSize: int(request.Page.PageSize), PageNum: int(request.Page.PageNum)},
	})
	if err != nil {
		return nil, classifyArchiveError(err)
	}
	now := h.now()
	responseItems := make([]*thriftcanvas.ProjectCanvasVideoArchiveExport, 0, len(items))
	for index := range items {
		responseItems = append(responseItems, archiveExportDTO(items[index], now))
	}
	return &thriftcanvas.ListProjectCanvasVideoArchiveExportsResponse{
		Items: responseItems,
		Page:  pageOutput(request.Page.PageSize, request.Page.PageNum, total),
	}, nil
}

func (h *CanvasArchiveHandler) CancelProjectCanvasVideoArchiveExport(ctx context.Context, request *thriftcanvas.CancelProjectCanvasVideoArchiveExportRequest) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "CancelProjectCanvasVideoArchiveExport"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.Cancel(ctx, archiveGetInput(ctx, request.WorkspaceID, request.ProjectID, request.CanvasID, request.TaskRunID)); err != nil {
		return nil, classifyArchiveError(err)
	}
	return &thriftbase.Empty{}, nil
}

func archiveScope(ctx context.Context, workspaceID *string) applicationcanvasarchive.Scope {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return applicationcanvasarchive.Scope{TenantID: metadata.TenantID, CallerID: metadata.UserID, WorkspaceID: nullableWorkspaceID(workspaceID)}
}

func archiveGetInput(ctx context.Context, workspaceID *string, projectID, canvasID, taskRunID string) applicationcanvasarchive.GetInput {
	return applicationcanvasarchive.GetInput{Scope: archiveScope(ctx, workspaceID), ProjectID: projectID, CanvasID: canvasID, TaskRunID: taskRunID}
}

func archiveSortDirection(sort *thriftcanvas.ProjectCanvasVideoArchiveExportSort) (applicationcanvasarchive.SortDirection, error) {
	if sort == nil {
		return applicationcanvasarchive.SortUnspecified, nil
	}
	if sort.IsSetField() &&
		sort.GetField() != thriftcanvas.ProjectCanvasVideoArchiveExportSortField_CREATED_AT {
		return applicationcanvasarchive.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
	if !sort.IsSetDirection() {
		return applicationcanvasarchive.SortUnspecified, nil
	}
	switch sort.GetDirection() {
	case thriftcommon.SortDirection_ASC:
		return applicationcanvasarchive.SortAscending, nil
	case thriftcommon.SortDirection_DESC:
		return applicationcanvasarchive.SortDescending, nil
	default:
		return applicationcanvasarchive.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
}

func archiveExportDTO(item applicationcanvasarchive.Export, now time.Time) *thriftcanvas.ProjectCanvasVideoArchiveExport {
	dto := &thriftcanvas.ProjectCanvasVideoArchiveExport{
		TaskRunID: item.TaskRunID, ProjectID: item.ProjectID, CanvasID: item.CanvasID,
		Status: archiveStatus(item.Status), InputCount: item.InputCount, OutputFilename: item.OutputFilename,
		OutputSize: item.OutputSize, Path: item.DownloadPath(now), CreatedAt: timestamp(item.CreatedAt),
	}
	if item.RetentionGuaranteedUntil != nil {
		value := thriftcommon.Timestamp(timestamp(*item.RetentionGuaranteedUntil))
		dto.RetentionGuaranteedUntil = &value
	}
	if item.StartedAt != nil {
		value := thriftcommon.Timestamp(timestamp(*item.StartedAt))
		dto.StartedAt = &value
	}
	if item.FinishedAt != nil {
		value := thriftcommon.Timestamp(timestamp(*item.FinishedAt))
		dto.FinishedAt = &value
	}
	if item.ErrorCode != "" {
		dto.ErrorCode = &item.ErrorCode
	}
	if item.ErrorMessage != "" {
		dto.ErrorMessage = &item.ErrorMessage
	}
	return dto
}

func archiveStatus(status domaintask.Status) thriftcanvas.CanvasVideoArchiveExportStatus {
	switch status {
	case domaintask.StatusQueued:
		return thriftcanvas.CanvasVideoArchiveExportStatus_QUEUED
	case domaintask.StatusRunning:
		return thriftcanvas.CanvasVideoArchiveExportStatus_RUNNING
	case domaintask.StatusSucceeded:
		return thriftcanvas.CanvasVideoArchiveExportStatus_SUCCEEDED
	case domaintask.StatusFailed:
		return thriftcanvas.CanvasVideoArchiveExportStatus_FAILED
	case domaintask.StatusCancelled:
		return thriftcanvas.CanvasVideoArchiveExportStatus_CANCELLED
	default:
		return 0
	}
}

func classifyArchiveError(err error) error {
	switch {
	case errors.Is(err, applicationcanvasarchive.ErrNotFound):
		return errno.Wrap(errno.ErrNotFound, err)
	case errors.Is(err, applicationcanvasarchive.ErrNoSelectedVideos), errors.Is(err, applicationcanvasarchive.ErrSelectedVideoUnavailable):
		return errno.Wrap(errno.ErrFailedPrecondition, err)
	case errors.Is(err, applicationcanvasarchive.ErrActiveExportExists):
		return errno.Wrap(errno.ErrConflict, err)
	default:
		return errno.Ensure(errno.ErrInternalError, err)
	}
}
