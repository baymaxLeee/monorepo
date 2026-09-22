package http

import (
	"context"
	"encoding/json"
	"time"

	thriftbase "github.com/example/monorepo/canvas/internal/api/contracts/base"
	thriftcommon "github.com/example/monorepo/canvas/internal/api/contracts/common"
	thriftproject "github.com/example/monorepo/canvas/internal/api/contracts/project"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	domainproject "github.com/example/monorepo/canvas/internal/domain/project"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const projectAPIVersion = "2026-07-31"

type projectService interface {
	List(context.Context, applicationproject.ListInput) ([]domainproject.Project, int64, error)
	Get(context.Context, applicationproject.GetInput) (domainproject.Project, error)
	GetWithUsage(context.Context, applicationproject.GetInput) (applicationproject.ProjectWithUsage, error)
	BatchGet(context.Context, applicationproject.BatchGetInput) ([]domainproject.Project, error)
	Create(context.Context, applicationproject.CreateInput) (applicationproject.ProjectWithUsage, error)
	Update(context.Context, applicationproject.UpdateInput) (applicationproject.ProjectWithUsage, error)
	UpdateByMember(context.Context, applicationproject.UpdateByMemberInput) (domainproject.Project, error)
	Delete(context.Context, applicationproject.DeleteInput) error
	ListModels(context.Context, applicationproject.ListModelsInput) (applicationproject.ProjectModelList, error)
}

type ProjectHandler struct {
	service projectService
}

func NewProjectHandler(service *applicationproject.Service) *ProjectHandler {
	return newProjectHandler(service)
}

func newProjectHandler(service projectService) *ProjectHandler {
	return &ProjectHandler{service: service}
}

func (h *ProjectHandler) BatchGetProjects(
	ctx context.Context,
	request *thriftproject.BatchGetProjectsRequest,
) (*thriftproject.BatchGetProjectsResponse, error) {
	if err := requireAction(ctx, "BatchGetProjects"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	projects, err := h.service.BatchGet(ctx, applicationproject.BatchGetInput{
		Scope: projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessAdmin), ProjectIDs: request.ProjectIDs,
	})
	if err != nil {
		return nil, err
	}
	items := make([]*thriftproject.ProjectDetail, 0, len(projects))
	for _, project := range projects {
		items = append(items, projectDetail(project))
	}
	return &thriftproject.BatchGetProjectsResponse{Items: items}, nil
}

func (h *ProjectHandler) ListProjects(
	ctx context.Context,
	request *thriftproject.ListProjectsRequest,
) (*thriftproject.ListProjectsResponse, error) {
	if err := requireAction(ctx, "ListProjects"); err != nil {
		return nil, err
	}
	if request.Page == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	request.Top = topParam(ctx)
	keyword := ""
	if request.Filter != nil {
		keyword = request.Filter.GetKeyword()
	}
	direction, err := projectSortDirection(request.Sort)
	if err != nil {
		return nil, err
	}
	projects, total, err := h.service.List(ctx, applicationproject.ListInput{
		Scope:         projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessAdmin),
		Keyword:       keyword,
		SortDirection: direction,
		Page: applicationproject.Page{
			PageSize: int(request.Page.PageSize),
			PageNum:  int(request.Page.PageNum),
		},
	})
	if err != nil {
		return nil, err
	}
	items := make([]*thriftproject.ProjectSummary, 0, len(projects))
	for _, project := range projects {
		items = append(items, projectSummary(project))
	}
	return &thriftproject.ListProjectsResponse{
		Items: items,
		Page:  pageOutput(request.Page.PageSize, request.Page.PageNum, total),
	}, nil
}

