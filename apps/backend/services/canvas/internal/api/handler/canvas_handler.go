package http

import (
	"context"

	thriftbase "github.com/example/monorepo/canvas/internal/api/contracts/base"
	thriftcanvas "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	thriftcommon "github.com/example/monorepo/canvas/internal/api/contracts/common"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const canvasAPIVersion = projectAPIVersion

type canvasService interface {
	canvasViewService
	List(context.Context, applicationcanvas.ListInput) ([]domaincanvas.Canvas, int64, error)
	Get(context.Context, applicationcanvas.GetInput) (domaincanvas.Canvas, error)
	BatchGet(context.Context, applicationcanvas.BatchGetInput) ([]domaincanvas.Canvas, error)
	Create(context.Context, applicationcanvas.CreateInput) (domaincanvas.Canvas, error)
	Update(context.Context, applicationcanvas.UpdateInput) (domaincanvas.Canvas, error)
	Delete(context.Context, applicationcanvas.DeleteInput) error
}

type canvasViewService interface {
	UpdateView(context.Context, applicationcanvas.UpdateViewInput) error
}

type CanvasHandler struct {
	service     canvasService
	viewService canvasViewService
}

func NewCanvasHandler(service *applicationcanvas.Service) *CanvasHandler {
	return newCanvasHandler(service)
}

func newCanvasHandler(service canvasService) *CanvasHandler {
	return &CanvasHandler{service: service, viewService: service}
}

func (h *CanvasHandler) BatchGetProjectCanvases(
	ctx context.Context,
	request *thriftcanvas.BatchGetProjectCanvasesRequest,
) (*thriftcanvas.BatchGetProjectCanvasesResponse, error) {
	if err := requireAction(ctx, "BatchGetProjectCanvases"); err != nil {
		return nil, err
	}
	items, err := h.service.BatchGet(ctx, applicationcanvas.BatchGetInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, CanvasIDs: request.CanvasIDs,
	})
	if err != nil {
		return nil, err
	}
	responseItems := make([]*thriftcanvas.ProjectCanvasSummary, 0, len(items))
	for _, item := range items {
		responseItems = append(responseItems, canvasSummary(item))
	}
	return &thriftcanvas.BatchGetProjectCanvasesResponse{Items: responseItems}, nil
}

func (h *CanvasHandler) ListProjectCanvases(
	ctx context.Context,
	request *thriftcanvas.ListProjectCanvasesRequest,
) (*thriftcanvas.ListProjectCanvasesResponse, error) {
	if err := requireAction(ctx, "ListProjectCanvases"); err != nil {
		return nil, err
	}
	if request.Page == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	keyword := ""
	createdByMe := false
	if request.Filter != nil {
		keyword = request.Filter.GetKeyword()
		createdByMe = request.Filter.GetCreatedByMe()
	}
	direction, err := canvasSortDirection(request.Sort)
	if err != nil {
		return nil, err
	}
	items, total, err := h.service.List(ctx, applicationcanvas.ListInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
		CreatedByMe: createdByMe, Keyword: keyword,
		SortDirection: direction,
		Page:          applicationcanvas.Page{PageSize: int(request.Page.PageSize), PageNum: int(request.Page.PageNum)},
	})
	if err != nil {
		return nil, err
	}
	responseItems := make([]*thriftcanvas.ProjectCanvasSummary, 0, len(items))
	for _, item := range items {
		responseItems = append(responseItems, canvasListSummary(item))
	}
	return &thriftcanvas.ListProjectCanvasesResponse{
		Items: responseItems,
		Page:  pageOutput(request.Page.PageSize, request.Page.PageNum, total),
	}, nil
}

func (h *CanvasHandler) GetProjectCanvas(
	ctx context.Context,
	request *thriftcanvas.GetProjectCanvasRequest,
) (*thriftcanvas.GetProjectCanvasResponse, error) {
	if err := requireAction(ctx, "GetProjectCanvas"); err != nil {
		return nil, err
	}
	item, err := h.service.Get(ctx, applicationcanvas.GetInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, CanvasID: request.CanvasID,
	})
	if err != nil {
		return nil, err
	}
	return &thriftcanvas.GetProjectCanvasResponse{Canvas: canvasSummary(item)}, nil
}

