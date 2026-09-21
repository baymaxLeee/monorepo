package http

import (
	"context"
	"encoding/json"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/http/topcontext"
	applicationproject "github.com/example/monorepo/canvas/internal/server/application/project"
	contractbase "github.com/example/monorepo/canvas/internal/server/contracts/base"
	contractcommon "github.com/example/monorepo/canvas/internal/server/contracts/common"
	contractproject "github.com/example/monorepo/canvas/internal/server/contracts/project"
	domainproject "github.com/example/monorepo/canvas/internal/server/domain/project"
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
	GrantModels(context.Context, applicationproject.GrantModelsInput) error
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
	request *contractproject.BatchGetProjectsRequest,
) (*contractproject.BatchGetProjectsResponse, error) {
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
	items := make([]*contractproject.ProjectDetail, 0, len(projects))
	for _, project := range projects {
		items = append(items, projectDetail(project))
	}
	return &contractproject.BatchGetProjectsResponse{Items: items}, nil
}

func (h *ProjectHandler) ListProjects(
	ctx context.Context,
	request *contractproject.ListProjectsRequest,
) (*contractproject.ListProjectsResponse, error) {
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
	items := make([]*contractproject.ProjectSummary, 0, len(projects))
	for _, project := range projects {
		items = append(items, projectSummary(project))
	}
	return &contractproject.ListProjectsResponse{
		Items: items,
		Page:  pageOutput(request.Page.PageSize, request.Page.PageNum, total),
	}, nil
}

func (h *ProjectHandler) GetProject(
	ctx context.Context,
	request *contractproject.GetProjectRequest,
) (*contractproject.GetProjectResponse, error) {
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
	return &contractproject.GetProjectResponse{Project: projectDetailWithUsage(project)}, nil
}

func (h *ProjectHandler) ListProjectsByMember(
	ctx context.Context,
	request *contractproject.ListProjectsByMemberRequest,
) (*contractproject.ListProjectsByMemberResponse, error) {
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
	items := make([]*contractproject.MemberProjectSummary, 0, len(projects))
	for _, project := range projects {
		items = append(items, memberProjectSummary(project))
	}
	return &contractproject.ListProjectsByMemberResponse{
		Items: items,
		Page:  pageOutput(request.Page.PageSize, request.Page.PageNum, total),
	}, nil
}

func (h *ProjectHandler) GetProjectByMember(
	ctx context.Context,
	request *contractproject.GetProjectByMemberRequest,
) (*contractproject.GetProjectByMemberResponse, error) {
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
	return &contractproject.GetProjectByMemberResponse{Project: memberProjectDetail(project)}, nil
}

func (h *ProjectHandler) BatchGetProjectsByMember(
	ctx context.Context,
	request *contractproject.BatchGetProjectsByMemberRequest,
) (*contractproject.BatchGetProjectsByMemberResponse, error) {
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
	items := make([]*contractproject.MemberProjectDetail, 0, len(projects))
	for _, project := range projects {
		items = append(items, memberProjectDetail(project))
	}
	return &contractproject.BatchGetProjectsByMemberResponse{Items: items}, nil
}

func (h *ProjectHandler) CreateProject(
	ctx context.Context,
	request *contractproject.CreateProjectRequest,
) (*contractproject.CreateProjectResponse, error) {
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
	return &contractproject.CreateProjectResponse{Project: projectDetailWithUsage(project)}, nil
}

func (h *ProjectHandler) UpdateProject(
	ctx context.Context,
	request *contractproject.UpdateProjectRequest,
) (*contractproject.UpdateProjectResponse, error) {
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
	return &contractproject.UpdateProjectResponse{Project: projectDetailWithUsage(project)}, nil
}

func (h *ProjectHandler) UpdateProjectByMember(
	ctx context.Context,
	request *contractproject.UpdateProjectByMemberRequest,
) (*contractproject.UpdateProjectByMemberResponse, error) {
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
	return &contractproject.UpdateProjectByMemberResponse{Project: memberProjectDetail(project)}, nil
}