func (h *ProjectHandler) GetProject(
	ctx context.Context,
	request *thriftproject.GetProjectRequest,
) (*thriftproject.GetProjectResponse, error) {
	if err := requireAction(ctx, "GetProject"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	project, err := h.service.GetWithUsage(ctx, applicationproject.GetInput{
		Scope:     projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessAdmin),
		ProjectID: request.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	return &thriftproject.GetProjectResponse{Project: projectDetailWithUsage(project)}, nil
}

func (h *ProjectHandler) ListProjectsByMember(
	ctx context.Context,
	request *thriftproject.ListProjectsByMemberRequest,
) (*thriftproject.ListProjectsByMemberResponse, error) {
	if err := requireAction(ctx, "ListProjectsByMember"); err != nil {
		return nil, err
	}
	if request.Page == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	request.Top = topParam(ctx)
	keyword := ""
	if request.Filter != nil {
		keyword = request.Filter.GetKeyword()
	}
	direction, err := projectSortDirection(request.Sort)
	if err != nil {
		return nil, err
	}
	projects, total, err := h.service.List(ctx, applicationproject.ListInput{
		Scope:         projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessMember),
		Keyword:       keyword,
		SortDirection: direction,
		Page: applicationproject.Page{
			PageSize: int(request.Page.PageSize),
			PageNum:  int(request.Page.PageNum),
		},
	})
	if err != nil {
		return nil, err
	}
	items := make([]*thriftproject.MemberProjectSummary, 0, len(projects))
	for _, project := range projects {
		items = append(items, memberProjectSummary(project))
	}
	return &thriftproject.ListProjectsByMemberResponse{
		Items: items,
		Page:  pageOutput(request.Page.PageSize, request.Page.PageNum, total),
	}, nil
}

func (h *ProjectHandler) GetProjectByMember(
	ctx context.Context,
	request *thriftproject.GetProjectByMemberRequest,
) (*thriftproject.GetProjectByMemberResponse, error) {
	if err := requireAction(ctx, "GetProjectByMember"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	project, err := h.service.Get(ctx, applicationproject.GetInput{
		Scope:     projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessMember),
		ProjectID: request.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	return &thriftproject.GetProjectByMemberResponse{Project: memberProjectDetail(project)}, nil
}

func (h *ProjectHandler) BatchGetProjectsByMember(
	ctx context.Context,
	request *thriftproject.BatchGetProjectsByMemberRequest,
) (*thriftproject.BatchGetProjectsByMemberResponse, error) {
	if err := requireAction(ctx, "BatchGetProjectsByMember"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	projects, err := h.service.BatchGet(ctx, applicationproject.BatchGetInput{
		Scope: projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessMember), ProjectIDs: request.ProjectIDs,
	})
	if err != nil {
		return nil, err
	}
	items := make([]*thriftproject.MemberProjectDetail, 0, len(projects))
	for _, project := range projects {
		items = append(items, memberProjectDetail(project))
	}
	return &thriftproject.BatchGetProjectsByMemberResponse{Items: items}, nil
}

func (h *ProjectHandler) CreateProject(
	ctx context.Context,
	request *thriftproject.CreateProjectRequest,
) (*thriftproject.CreateProjectResponse, error) {
	if err := requireAction(ctx, "CreateProject"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	project, err := h.service.Create(ctx, applicationproject.CreateInput{
		Scope:          requestScope(ctx, request.WorkspaceID),
		Name:           request.Name,
		MemberIDs:      request.MemberUserIDs,
		CoverImagePath: request.CoverImagePath,
		UsageLimit:     cloneInt64(request.UsageLimit),
	})
	if err != nil {
		return nil, err
	}
	return &thriftproject.CreateProjectResponse{Project: projectDetailWithUsage(project)}, nil
}

func (h *ProjectHandler) UpdateProject(
	ctx context.Context,
	request *thriftproject.UpdateProjectRequest,
) (*thriftproject.UpdateProjectResponse, error) {
	if err := requireAction(ctx, "UpdateProject"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	project, err := h.service.Update(ctx, applicationproject.UpdateInput{
		Scope:          requestScope(ctx, request.WorkspaceID),
		ProjectID:      request.ProjectID,
		Name:           request.Name,
		MemberIDs:      request.MemberUserIDs,
		CoverImagePath: request.CoverImagePath,
		UsageLimit:     cloneInt64(request.UsageLimit),
	})
	if err != nil {
		return nil, err
	}
	return &thriftproject.UpdateProjectResponse{Project: projectDetailWithUsage(project)}, nil
}

func (h *ProjectHandler) UpdateProjectByMember(
	ctx context.Context,
	request *thriftproject.UpdateProjectByMemberRequest,
) (*thriftproject.UpdateProjectByMemberResponse, error) {
	if err := requireAction(ctx, "UpdateProjectByMember"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	project, err := h.service.UpdateByMember(ctx, applicationproject.UpdateByMemberInput{
		Scope:          projectRequestScope(ctx, request.WorkspaceID, applicationproject.AccessMember),
		ProjectID:      request.ProjectID,
		CoverImagePath: request.CoverImagePath,
	})
	if err != nil {
		return nil, err
	}
	return &thriftproject.UpdateProjectByMemberResponse{Project: memberProjectDetail(project)}, nil
}

func (h *ProjectHandler) DeleteProject(
	ctx context.Context,
	request *thriftproject.DeleteProjectRequest,
) (*thriftbase.Empty, error) {
	if err := requireAction(ctx, "DeleteProject"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.Delete(ctx, applicationproject.DeleteInput{
		Scope: requestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
	}); err != nil {
		return nil, err
	}
	return &thriftbase.Empty{}, nil
}

func (h *ProjectHandler) ListProjectModels(
	ctx context.Context,
	request *thriftproject.ListProjectModelsRequest,
) (*thriftproject.ListProjectModelsResponse, error) {
	if err := requireAction(ctx, "ListProjectModels"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	pageNumber, pageSize := int32(1), int32(100)
	if request.ListOpt != nil {
		pageNumber, pageSize = request.ListOpt.PageNumber, request.ListOpt.PageSize
	}
	input := applicationproject.ListModelsInput{
		Scope: requestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
		PageNumber: pageNumber, PageSize: pageSize,
	}
	if request.Filter != nil {
		input.Types = request.Filter.Types
		input.Features = request.Filter.Features
		input.Statuses = request.Filter.Statuses
		input.IsGranted = request.Filter.IsGranted
	}
	result, err := h.service.ListModels(ctx, input)
	if err != nil {
		return nil, err
	}
	response := &thriftproject.ListProjectModelsResponse{Items: make([]*thriftproject.ProjectModelInfo, 0, len(result.Items)), Total: result.Total}
	for _, item := range result.Items {
		info := new(thriftproject.ProjectModelInfo)
		if err := json.Unmarshal(item, info); err != nil {
			return nil, errno.Wrap(errno.ErrModelDependencyError, err)
		}
		response.Items = append(response.Items, info)
	}
	return response, nil
}

func requireAction(ctx context.Context, action string) error {
	metadata, ok := topcontext.MetadataFromContext(ctx)
	if !ok || metadata.TenantID == "" || metadata.UserID == "" || metadata.Service == "" ||
		metadata.Action != action || metadata.Version != projectAPIVersion {
		return errno.New(errno.ErrForbidden)
	}
	return nil
}

func topParam(ctx context.Context) *thriftbase.TopParam {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return &thriftbase.TopParam{
		RequestID:   metadata.RequestID,
		TenantID:    metadata.TenantID,
		UserID:      optionalString(metadata.UserID),
		DestService: metadata.Service,
		Region:      optionalString(metadata.Region),
		RealIp:      optionalString(metadata.RealIP),
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	cloned := value
	return &cloned
}

func requestScope(ctx context.Context, workspaceID *string) applicationproject.Scope {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return applicationproject.Scope{
		TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(workspaceID), CallerID: metadata.UserID,
	}
}

func nullableWorkspaceID(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	cloned := *value
	return &cloned
}

func projectSortDirection(sort *thriftproject.ProjectSort) (applicationproject.SortDirection, error) {
	if sort == nil {
		return applicationproject.SortUnspecified, nil
	}
	if sort.IsSetField() && sort.GetField() != thriftproject.ProjectSortField_UPDATED_AT {
		return applicationproject.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
	if !sort.IsSetDirection() {
		return applicationproject.SortUnspecified, nil
	}
	switch sort.GetDirection() {
	case thriftcommon.SortDirection_ASC:
		return applicationproject.SortAscending, nil
	case thriftcommon.SortDirection_DESC:
		return applicationproject.SortDescending, nil
	default:
		return applicationproject.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
}

func projectSummary(project domainproject.Project) *thriftproject.ProjectSummary {
	return &thriftproject.ProjectSummary{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats: &thriftproject.ProjectStats{
			CanvasCount: project.CanvasCount, SelectedVideoDurationMillis: project.SelectedVideoDurationMillis,
			ResourceCount: project.ResourceCount,
		},
		MemberUserIDs: append([]string(nil), project.MemberIDs...),
	}
}

func memberProjectSummary(project domainproject.Project) *thriftproject.MemberProjectSummary {
	return &thriftproject.MemberProjectSummary{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats: projectStats(project),
	}
}

func timestamp(value time.Time) thriftcommon.Timestamp {
	return value.UTC().Format(time.RFC3339Nano)
}

func projectDetail(project domainproject.Project) *thriftproject.ProjectDetail {
	return &thriftproject.ProjectDetail{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats:         projectStats(project),
		MemberUserIDs: append([]string(nil), project.MemberIDs...),
	}
}

func projectDetailWithUsage(result applicationproject.ProjectWithUsage) *thriftproject.ProjectDetail {
	detail := projectDetail(result.Project)
	detail.UsageLimit = cloneInt64(result.UsageLimit)
	detail.UsedAmount = float64Pointer(result.UsedAmount)
	return detail
}

func memberProjectDetail(project domainproject.Project) *thriftproject.MemberProjectDetail {
	return &thriftproject.MemberProjectDetail{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats: projectStats(project),
	}
}

func projectStats(project domainproject.Project) *thriftproject.ProjectStats {
	return &thriftproject.ProjectStats{
		CanvasCount: project.CanvasCount, SelectedVideoDurationMillis: project.SelectedVideoDurationMillis,
		ResourceCount: project.ResourceCount,
	}
}

func projectRequestScope(
	ctx context.Context,
	workspaceID *string,
	access applicationproject.Access,
) applicationproject.Scope {
	scope := requestScope(ctx, workspaceID)
	scope.Access = access
	return scope
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func cloneInt64(value *int64) *int64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func float64Pointer(value float64) *float64 {
	return &value
}
