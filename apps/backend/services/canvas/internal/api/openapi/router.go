package openapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"

	contractasset "github.com/example/monorepo/canvas/internal/api/contracts/asset"
	contractbenefitpackage "github.com/example/monorepo/canvas/internal/api/contracts/benefitpackage"
	contractcanvas "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	contractcommon "github.com/example/monorepo/canvas/internal/api/contracts/common"
	contractproject "github.com/example/monorepo/canvas/internal/api/contracts/project"
	contractprojectusage "github.com/example/monorepo/canvas/internal/api/contracts/projectusage"
	contractresource "github.com/example/monorepo/canvas/internal/api/contracts/resource"
	maturehttp "github.com/example/monorepo/canvas/internal/api/handler"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	requestcontext "github.com/example/monorepo/canvas/internal/application/requestcontext"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
	"github.com/example/monorepo/httpserver-go"
)

const apiVersion = "2026-07-31"

type Router struct {
	projects     *maturehttp.ProjectHandler
	projectUsage *maturehttp.ProjectUsageHandler
	canvases     *maturehttp.CanvasHandler
	nodes        *maturehttp.CanvasNodeHandler
	resources    *maturehttp.ResourceHandler
	assets       *maturehttp.AssetHandler
	archives     *maturehttp.CanvasArchiveHandler
	readiness    func(context.Context) error
	access       applicationprojectaccess.Checker
}

