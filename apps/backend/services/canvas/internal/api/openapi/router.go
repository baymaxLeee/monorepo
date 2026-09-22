package openapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/go-chi/chi/v5"

	contractasset "github.com/example/monorepo/canvas/internal/api/contracts/asset"
	contractbenefitpackage "github.com/example/monorepo/canvas/internal/api/contracts/benefitpackage"
	contractcanvas "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	contractcommon "github.com/example/monorepo/canvas/internal/api/contracts/common"
	contractproject "github.com/example/monorepo/canvas/internal/api/contracts/project"
	contractprojectusage "github.com/example/monorepo/canvas/internal/api/contracts/projectusage"
	contractresource "github.com/example/monorepo/canvas/internal/api/contracts/resource"
	maturehttp "github.com/example/monorepo/canvas/internal/api/handler"
	requestcontext "github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const apiVersion = "2026-07-31"
const maxStagedUploadBytes int64 = 512 << 20

type Router struct {
	projects       *maturehttp.ProjectHandler
	projectUsage   *maturehttp.ProjectUsageHandler
	canvases       *maturehttp.CanvasHandler
	nodes          *maturehttp.CanvasNodeHandler
	resources      *maturehttp.ResourceHandler
	assets         *maturehttp.AssetHandler
	archives       *maturehttp.CanvasArchiveHandler
	executeArchive func(context.Context, string) (any, error)
	uploadBlob     func(context.Context, io.Reader) (string, int64, error)
	access         applicationprojectaccess.MemberChecker
}

