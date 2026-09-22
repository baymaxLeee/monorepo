package openapi

import (
	"reflect"
	"slices"
	"strings"

	contractasset "github.com/example/monorepo/canvas/internal/api/contracts/asset"
	contractbase "github.com/example/monorepo/canvas/internal/api/contracts/base"
	contractbenefitpackage "github.com/example/monorepo/canvas/internal/api/contracts/benefitpackage"
	contractcanvas "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	contractproject "github.com/example/monorepo/canvas/internal/api/contracts/project"
	contractprojectusage "github.com/example/monorepo/canvas/internal/api/contracts/projectusage"
	contractresource "github.com/example/monorepo/canvas/internal/api/contracts/resource"
)

type operationSpec struct {
	method string
	path   string
	id     string
	input  reflect.Type
	output reflect.Type
}

type queryParameterSpec struct {
	name     string
	kind     string
	required bool
}

func contractType[T any]() reflect.Type { return reflect.TypeFor[T]() }

var operations = []operationSpec{
	{"GET", "/benefit-packages", "canvasListAvailableBenefitPackages", nil, contractType[*contractbenefitpackage.ListAvailableBenefitPackagesResponse]()},
	{"POST", "/uploads", "canvasStageUpload", nil, contractType[*contractasset.StagedUpload]()},
	{"POST", "/cover-uploads", "canvasStageCoverUpload", nil, contractType[*contractasset.StagedUpload]()},
	{"GET", "/admin/projects", "canvasAdminListProjects", nil, contractType[*contractproject.ListProjectsResponse]()},
	{"POST", "/admin/projects", "canvasAdminCreateProject", contractType[*contractproject.CreateProjectRequest](), contractType[*contractproject.CreateProjectResponse]()},
	{"GET", "/admin/projects/{projectId}", "canvasAdminGetProject", nil, contractType[*contractproject.GetProjectResponse]()},
	{"PUT", "/admin/projects/{projectId}", "canvasAdminUpdateProject", contractType[*contractproject.UpdateProjectRequest](), contractType[*contractproject.UpdateProjectResponse]()},
	{"DELETE", "/admin/projects/{projectId}", "canvasAdminDeleteProject", nil, contractType[*contractbase.Empty]()},
	{"POST", "/admin/projects/{projectId}/usage:export", "canvasDownloadProjectUsage", nil, contractType[*contractprojectusage.DownloadProjectUsageXLSXResponse]()},
	{"GET", "/projects", "canvasListProjects", nil, contractType[*contractproject.ListProjectsByMemberResponse]()},
	{"POST", "/projects", "canvasCreateProject", contractType[*contractproject.CreateProjectRequest](), contractType[*contractproject.CreateProjectResponse]()},
	{"GET", "/projects/{projectId}", "canvasGetProject", nil, contractType[*contractproject.GetProjectByMemberResponse]()},
	{"PATCH", "/projects/{projectId}", "canvasUpdateProject", contractType[*contractproject.UpdateProjectByMemberRequest](), contractType[*contractproject.UpdateProjectByMemberResponse]()},
	{"DELETE", "/projects/{projectId}", "canvasDeleteProject", nil, contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/asset-reviews:batchGet", "canvasBatchGetAssetReviews", contractType[*contractasset.BatchGetAssetReviewsRequest](), contractType[*contractasset.BatchGetAssetReviewsResponse]()},
	{"POST", "/projects/{projectId}/asset-reviews:batchSubmit", "canvasBatchSubmitAssetReviews", contractType[*contractasset.BatchSubmitAssetReviewsRequest](), contractType[*contractasset.BatchSubmitAssetReviewsResponse]()},
	{"GET", "/projects/{projectId}/models", "canvasListProjectModels", nil, contractType[*contractproject.ListProjectModelsResponse]()},
	{"POST", "/projects/{projectId}/resources:batchDelete", "canvasBatchDeleteResources", contractType[*contractresource.BatchDeleteResourcesRequest](), contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/resource-assets:batchList", "canvasBatchListResourceAssets", contractType[*contractresource.BatchListResourceAssetsRequest](), contractType[*contractresource.BatchListResourceAssetsResponse]()},
	{"GET", "/projects/{projectId}/canvases", "canvasListCanvases", nil, contractType[*contractcanvas.ListProjectCanvasesResponse]()},
	{"POST", "/projects/{projectId}/canvases", "canvasCreateCanvas", contractType[*contractcanvas.CreateProjectCanvasRequest](), contractType[*contractcanvas.CreateProjectCanvasResponse]()},
	{"GET", "/projects/{projectId}/resources", "canvasListResources", nil, contractType[*contractresource.ListResourcesResponse]()},
	{"GET", "/projects/{projectId}/resources:stats", "canvasGetProjectResourceStats", nil, contractType[*contractresource.GetProjectResourceStatsResponse]()},
	{"POST", "/projects/{projectId}/resources", "canvasCreateResource", contractType[*contractresource.CreateResourceRequest](), contractType[*contractresource.CreateResourceResponse]()},
	{"POST", "/projects/{projectId}/resources:fromAsset", "canvasCreateResourceFromAsset", contractType[*contractresource.CreateResourceFromAssetRequest](), contractType[*contractresource.CreateResourceFromAssetResponse]()},
	{"GET", "/projects/{projectId}/resources/{resourceId}", "canvasGetResource", nil, contractType[*contractresource.GetResourceResponse]()},
	{"PATCH", "/projects/{projectId}/resources/{resourceId}", "canvasUpdateResource", contractType[*contractresource.UpdateResourceRequest](), contractType[*contractresource.UpdateResourceResponse]()},
	{"DELETE", "/projects/{projectId}/resources/{resourceId}", "canvasDeleteResource", contractType[*contractresource.DeleteResourceRequest](), contractType[*contractbase.Empty]()},
	{"GET", "/projects/{projectId}/resources/{resourceId}/assets", "canvasListResourceAssets", nil, contractType[*contractresource.ListResourceAssetsResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets", "canvasCreateResourceAsset", contractType[*contractresource.CreateResourceAssetRequest](), contractType[*contractresource.CreateResourceAssetResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/generated-assets", "canvasCreateGeneratedResourceAsset", contractType[*contractresource.CreateGeneratedResourceAssetRequest](), contractType[*contractresource.CreateGeneratedResourceAssetResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/generation-states:batchGet", "canvasBatchGetResourceGenerationStates", contractType[*contractresource.BatchGetResourceAssetGenerationStatesRequest](), contractType[*contractresource.BatchGetResourceAssetGenerationStatesResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets:batchDelete", "canvasBatchDeleteResourceAssets", contractType[*contractresource.BatchDeleteResourceAssetsRequest](), contractType[*contractbase.Empty]()},
	{"PATCH", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}", "canvasUpdateResourceAsset", contractType[*contractresource.UpdateResourceAssetRequest](), contractType[*contractresource.UpdateResourceAssetResponse]()},
	{"DELETE", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}", "canvasDeleteResourceAsset", contractType[*contractresource.DeleteResourceAssetRequest](), contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/primary", "canvasSetPrimaryResourceAsset", contractType[*contractresource.SetPrimaryResourceAssetRequest](), contractType[*contractresource.SetPrimaryResourceAssetResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/replace", "canvasReplaceResourceAsset", contractType[*contractresource.ReplaceUploadedResourceAssetRequest](), contractType[*contractresource.ReplaceUploadedResourceAssetResponse]()},
	{"GET", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/generation", "canvasGetResourceGeneration", nil, contractType[*contractresource.GetResourceAssetGenerationResponse]()},
	{"PATCH", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/generation", "canvasUpdateResourceGeneration", contractType[*contractresource.UpdateResourceAssetGenerationRequest](), contractType[*contractresource.UpdateResourceAssetGenerationResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/generation/runs", "canvasStartResourceGeneration", contractType[*contractresource.StartResourceAssetGenerationRequest](), contractType[*contractresource.StartResourceAssetGenerationResponse]()},
	{"GET", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/generation/runs/{taskRunId}", "canvasGetResourceGenerationRun", nil, contractType[*contractresource.GetResourceAssetGenerationRunResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets/{assetId}/generation/runs/{taskRunId}:cancel", "canvasCancelResourceGeneration", nil, contractType[*contractbase.Empty]()},
	{"GET", "/projects/{projectId}/canvases/{canvasId}", "canvasGetCanvas", nil, contractType[*contractcanvas.GetProjectCanvasResponse]()},
	{"PATCH", "/projects/{projectId}/canvases/{canvasId}", "canvasUpdateCanvas", contractType[*contractcanvas.UpdateProjectCanvasRequest](), contractType[*contractcanvas.UpdateProjectCanvasResponse]()},
	{"DELETE", "/projects/{projectId}/canvases/{canvasId}", "canvasDeleteCanvas", nil, contractType[*contractbase.Empty]()},
	{"PATCH", "/projects/{projectId}/canvases/{canvasId}/view", "canvasUpdateCanvasView", contractType[*contractcanvas.UpdateCanvasViewRequest](), contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/archives", "canvasCreateArchive", nil, contractType[*contractcanvas.StartProjectCanvasVideoArchiveExportResponse]()},
	{"GET", "/projects/{projectId}/canvases/{canvasId}/archives", "canvasListArchives", nil, contractType[*contractcanvas.ListProjectCanvasVideoArchiveExportsResponse]()},
	{"GET", "/projects/{projectId}/canvases/{canvasId}/archives/{taskRunId}", "canvasGetArchive", nil, contractType[*contractcanvas.GetProjectCanvasVideoArchiveExportResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/archives/{taskRunId}:cancel", "canvasCancelArchive", nil, contractType[*contractbase.Empty]()},
	{"GET", "/projects/{projectId}/canvases/{canvasId}/archives/{taskRunId}/content", "canvasArchiveContent", nil, nil},
	{"POST", "/internal/worker/archives/{archiveId}/execute", "canvasExecuteArchive", nil, contractType[*contractcanvas.ProjectCanvasVideoArchiveExport]()},
	{"POST", "/internal/worker/video-generations/{taskRunId}/extract-frames", "canvasExtractVideoFrames", nil, contractType[*contractbase.Empty]()},
	{"GET", "/projects/{projectId}/canvases/{canvasId}/nodes", "canvasGetGraph", nil, contractType[*contractcanvasnode.GetCanvasGraphResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes", "canvasCreateNode", contractType[*contractcanvasnode.CreateCanvasNodeRequest](), contractType[*contractcanvasnode.CreateCanvasNodeResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/assets", "canvasCreateAsset", contractType[*contractcanvasnode.CreateCanvasAssetRequest](), contractType[*contractcanvasnode.CreateCanvasAssetResponse]()},
	{"PATCH", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}", "canvasUpdateNode", contractType[*contractcanvasnode.UpdateCanvasNodeRequest](), contractType[*contractcanvasnode.UpdateCanvasNodeResponse]()},
	{"DELETE", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}", "canvasDeleteNode", contractType[*contractcanvasnode.DeleteCanvasNodeRequest](), contractType[*contractcanvasnode.DeleteCanvasNodeResponse]()},
	{"PATCH", "/projects/{projectId}/canvases/{canvasId}/node-positions", "canvasUpdateNodePositions", contractType[*contractcanvasnode.BatchUpdateCanvasNodePositionsRequest](), contractType[*contractcanvasnode.BatchUpdateCanvasNodePositionsResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes:batchDelete", "canvasBatchDeleteNodes", contractType[*contractcanvasnode.BatchDeleteCanvasNodesRequest](), contractType[*contractcanvasnode.BatchDeleteCanvasNodesResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/edges", "canvasConnectNodes", contractType[*contractcanvasnode.ConnectCanvasNodesRequest](), contractType[*contractcanvasnode.ConnectCanvasNodesResponse]()},
	{"DELETE", "/projects/{projectId}/canvases/{canvasId}/edges", "canvasDeleteEdge", contractType[*contractcanvasnode.DeleteCanvasEdgeRequest](), contractType[*contractcanvasnode.DeleteCanvasEdgeResponse]()},
	{"PUT", "/projects/{projectId}/canvases/{canvasId}/storyboard-order", "canvasReorderStoryboard", contractType[*contractcanvasnode.ReorderStoryboardNodesRequest](), contractType[*contractcanvasnode.ReorderStoryboardNodesResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/generations", "canvasStartNodeGeneration", nil, contractType[*contractcanvasnode.StartCanvasNodeGenerationResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/text-generations:stream", "canvasStreamNodeTextGeneration", nil, contractType[*contractcanvasnode.CanvasNodeTextGenerationResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/generations", "canvasStartGeneration", nil, contractType[*contractcanvasnode.StartCanvasGenerationResponse]()},
	{"GET", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/histories", "canvasListNodeHistories", nil, contractType[*contractcanvasnode.ListCanvasNodeHistoriesResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/histories/{historyId}:select", "canvasSelectNodeHistory", nil, contractType[*contractcanvasnode.SelectCanvasNodeHistoryResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/generations/{taskRunId}:cancel", "canvasCancelNodeGeneration", nil, contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}:copy", "canvasCopyNode", contractType[*contractcanvasnode.CopyCanvasNodeRequest](), contractType[*contractcanvasnode.CopyCanvasNodeResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/asset-search", "canvasSearchNodeAssets", contractType[*contractcanvasnode.SearchCanvasNodeAssetsRequest](), contractType[*contractcanvasnode.SearchCanvasNodeAssetsResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/asset-matches", "canvasStartNodeAssetMatch", contractType[*contractcanvasnode.StartCanvasNodeAssetsMatchRequest](), contractType[*contractcanvasnode.StartCanvasNodeAssetsMatchResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/nodes/{nodeId}/asset-matches/{taskRunId}:cancel", "canvasCancelNodeAssetMatch", nil, contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/resource-references", "canvasMaterializeResourceReference", contractType[*contractcanvasnode.MaterializeCanvasResourceAssetReferenceRequest](), contractType[*contractcanvasnode.MaterializeCanvasResourceAssetReferenceResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/asset-references", "canvasMaterializeAssetReference", contractType[*contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceRequest](), contractType[*contractcanvasnode.MaterializeCanvasStandaloneAssetReferenceResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/storyboard-drafts", "canvasStartStoryboardDrafts", contractType[*contractcanvasnode.CreateCanvasNodesRequest](), contractType[*contractcanvasnode.CreateCanvasNodesResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/storyboard-drafts/{taskRunId}:confirm", "canvasConfirmStoryboardDrafts", contractType[*contractcanvasnode.ConfirmCanvasNodeDraftsRequest](), contractType[*contractcanvasnode.ConfirmCanvasNodeDraftsResponse]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/storyboard-drafts/{taskRunId}:cancel", "canvasCancelStoryboardDrafts", nil, contractType[*contractbase.Empty]()},
	{"POST", "/projects/{projectId}/canvases/{canvasId}/node-states:batchGet", "canvasBatchGetNodeStates", contractType[*contractcanvasnode.BatchGetCanvasNodeStatesRequest](), contractType[*contractcanvasnode.BatchGetCanvasNodeStatesResponse]()},
}

func Spec() map[string]any {
	schemas := map[string]any{}
	paths := map[string]any{}
	for _, route := range operations {
		operation := map[string]any{
			"operationId": route.id,
			"tags":        []string{"canvas"},
			"responses": map[string]any{
				"200": map[string]any{"description": "Success", "content": map[string]any{"application/json": map[string]any{"schema": contractSchema(route.output, schemas)}}},
				"400": map[string]any{"description": "Invalid input"},
				"401": map[string]any{"description": "Authentication required"},
				"403": map[string]any{"description": "Forbidden"},
				"404": map[string]any{"description": "Missing or inaccessible resource"},
				"409": map[string]any{"description": "Revision conflict"},
			},
		}
		parameters := pathParameters(route.path)
		for _, parameter := range queryParameters(route.id) {
			parameters = append(parameters, map[string]any{
				"name": parameter.name, "in": "query", "required": parameter.required,
				"schema": map[string]any{"type": parameter.kind},
			})
		}
		if len(parameters) > 0 {
			operation["parameters"] = parameters
		}
		if route.input != nil {
			operation["requestBody"] = map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": requestContractSchema(route.input, route.path, schemas)}}}
		}
		if paths[route.path] == nil {
			paths[route.path] = map[string]any{}
		}
		paths[route.path].(map[string]any)[strings.ToLower(route.method)] = operation
	}
	addAllContractEnumSchemas(schemas)
	return map[string]any{
		"openapi":    "3.0.3",
		"info":       map[string]any{"title": "Canvas Service", "version": apiVersion},
		"paths":      paths,
		"components": map[string]any{"schemas": schemas},
	}
}

func queryParameters(operationID string) []queryParameterSpec {
	switch operationID {
	case "canvasAdminListProjects":
		return []queryParameterSpec{
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	case "canvasListProjects":
		return []queryParameterSpec{
			{name: "keyword", kind: "string"},
			{name: "sort_direction", kind: "string"},
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	case "canvasListCanvases":
		return []queryParameterSpec{
			{name: "keyword", kind: "string"},
			{name: "created_by_me", kind: "boolean"},
			{name: "sort_direction", kind: "string"},
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	case "canvasListResources":
		return []queryParameterSpec{
			{name: "keyword", kind: "string"},
			{name: "type", kind: "integer"},
			{name: "sort_direction", kind: "string"},
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	case "canvasListResourceAssets":
		return []queryParameterSpec{
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	case "canvasListProjectModels":
		return []queryParameterSpec{
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	case "canvasListArchives":
		return []queryParameterSpec{
			{name: "sort_direction", kind: "string"},
			{name: "page_size", kind: "integer", required: true},
			{name: "page_num", kind: "integer", required: true},
		}
	default:
		return nil
	}
}

func requestContractSchema(value reflect.Type, path string, schemas map[string]any) map[string]any {
	for value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return contractSchema(value, schemas)
	}
	omit := map[string]struct{}{
		"workspace_id": {},
		"project_id":   {},
		"top":          {},
	}
	for _, parameter := range pathParameters(path) {
		name, _ := parameter.(map[string]any)["name"].(string)
		omit[pascalToSnake(snakeToPascal(name))] = struct{}{}
	}
	properties := map[string]any{}
	required := []string{}
	for index := range value.NumField() {
		field := value.Field(index)
		parts := strings.Split(field.Tag.Get("json"), ",")
		if parts[0] == "" || parts[0] == "-" {
			continue
		}
		key := pascalToSnake(parts[0])
		if _, excluded := omit[key]; excluded {
			continue
		}
		properties[key] = contractSchema(field.Type, schemas)
		if !slices.Contains(parts[1:], "omitempty") {
			required = append(required, key)
		}
	}
	schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func contractSchema(value reflect.Type, schemas map[string]any) map[string]any {
	if value == nil {
		return map[string]any{"type": "object"}
	}
	switch value.Kind() {
	case reflect.Pointer:
		return contractSchema(value.Elem(), schemas)
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Float32, reflect.Float64:
		return map[string]any{"type": "number"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if schema, ok := contractEnumSchema(value, schemas); ok {
			return schema
		}
		return map[string]any{"type": "integer"}
	case reflect.Slice, reflect.Array:
		return map[string]any{"type": "array", "items": contractSchema(value.Elem(), schemas)}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": contractSchema(value.Elem(), schemas)}
	case reflect.Interface:
		return map[string]any{}
	case reflect.Struct:
		name := canvasSchemaName(value.Name())
		if _, exists := schemas[name]; !exists {
			schemas[name] = map[string]any{}
			properties := map[string]any{}
			required := []string{}
			for index := range value.NumField() {
				field := value.Field(index)
				parts := strings.Split(field.Tag.Get("json"), ",")
				if parts[0] == "" || parts[0] == "-" {
					continue
				}
				key := pascalToSnake(parts[0])
				properties[key] = contractSchema(field.Type, schemas)
				if !slices.Contains(parts[1:], "omitempty") {
					required = append(required, key)
				}
			}
			schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
			if len(required) > 0 {
				schema["required"] = required
			}
			schemas[name] = schema
		}
		return map[string]any{"$ref": "#/components/schemas/" + name}
	default:
		return map[string]any{}
	}
}

func canvasSchemaName(typeName string) string {
	if strings.HasPrefix(typeName, "Canvas") {
		return typeName
	}
	return "Canvas" + typeName
}

func pathParameters(path string) []any {
	parameters := []any{}
	for _, part := range strings.Split(path, "/") {
		start := strings.IndexByte(part, '{')
		end := strings.IndexByte(part, '}')
		if start < 0 || end <= start {
			continue
		}
		parameters = append(parameters, map[string]any{
			"name": part[start+1 : end], "in": "path", "required": true,
			"schema": map[string]any{"type": "string"},
		})
	}
	return parameters
}