func NewRouter(projects *maturehttp.ProjectHandler, projectUsage *maturehttp.ProjectUsageHandler, canvases *maturehttp.CanvasHandler, nodes *maturehttp.CanvasNodeHandler, resources *maturehttp.ResourceHandler, assets *maturehttp.AssetHandler, archives *maturehttp.CanvasArchiveHandler, readiness func(context.Context) error, access applicationprojectaccess.Checker) http.Handler {
	transport := &Router{projects: projects, projectUsage: projectUsage, canvases: canvases, nodes: nodes, resources: resources, assets: assets, archives: archives, readiness: readiness, access: access}
	router := httpserver.New("canvas")
	router.GET("/livez", func(c *gin.Context) {
		w := c.Writer
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.GET("/readyz", transport.readinessRoute())
	router.GET("/healthz", transport.readinessRoute())
	router.GET("/admin/projects", transport.workspaceAdminRoute("ListProjects", func(ctx context.Context, c *gin.Context) (any, error) {
		request := c.Request
		workspace := metadataWorkspace(request)
		pageSize, err := requiredPositiveInt32Query(request, "page_size")
		if err != nil {
			return nil, err
		}
		pageNum, err := requiredPositiveInt32Query(request, "page_num")
		if err != nil {
			return nil, err
		}
		return transport.projects.ListProjects(ctx, &contractproject.ListProjectsRequest{
			WorkspaceID: &workspace, Page: &contractcommon.Page{PageSize: pageSize, PageNum: pageNum},
		})
	}))
	router.POST("/admin/projects", transport.workspaceAdminRoute("CreateProject", func(ctx context.Context, c *gin.Context) (any, error) {
		request := c.Request
		input := new(contractproject.CreateProjectRequest)
		if err := decodeContract(request, input); err != nil {
			return nil, err
		}
		workspace := metadataWorkspace(request)
		input.WorkspaceID = &workspace
		return transport.projects.CreateProject(ctx, input)
	}))
	adminProject := router.Group("/admin/projects/:projectId")
	{
		r := adminProject
		r.GET("/", transport.workspaceAdminRoute("GetProject", func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			return transport.projects.GetProject(ctx, &contractproject.GetProjectRequest{
				WorkspaceID: &workspace, ProjectID: c.Param("projectId"),
			})
		}))
		r.PUT("/", transport.workspaceAdminRoute("UpdateProject", func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractproject.UpdateProjectRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, c.Param("projectId")
			return transport.projects.UpdateProject(ctx, input)
		}))
		r.DELETE("/", transport.workspaceAdminRoute("DeleteProject", func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			return transport.projects.DeleteProject(ctx, &contractproject.DeleteProjectRequest{
				WorkspaceID: &workspace, ProjectID: c.Param("projectId"),
			})
		}))
		r.POST(httpserver.RoutePath("/usage:export"), transport.workspaceAdminRoute("DownloadProjectUsageXLSX", func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			return transport.projectUsage.DownloadProjectUsageXLSX(ctx, &contractprojectusage.DownloadProjectUsageXLSXRequest{
				WorkspaceID: &workspace, ProjectID: c.Param("projectId"),
			})
		}))
	}
	router.GET("/benefit-packages", transport.route("ListAvailableBenefitPackages", func(ctx context.Context, _ *gin.Context) (any, error) {
		return transport.assets.ListAvailableBenefitPackages(ctx, &contractbenefitpackage.ListAvailableBenefitPackagesRequest{})
	}))
	router.POST("/uploads:prepare", transport.route("PrepareUpload", func(ctx context.Context, c *gin.Context) (any, error) {
		request := c.Request
		input := new(contractasset.PrepareUploadRequest)
		if err := decodeContract(request, input); err != nil {
			return nil, err
		}
		return transport.assets.PrepareUpload(ctx, input)
	}))
	router.GET("/projects", transport.route("ListProjectsByMember", func(ctx context.Context, c *gin.Context) (any, error) {
		request := c.Request
		workspace := metadataWorkspace(request)
		pageSize, err := requiredPositiveInt32Query(request, "page_size")
		if err != nil {
			return nil, err
		}
		pageNum, err := requiredPositiveInt32Query(request, "page_num")
		if err != nil {
			return nil, err
		}
		input := &contractproject.ListProjectsByMemberRequest{
			WorkspaceID: &workspace, Page: &contractcommon.Page{PageSize: pageSize, PageNum: pageNum},
		}
		if keyword := strings.TrimSpace(request.URL.Query().Get("keyword")); keyword != "" {
			input.Filter = &contractproject.ProjectFilter{Keyword: &keyword}
		}
		if direction := strings.TrimSpace(request.URL.Query().Get("sort_direction")); direction != "" {
			parsed, parseErr := contractcommon.SortDirectionFromString(strings.ToUpper(direction))
			if parseErr != nil {
				return nil, errno.Wrap(errno.ErrInvalidArgument, parseErr)
			}
			field := contractproject.ProjectSortField_UPDATED_AT
			input.Sort = &contractproject.ProjectSort{Field: &field, Direction: &parsed}
		}
		return transport.projects.ListProjectsByMember(ctx, input)
	}))
	router.POST("/projects", transport.route("CreateProject", func(ctx context.Context, c *gin.Context) (any, error) {
		request := c.Request
		input := new(contractproject.CreateProjectRequest)
		if err := decodeContract(request, input); err != nil {
			return nil, err
		}
		workspace := metadataWorkspace(request)
		input.WorkspaceID = &workspace
		return transport.projects.CreateProject(ctx, input)
	}))
	project := router.Group("/projects/:projectId")
	{
		r := project
		r.GET("/models", transport.nodeRoute("ListProjectModels", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			pageSize, err := requiredPositiveInt32Query(request, "page_size")
			if err != nil {
				return nil, err
			}
			pageNum, err := requiredPositiveInt32Query(request, "page_num")
			if err != nil {
				return nil, err
			}
			granted := true
			return transport.projects.ListProjectModels(ctx, &contractproject.ListProjectModelsRequest{
				WorkspaceID: &workspace, ProjectID: c.Param("projectId"),
				ListOpt: &contractproject.ProjectModelListOption{PageNumber: pageNum, PageSize: pageSize},
				Filter:  &contractproject.ProjectModelFilter{IsGranted: &granted},
			})
		}))
		r.POST(httpserver.RoutePath("/resources:batchDelete"), transport.nodeRoute("BatchDeleteResources", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractresource.BatchDeleteResourcesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, c.Param("projectId")
			return transport.resources.BatchDeleteResources(ctx, input)
		}))
		r.POST(httpserver.RoutePath("/resource-assets:batchList"), transport.nodeRoute("BatchListResourceAssets", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractresource.BatchListResourceAssetsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, c.Param("projectId")
			return transport.resources.BatchListResourceAssets(ctx, input)
		}))
		r.POST(httpserver.RoutePath("/asset-reviews:batchGet"), transport.nodeRoute("BatchGetAssetReviews", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractasset.BatchGetAssetReviewsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, c.Param("projectId")
			return transport.assets.BatchGetAssetReviews(ctx, input)
		}))
		r.POST(httpserver.RoutePath("/asset-reviews:batchSubmit"), transport.nodeRoute("BatchSubmitAssetReviews", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractasset.BatchSubmitAssetReviewsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, c.Param("projectId")
			return transport.assets.BatchSubmitAssetReviews(ctx, input)
		}))
		r.GET("/", transport.nodeRoute("GetProjectByMember", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			input := &contractproject.GetProjectByMemberRequest{
				WorkspaceID: &workspace,
				ProjectID:   c.Param("projectId"),
			}
			return transport.projects.GetProjectByMember(ctx, input)
		}))
		r.PATCH("/", transport.nodeRoute("UpdateProjectByMember", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractproject.UpdateProjectByMemberRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = c.Param("projectId")
			return transport.projects.UpdateProjectByMember(ctx, input)
		}))
		r.DELETE("/", transport.nodeRoute("DeleteProject", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			input := &contractproject.DeleteProjectRequest{
				WorkspaceID: &workspace,
				ProjectID:   c.Param("projectId"),
			}
			return transport.projects.DeleteProject(ctx, input)
		}))
		r.GET("/canvases", transport.nodeRoute("ListProjectCanvases", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			pageSize, err := requiredPositiveInt32Query(request, "page_size")
			if err != nil {
				return nil, err
			}
			pageNum, err := requiredPositiveInt32Query(request, "page_num")
			if err != nil {
				return nil, err
			}
			input := &contractcanvas.ListProjectCanvasesRequest{
				WorkspaceID: &workspace, ProjectID: c.Param("projectId"),
				Page: &contractcommon.Page{PageSize: pageSize, PageNum: pageNum},
			}
			keyword := strings.TrimSpace(request.URL.Query().Get("keyword"))
			createdByMe, err := optionalBoolQuery(request, "created_by_me")
			if err != nil {
				return nil, err
			}
			if keyword != "" || createdByMe != nil {
				input.Filter = &contractcanvas.ProjectCanvasFilter{Keyword: &keyword, CreatedByMe: createdByMe}
			}
			if direction := strings.TrimSpace(request.URL.Query().Get("sort_direction")); direction != "" {
				parsed, parseErr := contractcommon.SortDirectionFromString(strings.ToUpper(direction))
				if parseErr != nil {
					return nil, errno.Wrap(errno.ErrInvalidArgument, parseErr)
				}
				field := contractcanvas.ProjectCanvasSortField_UPDATED_AT
				input.Sort = &contractcanvas.ProjectCanvasSort{Field: &field, Direction: &parsed}
			}
			return transport.canvases.ListProjectCanvases(ctx, input)
		}))
		r.POST("/canvases", transport.nodeRoute("CreateProjectCanvas", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvas.CreateProjectCanvasRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, c.Param("projectId")
			return transport.canvases.CreateProjectCanvas(ctx, input)
		}))
		r.GET("/resources", transport.nodeRoute("ListResources", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			pageSize, err := requiredPositiveInt32Query(request, "page_size")
			if err != nil {
				return nil, err
			}
			pageNum, err := requiredPositiveInt32Query(request, "page_num")
			if err != nil {
				return nil, err
			}
			input := &contractresource.ListResourcesRequest{
				WorkspaceID: &workspace,
				ProjectID:   c.Param("projectId"),
				Page:        &contractcommon.Page{PageSize: pageSize, PageNum: pageNum},
			}
			if keyword := strings.TrimSpace(request.URL.Query().Get("keyword")); keyword != "" {
				input.Keyword = &keyword
			}
			if rawType := strings.TrimSpace(request.URL.Query().Get("type")); rawType != "" {
				value, parseErr := strconv.ParseInt(rawType, 10, 64)
				if parseErr != nil {
					return nil, errno.Wrap(errno.ErrInvalidArgument, parseErr)
				}
				resourceType := contractresource.ResourceType(value)
				input.Type = &resourceType
			}
			if direction := strings.TrimSpace(request.URL.Query().Get("sort_direction")); direction != "" {
				parsed, parseErr := contractcommon.SortDirectionFromString(strings.ToUpper(direction))
				if parseErr != nil {
					return nil, errno.Wrap(errno.ErrInvalidArgument, parseErr)
				}
				field := contractresource.ResourceSortField_UPDATED_AT
				input.Sort = &contractresource.ResourceSort{Field: &field, Direction: &parsed}
			}
			return transport.resources.ListResources(ctx, input)
		}))
		r.GET(httpserver.RoutePath("/resources:stats"), transport.nodeRoute("GetProjectResourceStats", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			return transport.resources.GetProjectResourceStats(ctx, &contractresource.GetProjectResourceStatsRequest{
				WorkspaceID: &workspace, ProjectID: c.Param("projectId"),
			})
		}))
		r.POST("/resources", transport.nodeRoute("CreateResource", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractresource.CreateResourceRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = c.Param("projectId")
			return transport.resources.CreateResource(ctx, input)
		}))
		r.POST(httpserver.RoutePath("/resources:fromAsset"), transport.nodeRoute("CreateResourceFromAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractresource.CreateResourceFromAssetRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = c.Param("projectId")
			return transport.resources.CreateResourceFromAsset(ctx, input)
		}))
		resources := r.Group("/resources/:resourceId")
		{
			resources.POST(httpserver.RoutePath("/generation-states:batchGet"), transport.nodeRoute("BatchGetResourceAssetGenerationStates", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				input := new(contractresource.BatchGetResourceAssetGenerationStatesRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.BatchGetResourceAssetGenerationStates(ctx, input)
			}))
			resources.POST(httpserver.RoutePath("/assets:batchDelete"), transport.nodeRoute("BatchDeleteResourceAssets", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				input := new(contractresource.BatchDeleteResourceAssetsRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.BatchDeleteResourceAssets(ctx, input)
			}))
			resources.GET("/", transport.nodeRoute("GetResource", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
				input := new(contractresource.GetResourceRequest)
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.GetResource(ctx, input)
			}))
			resources.PATCH("/", transport.nodeRoute("UpdateResource", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				input := new(contractresource.UpdateResourceRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.UpdateResource(ctx, input)
			}))
			resources.DELETE("/", transport.nodeRoute("DeleteResource", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				input := new(contractresource.DeleteResourceRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.DeleteResource(ctx, input)
			}))
			resources.GET("/assets", transport.nodeRoute("ListResourceAssets", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				pageSize, err := requiredPositiveInt32Query(request, "page_size")
				if err != nil {
					return nil, err
				}
				pageNum, err := requiredPositiveInt32Query(request, "page_num")
				if err != nil {
					return nil, err
				}
				input := &contractresource.ListResourceAssetsRequest{
					Page: &contractcommon.Page{PageSize: pageSize, PageNum: pageNum},
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.ListResourceAssets(ctx, input)
			}))
			resources.POST("/assets", transport.nodeRoute("CreateResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				input := new(contractresource.CreateResourceAssetRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.CreateResourceAsset(ctx, input)
			}))
			resources.POST("/generated-assets", transport.nodeRoute("CreateGeneratedResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
				request := c.Request
				input := new(contractresource.CreateGeneratedResourceAssetRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.CreateGeneratedResourceAsset(ctx, input)
			}))
			assets := resources.Group("/assets/:assetId")
			{
				assets.PATCH("/", transport.nodeRoute("UpdateResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					request := c.Request
					input := new(contractresource.UpdateResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.UpdateResourceAsset(ctx, input)
				}))
				assets.DELETE("/", transport.nodeRoute("DeleteResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					request := c.Request
					input := new(contractresource.DeleteResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.DeleteResourceAsset(ctx, input)
				}))
				assets.POST("/primary", transport.nodeRoute("SetPrimaryResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					request := c.Request
					input := new(contractresource.SetPrimaryResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.SetPrimaryResourceAsset(ctx, input)
				}))
				assets.POST("/replace", transport.nodeRoute("ReplaceUploadedResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					request := c.Request
					input := new(contractresource.ReplaceUploadedResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.ReplaceUploadedResourceAsset(ctx, input)
				}))
				assets.GET("/generation", transport.nodeRoute("GetResourceAssetGeneration", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
					input := new(contractresource.GetResourceAssetGenerationRequest)
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.GetResourceAssetGeneration(ctx, input)
				}))
				assets.PATCH("/generation", transport.nodeRoute("UpdateResourceAssetGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					request := c.Request
					input := new(contractresource.UpdateResourceAssetGenerationRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.UpdateResourceAssetGeneration(ctx, input)
				}))
				assets.POST("/generation/runs", transport.nodeRoute("StartResourceAssetGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					request := c.Request
					input := new(contractresource.StartResourceAssetGenerationRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.StartResourceAssetGeneration(ctx, input)
				}))
				assets.GET("/generation/runs/:taskRunId", transport.nodeRoute("GetResourceAssetGenerationRun", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
					input := new(contractresource.GetResourceAssetGenerationRunRequest)
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					input.TaskRunID = c.Param("taskRunId")
					return transport.resources.GetResourceAssetGenerationRun(ctx, input)
				}))
				postAction(assets, "/generation/runs/:taskRunIdAction", "taskRunId", ":cancel", transport.nodeRoute("CancelResourceAssetGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
					input := new(contractresource.CancelResourceAssetGenerationRequest)
					setResourceAssetScope(c, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					input.TaskRunID = c.Param("taskRunId")
					return transport.resources.CancelResourceAssetGeneration(ctx, input)
				}))
			}
		}
	}
	canvas := router.Group("/projects/:projectId/canvases/:canvasId")
	{
		r := canvas
		r.GET("/", transport.nodeRoute("GetProjectCanvas", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			input := &contractcanvas.GetProjectCanvasRequest{
				WorkspaceID: &workspace,
				ProjectID:   c.Param("projectId"),
				CanvasID:    c.Param("canvasId"),
			}
			return transport.canvases.GetProjectCanvas(ctx, input)
		}))
		r.PATCH("/", transport.nodeRoute("UpdateProjectCanvas", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvas.UpdateProjectCanvasRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = c.Param("projectId")
			input.CanvasID = c.Param("canvasId")
			return transport.canvases.UpdateProjectCanvas(ctx, input)
		}))
		r.DELETE("/", transport.nodeRoute("DeleteProjectCanvas", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			workspace := metadataWorkspace(request)
			input := &contractcanvas.DeleteProjectCanvasRequest{
				WorkspaceID: &workspace,
				ProjectID:   c.Param("projectId"),
				CanvasID:    c.Param("canvasId"),
			}
			return transport.canvases.DeleteProjectCanvas(ctx, input)
		}))
		r.PATCH("/view", transport.nodeRoute("UpdateCanvasView", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvas.UpdateCanvasViewRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = c.Param("projectId")
			input.CanvasID = c.Param("canvasId")
			return transport.canvases.UpdateCanvasView(ctx, input)
		}))
		r.POST("/archives", transport.nodeRoute("StartProjectCanvasVideoArchiveExport", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvas.StartProjectCanvasVideoArchiveExportRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.archives.StartProjectCanvasVideoArchiveExport(ctx, input)
		}))
		r.GET("/archives", transport.nodeRoute("ListProjectCanvasVideoArchiveExports", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvas.ListProjectCanvasVideoArchiveExportsRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			pageSize, err := requiredPositiveInt32Query(request, "page_size")
			if err != nil {
				return nil, err
			}
			pageNum, err := requiredPositiveInt32Query(request, "page_num")
			if err != nil {
				return nil, err
			}
			input.Page = &contractcommon.Page{PageSize: pageSize, PageNum: pageNum}
			if direction := strings.TrimSpace(request.URL.Query().Get("sort_direction")); direction != "" {
				parsed, parseErr := contractcommon.SortDirectionFromString(strings.ToUpper(direction))
				if parseErr != nil {
					return nil, errno.Wrap(errno.ErrInvalidArgument, parseErr)
				}
				field := contractcanvas.ProjectCanvasVideoArchiveExportSortField_CREATED_AT
				input.Sort = &contractcanvas.ProjectCanvasVideoArchiveExportSort{Field: &field, Direction: &parsed}
			}
			return transport.archives.ListProjectCanvasVideoArchiveExports(ctx, input)
		}))
		r.GET("/archives/:taskRunId", transport.nodeRoute("GetProjectCanvasVideoArchiveExport", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvas.GetProjectCanvasVideoArchiveExportRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = c.Param("taskRunId")
			return transport.archives.GetProjectCanvasVideoArchiveExport(ctx, input)
		}))
		postAction(r, "/archives/:taskRunIdAction", "taskRunId", ":cancel", transport.nodeRoute("CancelProjectCanvasVideoArchiveExport", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvas.CancelProjectCanvasVideoArchiveExportRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = c.Param("taskRunId")
			return transport.archives.CancelProjectCanvasVideoArchiveExport(ctx, input)
		}))
		r.GET("/archives/:taskRunId/content", transport.archiveContentRoute())
		r.GET("/events", transport.nodeStreamRoute("GetCanvasGraph", applicationprojectaccess.AccessRead, transport.canvasStream))
		r.GET("/nodes", transport.nodeRoute("GetCanvasGraph", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			input := &contractcanvasnode.GetCanvasGraphRequest{}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.GetCanvasGraph(ctx, input)
		}))
		r.POST("/nodes", transport.nodeRoute("CreateCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.CreateCanvasNodeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.CreateCanvasNode(ctx, input)
		}))
		r.POST("/assets", transport.nodeRoute("CreateCanvasAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.CreateCanvasAssetRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.CreateCanvasAsset(ctx, input)
		}))
		r.PATCH("/nodes/:nodeId", transport.nodeRoute("UpdateCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.UpdateCanvasNodeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			return transport.nodes.UpdateCanvasNode(ctx, input)
		}))
		r.PATCH("/node-positions", transport.nodeRoute("BatchUpdateCanvasNodePositions", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.BatchUpdateCanvasNodePositionsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.BatchUpdateCanvasNodePositions(ctx, input)
		}))
		r.DELETE("/nodes/:nodeId", transport.nodeRoute("DeleteCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.DeleteCanvasNodeRequest)
			if err := decodeOptionalContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			return transport.nodes.DeleteCanvasNode(ctx, input)
		}))
		r.POST(httpserver.RoutePath("/nodes:batchDelete"), transport.nodeRoute("BatchDeleteCanvasNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.BatchDeleteCanvasNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.BatchDeleteCanvasNodes(ctx, input)
		}))
		r.POST("/edges", transport.nodeRoute("ConnectCanvasNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.ConnectCanvasNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.ConnectCanvasNodes(ctx, input)
		}))
		r.DELETE("/edges", transport.nodeRoute("DeleteCanvasEdge", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.DeleteCanvasEdgeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.DeleteCanvasEdge(ctx, input)
		}))
		r.PUT("/storyboard-order", transport.nodeRoute("ReorderStoryboardNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.ReorderStoryboardNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.ReorderStoryboardNodes(ctx, input)
		}))
		r.POST("/nodes/:nodeId/generations", transport.nodeRoute("StartCanvasNodeGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.StartCanvasNodeGenerationRequest)
			if err := decodeOptionalContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			return transport.nodes.StartCanvasNodeGeneration(ctx, input)
		}))
		r.POST("/generations", transport.nodeRoute("StartCanvasGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvasnode.StartCanvasGenerationRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.StartCanvasGeneration(ctx, input)
		}))
		r.GET("/nodes/:nodeId/histories", transport.nodeRoute("ListCanvasNodeHistories", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvasnode.ListCanvasNodeHistoriesRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			return transport.nodes.ListCanvasNodeHistories(ctx, input)
		}))
		postAction(r, "/nodes/:nodeId/histories/:historyIdAction", "historyId", ":select", transport.nodeRoute("SelectCanvasNodeHistory", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvasnode.SelectCanvasNodeHistoryRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			input.HistoryID = c.Param("historyId")
			return transport.nodes.SelectCanvasNodeHistory(ctx, input)
		}))
		postAction(r, "/nodes/:nodeId/generations/:taskRunIdAction", "taskRunId", ":cancel", transport.nodeRoute("CancelCanvasNodeGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvasnode.CancelCanvasNodeGenerationRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			input.TaskRunID = c.Param("taskRunId")
			return transport.nodes.CancelCanvasNodeGeneration(ctx, input)
		}))
		postAction(r, "/nodes/:nodeId", "nodeId", ":copy", transport.nodeRoute("CopyCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.CopyCanvasNodeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.SourceNodeID = c.Param("nodeId")
			return transport.nodes.CopyCanvasNode(ctx, input)
		}))
		r.POST("/nodes/:nodeId/asset-search", transport.nodeRoute("SearchCanvasNodeAssets", applicationprojectaccess.AccessRead, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.SearchCanvasNodeAssetsRequest)
			if err := decodeOptionalContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			if input.Limit == 0 {
				input.Limit = 50
			}
			return transport.nodes.SearchCanvasNodeAssets(ctx, input)
		}))
		r.POST("/nodes/:nodeId/asset-matches", transport.nodeRoute("StartCanvasNodeAssetsMatch", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.StartCanvasNodeAssetsMatchRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			return transport.nodes.StartCanvasNodeAssetsMatch(ctx, input)
		}))
		postAction(r, "/nodes/:nodeId/asset-matches/:taskRunIdAction", "taskRunId", ":cancel", transport.nodeRoute("CancelCanvasNodeAssetsMatch", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvasnode.CancelCanvasNodeAssetsMatchRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = c.Param("nodeId")
			input.TaskRunID = c.Param("taskRunId")
			return transport.nodes.CancelCanvasNodeAssetsMatch(ctx, input)
		}))
		r.POST("/resource-references", transport.nodeRoute("MaterializeCanvasResourceAssetReference", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.MaterializeCanvasResourceAssetReferenceRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.MaterializeCanvasResourceAssetReference(ctx, input)
		}))
		r.POST("/asset-references", transport.nodeRoute("MaterializeCanvasStandaloneAssetReference", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.MaterializeCanvasStandaloneAssetReference(ctx, input)
		}))
		r.POST("/storyboard-drafts", transport.nodeRoute("CreateCanvasNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.CreateCanvasNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.CreateCanvasNodes(ctx, input)
		}))
		confirmDrafts := transport.nodeRoute("ConfirmCanvasNodeDrafts", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			request := c.Request
			input := new(contractcanvasnode.ConfirmCanvasNodeDraftsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = c.Param("taskRunId")
			return transport.nodes.ConfirmCanvasNodeDrafts(ctx, input)
		})
		cancelDrafts := transport.nodeRoute("CancelCanvasNodeDrafts", applicationprojectaccess.AccessUpdate, func(ctx context.Context, c *gin.Context) (any, error) {
			input := new(contractcanvasnode.CancelCanvasNodeDraftsRequest)
			setScope(c, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = c.Param("taskRunId")
			return transport.nodes.CancelCanvasNodeDrafts(ctx, input)
		})
		postActions(r, "/storyboard-drafts/:taskRunIdAction", "taskRunId", map[string]gin.HandlerFunc{
			":confirm": confirmDrafts,
			":cancel":  cancelDrafts,
		})
	}
	return router
}