func NewRouter(internalToken string, projects *maturehttp.ProjectHandler, projectUsage *maturehttp.ProjectUsageHandler, canvases *maturehttp.CanvasHandler, nodes *maturehttp.CanvasNodeHandler, resources *maturehttp.ResourceHandler, assets *maturehttp.AssetHandler, archives *maturehttp.CanvasArchiveHandler, executeArchive func(context.Context, string) (any, error), uploadBlob func(context.Context, io.Reader) (string, int64, error), access applicationprojectaccess.MemberChecker) http.Handler {
	transport := &Router{projects: projects, projectUsage: projectUsage, canvases: canvases, nodes: nodes, resources: resources, assets: assets, archives: archives, executeArchive: executeArchive, uploadBlob: uploadBlob, access: access}
	router := chi.NewRouter()
	router.Use(serviceAuthentication(internalToken))
	router.Get("/livez", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Post("/internal/worker/archives/{archiveId}/execute", transport.internalArchiveRoute())
	router.Post("/uploads", transport.uploadRoute())
	router.Get("/admin/projects", transport.workspaceAdminRoute("ListProjects", func(ctx context.Context, request *http.Request) (any, error) {
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
	router.Post("/admin/projects", transport.workspaceAdminRoute("CreateProject", func(ctx context.Context, request *http.Request) (any, error) {
		input := new(contractproject.CreateProjectRequest)
		if err := decodeContract(request, input); err != nil {
			return nil, err
		}
		workspace := metadataWorkspace(request)
		input.WorkspaceID = &workspace
		return transport.projects.CreateProject(ctx, input)
	}))
	router.Route("/admin/projects/{projectId}", func(r chi.Router) {
		r.Get("/", transport.workspaceAdminRoute("GetProject", func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			return transport.projects.GetProject(ctx, &contractproject.GetProjectRequest{
				WorkspaceID: &workspace, ProjectID: chi.URLParam(request, "projectId"),
			})
		}))
		r.Put("/", transport.workspaceAdminRoute("UpdateProject", func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractproject.UpdateProjectRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, chi.URLParam(request, "projectId")
			return transport.projects.UpdateProject(ctx, input)
		}))
		r.Delete("/", transport.workspaceAdminRoute("DeleteProject", func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			return transport.projects.DeleteProject(ctx, &contractproject.DeleteProjectRequest{
				WorkspaceID: &workspace, ProjectID: chi.URLParam(request, "projectId"),
			})
		}))
		r.Post("/usage:export", transport.workspaceAdminRoute("DownloadProjectUsageXLSX", func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			return transport.projectUsage.DownloadProjectUsageXLSX(ctx, &contractprojectusage.DownloadProjectUsageXLSXRequest{
				WorkspaceID: &workspace, ProjectID: chi.URLParam(request, "projectId"),
			})
		}))
	})
	router.Get("/benefit-packages", transport.route("ListAvailableBenefitPackages", func(ctx context.Context, _ *http.Request) (any, error) {
		return transport.assets.ListAvailableBenefitPackages(ctx, &contractbenefitpackage.ListAvailableBenefitPackagesRequest{})
	}))
	router.Get("/projects", transport.route("ListProjectsByMember", func(ctx context.Context, request *http.Request) (any, error) {
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
	router.Post("/projects", transport.route("CreateProject", func(ctx context.Context, request *http.Request) (any, error) {
		input := new(contractproject.CreateProjectRequest)
		if err := decodeContract(request, input); err != nil {
			return nil, err
		}
		workspace := metadataWorkspace(request)
		input.WorkspaceID = &workspace
		return transport.projects.CreateProject(ctx, input)
	}))
	router.Route("/projects/{projectId}", func(r chi.Router) {
		r.Get("/models", transport.nodeRoute("ListProjectModels", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
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
				WorkspaceID: &workspace, ProjectID: chi.URLParam(request, "projectId"),
				ListOpt: &contractproject.ProjectModelListOption{PageNumber: pageNum, PageSize: pageSize},
				Filter:  &contractproject.ProjectModelFilter{IsGranted: &granted},
			})
		}))
		r.Post("/resources:batchDelete", transport.nodeRoute("BatchDeleteResources", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractresource.BatchDeleteResourcesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, chi.URLParam(request, "projectId")
			return transport.resources.BatchDeleteResources(ctx, input)
		}))
		r.Post("/resource-assets:batchList", transport.nodeRoute("BatchListResourceAssets", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractresource.BatchListResourceAssetsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, chi.URLParam(request, "projectId")
			return transport.resources.BatchListResourceAssets(ctx, input)
		}))
		r.Post("/asset-reviews:batchGet", transport.nodeRoute("BatchGetAssetReviews", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractasset.BatchGetAssetReviewsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, chi.URLParam(request, "projectId")
			return transport.assets.BatchGetAssetReviews(ctx, input)
		}))
		r.Post("/asset-reviews:batchSubmit", transport.nodeRoute("BatchSubmitAssetReviews", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractasset.BatchSubmitAssetReviewsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, chi.URLParam(request, "projectId")
			return transport.assets.BatchSubmitAssetReviews(ctx, input)
		}))
		r.Get("/", transport.nodeRoute("GetProjectByMember", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			input := &contractproject.GetProjectByMemberRequest{
				WorkspaceID: &workspace,
				ProjectID:   chi.URLParam(request, "projectId"),
			}
			return transport.projects.GetProjectByMember(ctx, input)
		}))
		r.Patch("/", transport.nodeRoute("UpdateProjectByMember", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractproject.UpdateProjectByMemberRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = chi.URLParam(request, "projectId")
			return transport.projects.UpdateProjectByMember(ctx, input)
		}))
		r.Delete("/", transport.nodeRoute("DeleteProject", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			input := &contractproject.DeleteProjectRequest{
				WorkspaceID: &workspace,
				ProjectID:   chi.URLParam(request, "projectId"),
			}
			return transport.projects.DeleteProject(ctx, input)
		}))
		r.Get("/canvases", transport.nodeRoute("ListProjectCanvases", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
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
				WorkspaceID: &workspace, ProjectID: chi.URLParam(request, "projectId"),
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
		r.Post("/canvases", transport.nodeRoute("CreateProjectCanvas", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.CreateProjectCanvasRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID, input.ProjectID = &workspace, chi.URLParam(request, "projectId")
			return transport.canvases.CreateProjectCanvas(ctx, input)
		}))
		r.Get("/resources", transport.nodeRoute("ListResources", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
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
				ProjectID:   chi.URLParam(request, "projectId"),
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
		r.Get("/resources:stats", transport.nodeRoute("GetProjectResourceStats", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			return transport.resources.GetProjectResourceStats(ctx, &contractresource.GetProjectResourceStatsRequest{
				WorkspaceID: &workspace, ProjectID: chi.URLParam(request, "projectId"),
			})
		}))
		r.Post("/resources", transport.nodeRoute("CreateResource", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractresource.CreateResourceRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = chi.URLParam(request, "projectId")
			return transport.resources.CreateResource(ctx, input)
		}))
		r.Post("/resources:fromAsset", transport.nodeRoute("CreateResourceFromAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractresource.CreateResourceFromAssetRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = chi.URLParam(request, "projectId")
			return transport.resources.CreateResourceFromAsset(ctx, input)
		}))
		r.Route("/resources/{resourceId}", func(resources chi.Router) {
			resources.Post("/generation-states:batchGet", transport.nodeRoute("BatchGetResourceAssetGenerationStates", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.BatchGetResourceAssetGenerationStatesRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.BatchGetResourceAssetGenerationStates(ctx, input)
			}))
			resources.Post("/assets:batchDelete", transport.nodeRoute("BatchDeleteResourceAssets", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.BatchDeleteResourceAssetsRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.BatchDeleteResourceAssets(ctx, input)
			}))
			resources.Get("/", transport.nodeRoute("GetResource", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.GetResourceRequest)
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.GetResource(ctx, input)
			}))
			resources.Patch("/", transport.nodeRoute("UpdateResource", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.UpdateResourceRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.UpdateResource(ctx, input)
			}))
			resources.Delete("/", transport.nodeRoute("DeleteResource", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.DeleteResourceRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.DeleteResource(ctx, input)
			}))
			resources.Get("/assets", transport.nodeRoute("ListResourceAssets", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
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
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.ListResourceAssets(ctx, input)
			}))
			resources.Post("/assets", transport.nodeRoute("CreateResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.CreateResourceAssetRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.CreateResourceAsset(ctx, input)
			}))
			resources.Post("/generated-assets", transport.nodeRoute("CreateGeneratedResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
				input := new(contractresource.CreateGeneratedResourceAssetRequest)
				if err := decodeContract(request, input); err != nil {
					return nil, err
				}
				setResourceScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID)
				return transport.resources.CreateGeneratedResourceAsset(ctx, input)
			}))
			resources.Route("/assets/{assetId}", func(assets chi.Router) {
				assets.Patch("/", transport.nodeRoute("UpdateResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.UpdateResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.UpdateResourceAsset(ctx, input)
				}))
				assets.Delete("/", transport.nodeRoute("DeleteResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.DeleteResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.DeleteResourceAsset(ctx, input)
				}))
				assets.Post("/primary", transport.nodeRoute("SetPrimaryResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.SetPrimaryResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.SetPrimaryResourceAsset(ctx, input)
				}))
				assets.Post("/replace", transport.nodeRoute("ReplaceUploadedResourceAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.ReplaceUploadedResourceAssetRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.ReplaceUploadedResourceAsset(ctx, input)
				}))
				assets.Get("/generation", transport.nodeRoute("GetResourceAssetGeneration", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.GetResourceAssetGenerationRequest)
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.GetResourceAssetGeneration(ctx, input)
				}))
				assets.Patch("/generation", transport.nodeRoute("UpdateResourceAssetGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.UpdateResourceAssetGenerationRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.UpdateResourceAssetGeneration(ctx, input)
				}))
				assets.Post("/generation/runs", transport.nodeRoute("StartResourceAssetGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.StartResourceAssetGenerationRequest)
					if err := decodeContract(request, input); err != nil {
						return nil, err
					}
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					return transport.resources.StartResourceAssetGeneration(ctx, input)
				}))
				assets.Get("/generation/runs/{taskRunId}", transport.nodeRoute("GetResourceAssetGenerationRun", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.GetResourceAssetGenerationRunRequest)
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					input.TaskRunID = chi.URLParam(request, "taskRunId")
					return transport.resources.GetResourceAssetGenerationRun(ctx, input)
				}))
				assets.Post("/generation/runs/{taskRunId}:cancel", transport.nodeRoute("CancelResourceAssetGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
					input := new(contractresource.CancelResourceAssetGenerationRequest)
					setResourceAssetScope(request, &input.WorkspaceID, &input.ProjectID, &input.ResourceID, &input.ResourceAssetID)
					input.TaskRunID = chi.URLParam(request, "taskRunId")
					return transport.resources.CancelResourceAssetGeneration(ctx, input)
				}))
			})
		})
	})
	router.Route("/projects/{projectId}/canvases/{canvasId}", func(r chi.Router) {
		r.Get("/", transport.nodeRoute("GetProjectCanvas", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			input := &contractcanvas.GetProjectCanvasRequest{
				WorkspaceID: &workspace,
				ProjectID:   chi.URLParam(request, "projectId"),
				CanvasID:    chi.URLParam(request, "canvasId"),
			}
			return transport.canvases.GetProjectCanvas(ctx, input)
		}))
		r.Patch("/", transport.nodeRoute("UpdateProjectCanvas", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.UpdateProjectCanvasRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = chi.URLParam(request, "projectId")
			input.CanvasID = chi.URLParam(request, "canvasId")
			return transport.canvases.UpdateProjectCanvas(ctx, input)
		}))
		r.Delete("/", transport.nodeRoute("DeleteProjectCanvas", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			workspace := metadataWorkspace(request)
			input := &contractcanvas.DeleteProjectCanvasRequest{
				WorkspaceID: &workspace,
				ProjectID:   chi.URLParam(request, "projectId"),
				CanvasID:    chi.URLParam(request, "canvasId"),
			}
			return transport.canvases.DeleteProjectCanvas(ctx, input)
		}))
		r.Patch("/view", transport.nodeRoute("UpdateCanvasView", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.UpdateCanvasViewRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			workspace := metadataWorkspace(request)
			input.WorkspaceID = &workspace
			input.ProjectID = chi.URLParam(request, "projectId")
			input.CanvasID = chi.URLParam(request, "canvasId")
			return transport.canvases.UpdateCanvasView(ctx, input)
		}))
		r.Post("/archives", transport.nodeRoute("StartProjectCanvasVideoArchiveExport", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.StartProjectCanvasVideoArchiveExportRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.archives.StartProjectCanvasVideoArchiveExport(ctx, input)
		}))
		r.Get("/archives", transport.nodeRoute("ListProjectCanvasVideoArchiveExports", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.ListProjectCanvasVideoArchiveExportsRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
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
		r.Get("/archives/{taskRunId}", transport.nodeRoute("GetProjectCanvasVideoArchiveExport", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.GetProjectCanvasVideoArchiveExportRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = chi.URLParam(request, "taskRunId")
			return transport.archives.GetProjectCanvasVideoArchiveExport(ctx, input)
		}))
		r.Post("/archives/{taskRunId}:cancel", transport.nodeRoute("CancelProjectCanvasVideoArchiveExport", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvas.CancelProjectCanvasVideoArchiveExportRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = chi.URLParam(request, "taskRunId")
			return transport.archives.CancelProjectCanvasVideoArchiveExport(ctx, input)
		}))
		r.Get("/archives/{taskRunId}/content", transport.archiveContentRoute())
		r.Get("/nodes", transport.nodeRoute("GetCanvasGraph", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := &contractcanvasnode.GetCanvasGraphRequest{}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.GetCanvasGraph(ctx, input)
		}))
		r.Post("/nodes", transport.nodeRoute("CreateCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CreateCanvasNodeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.CreateCanvasNode(ctx, input)
		}))
		r.Post("/assets", transport.nodeRoute("CreateCanvasAsset", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CreateCanvasAssetRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.CreateCanvasAsset(ctx, input)
		}))
		r.Patch("/nodes/{nodeId}", transport.nodeRoute("UpdateCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.UpdateCanvasNodeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.UpdateCanvasNode(ctx, input)
		}))
		r.Patch("/node-positions", transport.nodeRoute("BatchUpdateCanvasNodePositions", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.BatchUpdateCanvasNodePositionsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.BatchUpdateCanvasNodePositions(ctx, input)
		}))
		r.Delete("/nodes/{nodeId}", transport.nodeRoute("DeleteCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.DeleteCanvasNodeRequest)
			if err := decodeOptionalContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.DeleteCanvasNode(ctx, input)
		}))
		r.Post("/nodes:batchDelete", transport.nodeRoute("BatchDeleteCanvasNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.BatchDeleteCanvasNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.BatchDeleteCanvasNodes(ctx, input)
		}))
		r.Post("/edges", transport.nodeRoute("ConnectCanvasNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.ConnectCanvasNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.ConnectCanvasNodes(ctx, input)
		}))
		r.Delete("/edges", transport.nodeRoute("DeleteCanvasEdge", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.DeleteCanvasEdgeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.DeleteCanvasEdge(ctx, input)
		}))
		r.Put("/storyboard-order", transport.nodeRoute("ReorderStoryboardNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.ReorderStoryboardNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.ReorderStoryboardNodes(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/generations", transport.nodeRoute("StartCanvasNodeGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.StartCanvasNodeGenerationRequest)
			if err := decodeOptionalContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.StartCanvasNodeGeneration(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/text-generations:stream", transport.nodeStreamRoute("StartCanvasNodeTextGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, writer http.ResponseWriter, request *http.Request) error {
			input := new(contractcanvasnode.StartCanvasNodeTextGenerationRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.StreamCanvasNodeTextGeneration(ctx, writer, input)
		}))
		r.Post("/generations", transport.nodeRoute("StartCanvasGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.StartCanvasGenerationRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.StartCanvasGeneration(ctx, input)
		}))
		r.Get("/nodes/{nodeId}/histories", transport.nodeRoute("ListCanvasNodeHistories", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.ListCanvasNodeHistoriesRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.ListCanvasNodeHistories(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/histories/{historyId}:select", transport.nodeRoute("SelectCanvasNodeHistory", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.SelectCanvasNodeHistoryRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			input.HistoryID = chi.URLParam(request, "historyId")
			return transport.nodes.SelectCanvasNodeHistory(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/generations/{taskRunId}:cancel", transport.nodeRoute("CancelCanvasNodeGeneration", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CancelCanvasNodeGenerationRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			input.TaskRunID = chi.URLParam(request, "taskRunId")
			return transport.nodes.CancelCanvasNodeGeneration(ctx, input)
		}))
		r.Post("/nodes/{nodeId}:copy", transport.nodeRoute("CopyCanvasNode", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CopyCanvasNodeRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.SourceNodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.CopyCanvasNode(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/asset-search", transport.nodeRoute("SearchCanvasNodeAssets", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.SearchCanvasNodeAssetsRequest)
			if err := decodeOptionalContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			if input.Limit == 0 {
				input.Limit = 50
			}
			return transport.nodes.SearchCanvasNodeAssets(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/asset-matches", transport.nodeRoute("StartCanvasNodeAssetsMatch", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.StartCanvasNodeAssetsMatchRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			return transport.nodes.StartCanvasNodeAssetsMatch(ctx, input)
		}))
		r.Post("/nodes/{nodeId}/asset-matches/{taskRunId}:cancel", transport.nodeRoute("CancelCanvasNodeAssetsMatch", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CancelCanvasNodeAssetsMatchRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.NodeID = chi.URLParam(request, "nodeId")
			input.TaskRunID = chi.URLParam(request, "taskRunId")
			return transport.nodes.CancelCanvasNodeAssetsMatch(ctx, input)
		}))
		r.Post("/resource-references", transport.nodeRoute("MaterializeCanvasResourceAssetReference", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.MaterializeCanvasResourceAssetReferenceRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.MaterializeCanvasResourceAssetReference(ctx, input)
		}))
		r.Post("/asset-references", transport.nodeRoute("MaterializeCanvasStandaloneAssetReference", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.MaterializeCanvasStandaloneAssetReference(ctx, input)
		}))
		r.Post("/storyboard-drafts", transport.nodeRoute("CreateCanvasNodes", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CreateCanvasNodesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.CreateCanvasNodes(ctx, input)
		}))
		r.Post("/storyboard-drafts/{taskRunId}:confirm", transport.nodeRoute("ConfirmCanvasNodeDrafts", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.ConfirmCanvasNodeDraftsRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = chi.URLParam(request, "taskRunId")
			return transport.nodes.ConfirmCanvasNodeDrafts(ctx, input)
		}))
		r.Post("/storyboard-drafts/{taskRunId}:cancel", transport.nodeRoute("CancelCanvasNodeDrafts", applicationprojectaccess.AccessUpdate, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.CancelCanvasNodeDraftsRequest)
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			input.TaskRunID = chi.URLParam(request, "taskRunId")
			return transport.nodes.CancelCanvasNodeDrafts(ctx, input)
		}))
		r.Post("/node-states:batchGet", transport.nodeRoute("BatchGetCanvasNodeStates", applicationprojectaccess.AccessRead, func(ctx context.Context, request *http.Request) (any, error) {
			input := new(contractcanvasnode.BatchGetCanvasNodeStatesRequest)
			if err := decodeContract(request, input); err != nil {
				return nil, err
			}
			setScope(request, &input.WorkspaceID, &input.ProjectID, &input.CanvasID)
			return transport.nodes.BatchGetCanvasNodeStates(ctx, input)
		}))
	})
	return router
}

