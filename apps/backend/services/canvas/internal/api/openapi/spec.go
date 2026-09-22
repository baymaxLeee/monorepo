package openapi

import (
	"reflect"
	"slices"
	"strings"

	contractbase "github.com/example/monorepo/canvas/internal/api/contracts/base"
	contractbasicconfig "github.com/example/monorepo/canvas/internal/api/contracts/basicconfig"
	contractcanvas "github.com/example/monorepo/canvas/internal/api/contracts/canvas"
	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	contractproject "github.com/example/monorepo/canvas/internal/api/contracts/project"
	contractresource "github.com/example/monorepo/canvas/internal/api/contracts/resource"
)

type operationSpec struct {
	method string
	path   string
	id     string
	input  reflect.Type
	output reflect.Type
}

func contractType[T any]() reflect.Type { return reflect.TypeFor[T]() }

var operations = []operationSpec{
	{"GET", "/config", "canvasGetRuntimeBasicConfig", nil, contractType[*contractbasicconfig.GetBasicConfigResponse]()},
	{"GET", "/admin/config", "canvasGetBasicConfig", nil, contractType[*contractbasicconfig.GetBasicConfigResponse]()},
	{"PUT", "/admin/config", "canvasUpdateBasicConfig", contractType[*contractbasicconfig.UpdateBasicConfigRequest](), contractType[*contractbasicconfig.UpdateBasicConfigResponse]()},
	{"GET", "/projects", "canvasListProjects", nil, contractType[*contractproject.ListProjectsByMemberResponse]()},
	{"POST", "/projects", "canvasCreateProject", contractType[*contractproject.CreateProjectRequest](), contractType[*contractproject.CreateProjectResponse]()},
	{"GET", "/projects/{projectId}", "canvasGetProject", nil, contractType[*contractproject.GetProjectByMemberResponse]()},
	{"PATCH", "/projects/{projectId}", "canvasUpdateProject", contractType[*contractproject.UpdateProjectByMemberRequest](), contractType[*contractproject.UpdateProjectByMemberResponse]()},
	{"DELETE", "/projects/{projectId}", "canvasDeleteProject", nil, contractType[*contractbase.Empty]()},
	{"GET", "/projects/{projectId}/canvases", "canvasListCanvases", nil, contractType[*contractcanvas.ListProjectCanvasesResponse]()},
	{"POST", "/projects/{projectId}/canvases", "canvasCreateCanvas", contractType[*contractcanvas.CreateProjectCanvasRequest](), contractType[*contractcanvas.CreateProjectCanvasResponse]()},
	{"GET", "/projects/{projectId}/resources", "canvasListResources", nil, contractType[*contractresource.ListResourcesResponse]()},
	{"POST", "/projects/{projectId}/resources", "canvasCreateResource", contractType[*contractresource.CreateResourceRequest](), contractType[*contractresource.CreateResourceResponse]()},
	{"POST", "/projects/{projectId}/resources:fromAsset", "canvasCreateResourceFromAsset", contractType[*contractresource.CreateResourceFromAssetRequest](), contractType[*contractresource.CreateResourceFromAssetResponse]()},
	{"GET", "/projects/{projectId}/resources/{resourceId}", "canvasGetResource", nil, contractType[*contractresource.GetResourceResponse]()},
	{"PATCH", "/projects/{projectId}/resources/{resourceId}", "canvasUpdateResource", contractType[*contractresource.UpdateResourceRequest](), contractType[*contractresource.UpdateResourceResponse]()},
	{"DELETE", "/projects/{projectId}/resources/{resourceId}", "canvasDeleteResource", contractType[*contractresource.DeleteResourceRequest](), contractType[*contractbase.Empty]()},
	{"GET", "/projects/{projectId}/resources/{resourceId}/assets", "canvasListResourceAssets", nil, contractType[*contractresource.ListResourceAssetsResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/assets", "canvasCreateResourceAsset", contractType[*contractresource.CreateResourceAssetRequest](), contractType[*contractresource.CreateResourceAssetResponse]()},
	{"POST", "/projects/{projectId}/resources/{resourceId}/generated-assets", "canvasCreateGeneratedResourceAsset", contractType[*contractresource.CreateGeneratedResourceAssetRequest](), contractType[*contractresource.CreateGeneratedResourceAssetResponse]()},
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
		"canvas_id":    {},
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