func (h *CanvasHandler) CreateProjectCanvas(
	ctx context.Context,
	request *thriftcanvas.CreateProjectCanvasRequest,
) (*thriftcanvas.CreateProjectCanvasResponse, error) {
	if err := requireAction(ctx, "CreateProjectCanvas"); err != nil {
		return nil, err
	}
	item, err := h.service.Create(ctx, applicationcanvas.CreateInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
		Name: request.Name, CoverImagePath: request.CoverImagePath,
	})
	if err != nil {
		return nil, err
	}
	return &thriftcanvas.CreateProjectCanvasResponse{Canvas: canvasSummary(item)}, nil
}

func (h *CanvasHandler) UpdateProjectCanvas(
	ctx context.Context,
	request *thriftcanvas.UpdateProjectCanvasRequest,
) (*thriftcanvas.UpdateProjectCanvasResponse, error) {
	if err := requireAction(ctx, "UpdateProjectCanvas"); err != nil {
		return nil, err
	}
	item, err := h.service.Update(ctx, applicationcanvas.UpdateInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, CanvasID: request.CanvasID,
		Name: request.Name, CoverImagePath: request.CoverImagePath,
	})
	if err != nil {
		return nil, err
	}
	return &thriftcanvas.UpdateProjectCanvasResponse{Canvas: canvasSummary(item)}, nil
}

func (h *CanvasHandler) UpdateCanvasView(
	ctx context.Context,
	request *thriftcanvas.UpdateCanvasViewRequest,
) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "UpdateCanvasView"); err != nil {
		return nil, err
	}
	var defaultView *domaincanvas.ViewMode
	if request.DefaultView != nil {
		value := domaincanvas.ViewMode(*request.DefaultView)
		defaultView = &value
	}
	if h.viewService == nil {
		return nil, errno.New(errno.ErrConfigurationError)
	}
	err := h.viewService.UpdateView(ctx, applicationcanvas.UpdateViewInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, CanvasID: request.CanvasID,
		DefaultView: defaultView,
	})
	if err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
}

func (h *CanvasHandler) DeleteProjectCanvas(
	ctx context.Context,
	request *thriftcanvas.DeleteProjectCanvasRequest,
) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "DeleteProjectCanvas"); err != nil {
		return nil, err
	}
	if err := h.service.Delete(ctx, applicationcanvas.DeleteInput{
		Scope: canvasRequestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
		CanvasID: request.CanvasID,
	}); err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
}

func canvasRequestScope(ctx context.Context, workspaceID *string) applicationcanvas.Scope {
	metadata, _ := requestcontext.MetadataFromContext(ctx)
	return applicationcanvas.Scope{
		TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(workspaceID), CallerID: metadata.UserID,
	}
}

func canvasSortDirection(sort *thriftcanvas.ProjectCanvasSort) (applicationcanvas.SortDirection, error) {
	if sort == nil {
		return applicationcanvas.SortUnspecified, nil
	}
	if sort.IsSetField() && sort.GetField() != thriftcanvas.ProjectCanvasSortField_UPDATED_AT {
		return applicationcanvas.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
	if !sort.IsSetDirection() {
		return applicationcanvas.SortUnspecified, nil
	}
	switch sort.GetDirection() {
	case thriftcommon.SortDirection_ASC:
		return applicationcanvas.SortAscending, nil
	case thriftcommon.SortDirection_DESC:
		return applicationcanvas.SortDescending, nil
	default:
		return applicationcanvas.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
}

func canvasSummary(item domaincanvas.Canvas) *thriftcanvas.ProjectCanvasSummary {
	return &thriftcanvas.ProjectCanvasSummary{
		CanvasID: item.ID, ProjectID: item.ProjectID, Name: item.Name, CoverImagePath: cloneString(item.CoverImagePath),
		CoverImageURL: optionalString(item.CoverImageURL),
		CreatedBy:     item.CreatedBy, CreatedAt: timestamp(item.CreatedAt), UpdatedAt: timestamp(item.UpdatedAt),
		Stats: &thriftcanvas.ProjectCanvasStats{
			CanvasNodeCount: item.CanvasNodeCount, SelectedVideoDurationMillis: item.SelectedVideoDurationMillis,
		},
		DefaultView: thriftcanvas.CanvasViewMode(item.DefaultView), Revision: item.Revision,
	}
}

func canvasListSummary(item domaincanvas.Canvas) *thriftcanvas.ProjectCanvasSummary {
	summary := canvasSummary(item)
	if item.FallbackCoverImageURL != "" {
		summary.FallbackCoverImageURL = cloneString(&item.FallbackCoverImageURL)
	}
	return summary
}