func serviceAuthentication(expectedToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			if request.URL.Path == "/livez" {
				next.ServeHTTP(w, request)
				return
			}
			token := request.Header.Get("X-Internal-Token")
			caller := strings.TrimSpace(request.Header.Get("X-Caller-Service"))
			if caller == "" || len(token) != len(expectedToken) || subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
				writeProblem(w, errno.New(errno.ErrForbidden))
				return
			}
			next.ServeHTTP(w, request)
		})
	}
}

func (transport *Router) internalArchiveRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		if strings.TrimSpace(request.Header.Get("X-Caller-Service")) != "executor" || transport.executeArchive == nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		value, err := transport.executeArchive(request.Context(), chi.URLParam(request, "archiveId"))
		if err != nil {
			writeProblem(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toSnakeJSON(value))
	}
}

func (transport *Router) archiveContentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
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
		if err = transport.access.Check(request.Context(), metadata.TenantID, &workspaceID, metadata.UserID, chi.URLParam(request, "projectId")); err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		input := &contractcanvas.GetProjectCanvasVideoArchiveExportRequest{
			WorkspaceID: &workspaceID, ProjectID: chi.URLParam(request, "projectId"),
			CanvasID: chi.URLParam(request, "canvasId"), TaskRunID: chi.URLParam(request, "taskRunId"),
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

type endpoint func(context.Context, *http.Request) (any, error)

func (transport *Router) uploadRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		metadata, err := metadataFromRequest(request, "StageUpload")
		if err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		if transport.uploadBlob == nil {
			writeProblem(w, errno.New(errno.ErrConfigurationError))
			return
		}
		if request.ContentLength > maxStagedUploadBytes {
			writeProblem(w, errno.New(errno.ErrInvalidArgument))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		request.Body = http.MaxBytesReader(w, request.Body, maxStagedUploadBytes)
		blobID, size, err := transport.uploadBlob(ctx, request.Body)
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				err = errno.New(errno.ErrInvalidArgument)
			}
			slog.Error("canvas request failed", "action", "StageUpload", "error", err)
			writeProblem(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toSnakeJSON(&contractasset.StagedUpload{BlobID: blobID, SizeBytes: size}))
	}
}

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