func (h *ProjectHandler) DeleteProject(
	ctx context.Context,
	request *contractproject.DeleteProjectRequest,
) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "DeleteProject"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.Delete(ctx, applicationproject.DeleteInput{
		Scope: requestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID,
	}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ProjectHandler) GrantProjectModels(
	ctx context.Context,
	request *contractproject.GrantProjectModelsRequest,
) (*contractbase.Empty, error) {
	if err := requireAction(ctx, "GrantProjectModels"); err != nil {
		return nil, err
	}
	request.Top = topParam(ctx)
	if err := h.service.GrantModels(ctx, applicationproject.GrantModelsInput{
		Scope: requestScope(ctx, request.WorkspaceID), ProjectID: request.ProjectID, ModelIDs: request.ModelIDs,
	}); err != nil {
		return nil, err
	}
	return &contractbase.Empty{}, nil
}

func (h *ProjectHandler) ListProjectModels(
	ctx context.Context,
	request *contractproject.ListProjectModelsRequest,
) (*contractproject.ListProjectModelsResponse, error) {
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
	response := &contractproject.ListProjectModelsResponse{Items: make([]*contractproject.ProjectModelInfo, 0, len(result.Items)), Total: result.Total}
	for _, item := range result.Items {
		info := new(contractproject.ProjectModelInfo)
		if err := json.Unmarshal(item, info); err != nil {
			return nil, errno.Wrap(errno.ErrModelDependencyError, err)
		}
		response.Items = append(response.Items, info)
	}
	return response, nil
}

func requireAction(ctx context.Context, action string) error {
	metadata, ok := topcontext.MetadataFromContext(ctx)
	if !ok || metadata.RequestID == "" || metadata.TenantID == "" || metadata.UserID == "" || metadata.Service == "" ||
		metadata.Action != action || metadata.Version != projectAPIVersion {
		return errno.New(errno.ErrForbidden)
	}
	return nil
}

func topParam(ctx context.Context) *contractbase.TopParam {
	metadata, _ := topcontext.MetadataFromContext(ctx)
	return &contractbase.TopParam{
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

func projectSortDirection(sort *contractproject.ProjectSort) (applicationproject.SortDirection, error) {
	if sort == nil {
		return applicationproject.SortUnspecified, nil
	}
	if sort.IsSetField() && sort.GetField() != contractproject.ProjectSortField_UPDATED_AT {
		return applicationproject.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
	if !sort.IsSetDirection() {
		return applicationproject.SortUnspecified, nil
	}
	switch sort.GetDirection() {
	case contractcommon.SortDirection_ASC:
		return applicationproject.SortAscending, nil
	case contractcommon.SortDirection_DESC:
		return applicationproject.SortDescending, nil
	default:
		return applicationproject.SortUnspecified, errno.New(errno.ErrInvalidArgument)
	}
}

func projectSummary(project domainproject.Project) *contractproject.ProjectSummary {
	return &contractproject.ProjectSummary{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats: &contractproject.ProjectStats{
			CanvasCount: project.CanvasCount, SelectedVideoDurationMillis: project.SelectedVideoDurationMillis,
			ResourceCount: project.ResourceCount,
		},
		MemberUserIDs: append([]string(nil), project.MemberIDs...),
	}
}

func memberProjectSummary(project domainproject.Project) *contractproject.MemberProjectSummary {
	return &contractproject.MemberProjectSummary{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats: projectStats(project),
	}
}

func timestamp(value time.Time) contractcommon.Timestamp {
	return value.UTC().Format(time.RFC3339Nano)
}

func projectDetail(project domainproject.Project) *contractproject.ProjectDetail {
	return &contractproject.ProjectDetail{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats:         projectStats(project),
		MemberUserIDs: append([]string(nil), project.MemberIDs...),
	}
}

func projectDetailWithUsage(result applicationproject.ProjectWithUsage) *contractproject.ProjectDetail {
	detail := projectDetail(result.Project)
	detail.UsageLimit = cloneInt64(result.UsageLimit)
	detail.UsedAmount = float64Pointer(result.UsedAmount)
	return detail
}

func memberProjectDetail(project domainproject.Project) *contractproject.MemberProjectDetail {
	return &contractproject.MemberProjectDetail{
		ProjectID: project.ID, Name: project.Name, CoverImagePath: cloneString(project.CoverImagePath),
		CreatedBy: project.CreatedBy, CreatedAt: timestamp(project.CreatedAt), UpdatedAt: timestamp(project.UpdatedAt),
		Stats: projectStats(project),
	}
}

func projectStats(project domainproject.Project) *contractproject.ProjectStats {
	return &contractproject.ProjectStats{
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