func postAction(routes gin.IRoutes, path, parameter, suffix string, handler gin.HandlerFunc) {
	postActions(routes, path, parameter, map[string]gin.HandlerFunc{suffix: handler})
}

func postActions(routes gin.IRoutes, path, parameter string, handlers map[string]gin.HandlerFunc) {
	routes.POST(path, func(c *gin.Context) {
		value := c.Param(parameter + "Action")
		if value == "" {
			value = c.Param(parameter)
		}
		for suffix, handler := range handlers {
			identifier, ok := httpserver.TrimAction(value, suffix)
			if !ok || identifier == "" {
				continue
			}
			setParam(c, parameter, identifier)
			handler(c)
			return
		}
		c.AbortWithStatus(http.StatusNotFound)
	})
}

func setParam(c *gin.Context, key, value string) {
	for index := range c.Params {
		if c.Params[index].Key == key {
			c.Params[index].Value = value
			return
		}
	}
	c.Params = append(c.Params, gin.Param{Key: key, Value: value})
}

func (transport *Router) readinessRoute() gin.HandlerFunc {
	return func(c *gin.Context) {
		w, request := c.Writer, c.Request
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		defer cancel()
		if transport.readiness == nil || transport.readiness(ctx) != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func (transport *Router) archiveContentRoute() gin.HandlerFunc {
	return func(c *gin.Context) {
		w, request := c.Writer, c.Request
		metadata, err := metadataFromRequest(request, "OpenProjectCanvasVideoArchiveExport")
		if err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		workspaceID := metadataWorkspace(request)
		if transport.access == nil || transport.archives == nil {
			writeProblem(w, errno.New(errno.ErrConfigurationError))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		if err = transport.access.Check(ctx, metadata.TenantID, &workspaceID, metadata.UserID, c.Param("projectId"), applicationprojectaccess.AccessRead); err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		input := &contractcanvas.GetProjectCanvasVideoArchiveExportRequest{
			WorkspaceID: &workspaceID, ProjectID: c.Param("projectId"),
			CanvasID: c.Param("canvasId"), TaskRunID: c.Param("taskRunId"),
		}
		body, filename, err := transport.archives.OpenProjectCanvasVideoArchiveExport(ctx, input)
		if err != nil {
			writeProblem(w, err)
			return
		}
		defer body.Close()
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(filename, `"`, "")+`"`)
		if _, err = io.Copy(w, body); err != nil {
			slog.Warn("stream Canvas archive", "error", err)
		}
	}
}

type endpoint func(context.Context, *gin.Context) (any, error)

func requiredPositiveInt32Query(request *http.Request, name string) (int32, error) {
	value, err := strconv.ParseInt(strings.TrimSpace(request.URL.Query().Get(name)), 10, 32)
	if err != nil || value < 1 {
		if err == nil {
			err = errors.New("query value must be positive")
		}
		return 0, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	return int32(value), nil
}

func optionalBoolQuery(request *http.Request, name string) (*bool, error) {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return nil, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	return &value, nil
}

func (transport *Router) route(action string, endpoint endpoint) gin.HandlerFunc {
	return func(c *gin.Context) {
		w, request := c.Writer, c.Request
		metadata, err := metadataFromRequest(request, action)
		if err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		c.Request = request.WithContext(ctx)
		value, err := endpoint(ctx, c)
		if err != nil {
			slog.Error("canvas request failed", "action", action, "error", err)
			writeProblem(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toSnakeJSON(value))
	}
}

func (transport *Router) workspaceAdminRoute(action string, endpoint endpoint) gin.HandlerFunc {
	return transport.authorizedRoute(action, endpoint, func(request *http.Request) bool {
		return strings.TrimSpace(request.Header.Get("X-Auth-Workspace-Role")) == "workspace_admin"
	})
}

func (transport *Router) platformAdminRoute(action string, endpoint endpoint) gin.HandlerFunc {
	return transport.authorizedRoute(action, endpoint, func(request *http.Request) bool {
		for _, role := range strings.Split(request.Header.Get("X-Auth-Roles"), ",") {
			if strings.TrimSpace(role) == "super_admin" {
				return true
			}
		}
		return false
	})
}

func (transport *Router) authorizedRoute(action string, endpoint endpoint, authorized func(*http.Request) bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		w, request := c.Writer, c.Request
		if !authorized(request) {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		transport.route(action, endpoint)(c)
	}
}

func (transport *Router) nodeRoute(action string, access applicationprojectaccess.Access, endpoint endpoint) gin.HandlerFunc {
	return func(c *gin.Context) {
		w, request := c.Writer, c.Request
		metadata, err := metadataFromRequest(request, action)
		if err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		workspaceID := metadataWorkspace(request)
		if transport.access == nil {
			writeProblem(w, errno.New(errno.ErrConfigurationError))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		if err = transport.access.Check(ctx, metadata.TenantID, &workspaceID, metadata.UserID, c.Param("projectId"), access); err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		c.Request = request.WithContext(ctx)
		value, err := endpoint(ctx, c)
		if err != nil {
			slog.Error("canvas request failed", "action", action, "error", err)
			writeProblem(w, err)
			return
		}
		if request.Method != http.MethodGet && request.Method != http.MethodHead && c.Param("canvasId") != "" && action != "DeleteProjectCanvas" {
			cursor, receiptErr := transport.nodes.CanvasCursor(ctx, &workspaceID, c.Param("projectId"), c.Param("canvasId"))
			if receiptErr != nil {
				writeProblem(w, receiptErr)
				return
			}
			w.Header().Set("X-Canvas-Cursor", strconv.FormatInt(cursor, 10))
		}
		writeJSON(w, http.StatusOK, toSnakeJSON(value))
	}
}

type streamEndpoint func(context.Context, *gin.Context) error

func (transport *Router) nodeStreamRoute(action string, access applicationprojectaccess.Access, endpoint streamEndpoint) gin.HandlerFunc {
	return func(c *gin.Context) {
		w, request := c.Writer, c.Request
		metadata, err := metadataFromRequest(request, action)
		if err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		workspaceID := metadataWorkspace(request)
		if transport.access == nil {
			writeProblem(w, errno.New(errno.ErrConfigurationError))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		if err = transport.access.Check(ctx, metadata.TenantID, &workspaceID, metadata.UserID, c.Param("projectId"), access); err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		c.Request = request.WithContext(ctx)
		if err = endpoint(ctx, c); err != nil {
			slog.Error("canvas stream request failed", "action", action, "error", err)
			writeProblem(w, err)
		}
	}
}

func metadataFromRequest(request *http.Request, action string) (requestcontext.Metadata, error) {
	tenantID := strings.TrimSpace(request.Header.Get("X-Auth-Tenant-ID"))
	userID := strings.TrimSpace(request.Header.Get("X-Auth-User-ID"))
	if tenantID == "" || userID == "" {
		return requestcontext.Metadata{}, errors.New("missing authenticated identity")
	}
	requestID := httpserver.TraceID(request.Context())
	roles := make([]string, 0)
	for _, role := range strings.Split(request.Header.Get("X-Auth-Roles"), ",") {
		if role = strings.TrimSpace(role); role != "" {
			roles = append(roles, role)
		}
	}
	return requestcontext.Metadata{
		RequestID: requestID, TenantID: tenantID, UserID: userID, WorkspaceID: metadataWorkspace(request),
		WorkspaceRole: strings.TrimSpace(request.Header.Get("X-Auth-Workspace-Role")), Roles: roles,
		Service: "canvas", Action: action, Version: apiVersion,
	}, nil
}

func metadataWorkspace(request *http.Request) string {
	return strings.TrimSpace(request.Header.Get("X-Auth-Workspace-ID"))
}

func setScope(c *gin.Context, workspaceID **string, projectID, canvasID *string) {
	request := c.Request
	workspace := metadataWorkspace(request)
	*workspaceID = &workspace
	*projectID = c.Param("projectId")
	*canvasID = c.Param("canvasId")
}

func setResourceScope(c *gin.Context, workspaceID **string, projectID, resourceID *string) {
	request := c.Request
	workspace := metadataWorkspace(request)
	*workspaceID = &workspace
	*projectID = c.Param("projectId")
	*resourceID = c.Param("resourceId")
}

func setResourceAssetScope(c *gin.Context, workspaceID **string, projectID, resourceID, assetID *string) {
	setResourceScope(c, workspaceID, projectID, resourceID)
	*assetID = c.Param("assetId")
}

func decodeOptionalContract(request *http.Request, output any) error {
	if request.Body == nil || request.ContentLength == 0 {
		return nil
	}
	return decodeContract(request, output)
}

func decodeContract(request *http.Request, output any) error {
	decoder := json.NewDecoder(io.LimitReader(request.Body, 8<<20))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return errno.Wrap(errno.ErrInvalidArgument, err)
	}
	if err := ensureEOF(decoder); err != nil {
		return errno.Wrap(errno.ErrInvalidArgument, err)
	}
	encoded, err := json.Marshal(renameJSONKeys(value, snakeToPascal))
	if err != nil {
		return errno.Wrap(errno.ErrSerializationError, err)
	}
	contractDecoder := json.NewDecoder(strings.NewReader(string(encoded)))
	contractDecoder.UseNumber()
	contractDecoder.DisallowUnknownFields()
	if err = contractDecoder.Decode(output); err != nil {
		return errno.Wrap(errno.ErrInvalidArgument, err)
	}
	return nil
}

func ensureEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("request must contain one JSON value")
	}
	return nil
}

func toSnakeJSON(value any) any {
	encoded, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var decoded any
	if err = json.Unmarshal(encoded, &decoded); err != nil {
		return value
	}
	return renameJSONKeys(decoded, pascalToSnake)
}

func renameJSONKeys(value any, rename func(string) string) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			result[rename(key)] = renameJSONKeys(item, rename)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = renameJSONKeys(item, rename)
		}
		return result
	default:
		return value
	}
}