func (transport *Router) route(action string, endpoint endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		metadata, err := metadataFromRequest(request, action)
		if err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		value, err := endpoint(ctx, request.WithContext(ctx))
		if err != nil {
			slog.Error("canvas request failed", "action", action, "error", err)
			writeProblem(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toSnakeJSON(value))
	}
}

func (transport *Router) workspaceAdminRoute(action string, endpoint endpoint) http.HandlerFunc {
	return transport.authorizedRoute(action, endpoint, func(request *http.Request) bool {
		return strings.TrimSpace(request.Header.Get("X-Auth-Workspace-Role")) == "workspace_admin"
	})
}

func (transport *Router) platformAdminRoute(action string, endpoint endpoint) http.HandlerFunc {
	return transport.authorizedRoute(action, endpoint, func(request *http.Request) bool {
		for _, role := range strings.Split(request.Header.Get("X-Auth-Roles"), ",") {
			if strings.TrimSpace(role) == "super_admin" {
				return true
			}
		}
		return false
	})
}

func (transport *Router) authorizedRoute(action string, endpoint endpoint, authorized func(*http.Request) bool) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		transport.route(action, endpoint)(w, request)
	}
}

func (transport *Router) nodeRoute(action string, _ applicationprojectaccess.Access, endpoint endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
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
		if err = transport.access.Check(request.Context(), metadata.TenantID, &workspaceID, metadata.UserID, chi.URLParam(request, "projectId")); err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		value, err := endpoint(ctx, request.WithContext(ctx))
		if err != nil {
			slog.Error("canvas request failed", "action", action, "error", err)
			writeProblem(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toSnakeJSON(value))
	}
}

type streamEndpoint func(context.Context, http.ResponseWriter, *http.Request) error

func (transport *Router) nodeStreamRoute(action string, _ applicationprojectaccess.Access, endpoint streamEndpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
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
		if err = transport.access.Check(request.Context(), metadata.TenantID, &workspaceID, metadata.UserID, chi.URLParam(request, "projectId")); err != nil {
			writeProblem(w, errno.New(errno.ErrForbidden))
			return
		}
		ctx := requestcontext.WithMetadata(request.Context(), metadata)
		if err = endpoint(ctx, w, request.WithContext(ctx)); err != nil {
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
	requestID := strings.TrimSpace(request.Header.Get("X-Trace-Id"))
	return requestcontext.Metadata{RequestID: requestID, TenantID: tenantID, UserID: userID, WorkspaceID: metadataWorkspace(request), Service: "canvas", Action: action, Version: apiVersion, AcceptLanguage: request.Header.Get("Accept-Language")}, nil
}

func metadataWorkspace(request *http.Request) string {
	return strings.TrimSpace(request.Header.Get("X-Auth-Workspace-ID"))
}

func setScope(request *http.Request, workspaceID **string, projectID, canvasID *string) {
	workspace := metadataWorkspace(request)
	*workspaceID = &workspace
	*projectID = chi.URLParam(request, "projectId")
	*canvasID = chi.URLParam(request, "canvasId")
}

func setResourceScope(request *http.Request, workspaceID **string, projectID, resourceID *string) {
	workspace := metadataWorkspace(request)
	*workspaceID = &workspace
	*projectID = chi.URLParam(request, "projectId")
	*resourceID = chi.URLParam(request, "resourceId")
}

func setResourceAssetScope(request *http.Request, workspaceID **string, projectID, resourceID, assetID *string) {
	setResourceScope(request, workspaceID, projectID, resourceID)
	*assetID = chi.URLParam(request, "assetId")
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
		"AIGW", "Aigw",
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