var snakePart = regexp.MustCompile(`_+([a-zA-Z0-9])`)

func snakeToPascal(value string) string {
	value = snakePart.ReplaceAllStringFunc(value, func(part string) string { return strings.ToUpper(part[len(part)-1:]) })
	if value == "" {
		return value
	}
	runes := []rune(value)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func pascalToSnake(value string) string {
	// Preserve common API initialisms as one word. In particular, the generic
	// uppercase-boundary algorithm would otherwise turn NodeIDs into node_i_ds.
	replacer := strings.NewReplacer(
		"IDs", "Ids",
		"ID", "Id",
		"URL", "Url",
		"URI", "Uri",
		"HTTP", "Http",
		"API", "Api",
		"provider", "Provider",
		"XLSX", "Xlsx",
	)
	value = replacer.Replace(value)
	runes := []rune(value)
	var result strings.Builder
	for index, current := range runes {
		if unicode.IsUpper(current) {
			previousIsLowerOrDigit := index > 0 && (unicode.IsLower(runes[index-1]) || unicode.IsDigit(runes[index-1]))
			acronymEndsHere := index > 0 && index+1 < len(runes) && unicode.IsUpper(runes[index-1]) && unicode.IsLower(runes[index+1])
			if previousIsLowerOrDigit || acronymEndsHere {
				result.WriteByte('_')
			}
			result.WriteRune(unicode.ToLower(current))
			continue
		}
		result.WriteRune(current)
	}
	return result.String()
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Warn("write canvas response", "error", err)
	}
}

func writeProblem(w http.ResponseWriter, err error) {
	status := errno.Status(err)
	writeJSON(w, status, map[string]any{
		"type": "about:blank", "title": http.StatusText(status), "status": status,
		"code": errno.CodeOf(err), "detail": errno.MessageOf(err),
	})
}
