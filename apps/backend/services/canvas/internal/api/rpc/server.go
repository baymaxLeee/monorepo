package rpcapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"unicode"

	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	maturehttp "github.com/example/monorepo/canvas/internal/api/handler"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	"github.com/example/monorepo/canvas/internal/application/requestcontext"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
	canvasv1 "github.com/example/monorepo/inner-api-go/gen/canvas/v1"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type Server struct {
	canvasv1.UnimplementedCanvasServiceServer
	nodes  *maturehttp.CanvasNodeHandler
	access applicationprojectaccess.Checker
}

func New(nodes *maturehttp.CanvasNodeHandler, access applicationprojectaccess.Checker) *Server {
	return &Server{nodes: nodes, access: access}
}

func Authorizer() innerruntime.Authorizer {
	return innerruntime.AuthorizeFunc(func(caller, method string) bool {
		return caller == "runtime" && strings.HasPrefix(method, "/canvas.v1.CanvasService/")
	})
}

func (server *Server) GetGraph(ctx context.Context, request *canvasv1.GetGraphRequest) (*canvasv1.GetGraphResponse, error) {
	ctx, workspaceID, err := server.authorize(ctx, request.GetActor(), request.GetWorkspaceRole(), request.GetProjectId(), "GetCanvasGraph", applicationprojectaccess.AccessRead)
	if err != nil {
		return nil, err
	}
	value, err := server.nodes.GetCanvasGraph(ctx, &contractcanvasnode.GetCanvasGraphRequest{WorkspaceID: &workspaceID, ProjectID: request.GetProjectId(), CanvasID: request.GetCanvasId()})
	if err != nil {
		return nil, rpcError(err)
	}
	graph := new(canvasv1.CanvasGraph)
	if err = transcode(value, graph); err != nil {
		return nil, err
	}
	return &canvasv1.GetGraphResponse{Graph: graph}, nil
}

func (server *Server) StartStoryboardDrafts(ctx context.Context, request *canvasv1.StartStoryboardDraftsRequest) (*canvasv1.StartStoryboardDraftsResponse, error) {
	ctx, workspaceID, err := server.authorize(ctx, request.GetActor(), request.GetWorkspaceRole(), request.GetProjectId(), "CreateCanvasNodes", applicationprojectaccess.AccessUpdate)
	if err != nil {
		return nil, err
	}
	input := &contractcanvasnode.CreateCanvasNodesRequest{WorkspaceID: &workspaceID, ProjectID: request.GetProjectId(), CanvasID: request.GetCanvasId(), Plot: request.GetPlot(), PlanningConfig: planningConfig(request.GetPlanningConfig()), ModelConfig: modelConfig(request.GetModelConfig())}
	value, err := server.nodes.CreateCanvasNodes(ctx, input)
	if err != nil {
		return nil, rpcError(err)
	}
	response := new(canvasv1.StartStoryboardDraftsResponse)
	if err = transcode(value, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (server *Server) GenerateNodes(ctx context.Context, request *canvasv1.GenerateNodesRequest) (*canvasv1.GenerateNodesResponse, error) {
	ctx, workspaceID, err := server.authorize(ctx, request.GetActor(), request.GetWorkspaceRole(), request.GetProjectId(), "StartCanvasNodeGeneration", applicationprojectaccess.AccessUpdate)
	if err != nil {
		return nil, err
	}
	items := make([]*canvasv1.NodeGeneration, 0, len(request.GetNodeIds()))
	for _, nodeID := range request.GetNodeIds() {
		value, startErr := server.nodes.StartCanvasNodeGeneration(ctx, &contractcanvasnode.StartCanvasNodeGenerationRequest{WorkspaceID: &workspaceID, ProjectID: request.GetProjectId(), CanvasID: request.GetCanvasId(), NodeID: nodeID})
		if startErr != nil {
			return nil, rpcError(startErr)
		}
		items = append(items, &canvasv1.NodeGeneration{NodeId: nodeID, TaskRunId: value.TaskRunID})
	}
	return &canvasv1.GenerateNodesResponse{Items: items}, nil
}

func (server *Server) UpdateNode(ctx context.Context, request *canvasv1.UpdateNodeRequest) (*canvasv1.UpdateNodeResponse, error) {
	ctx, workspaceID, err := server.authorize(ctx, request.GetActor(), request.GetWorkspaceRole(), request.GetProjectId(), "UpdateCanvasNode", applicationprojectaccess.AccessUpdate)
	if err != nil {
		return nil, err
	}
	input := &contractcanvasnode.UpdateCanvasNodeRequest{WorkspaceID: &workspaceID, ProjectID: request.GetProjectId(), CanvasID: request.GetCanvasId(), NodeID: request.GetNodeId(), Name: request.Name, Prompt: request.Prompt, Text: request.Text}
	if request.GetPosition() != nil {
		input.Position = &contractcanvasnode.CanvasNodePosition{PositionX: request.GetPosition().GetPositionX(), PositionY: request.GetPosition().GetPositionY()}
	}
	if request.VideoInputMode != nil {
		value := contractcanvasnode.CanvasVideoInputMode(request.GetVideoInputMode())
		input.VideoInputMode = &value
	}
	if request.GetGenerationConfig() != nil {
		input.GenerationConfig = generationPatch(request.GetGenerationConfig())
	}
	value, err := server.nodes.UpdateCanvasNode(ctx, input)
	if err != nil {
		return nil, rpcError(err)
	}
	response := new(canvasv1.UpdateNodeResponse)
	if err = transcode(value, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (server *Server) authorize(ctx context.Context, actor *commonv1.ActorContext, workspaceRole, projectID, action string, access applicationprojectaccess.Access) (context.Context, string, error) {
	if actor == nil || actor.GetTenantId() == "" || actor.GetWorkspaceId() == "" || actor.GetUserId() == "" || projectID == "" {
		return nil, "", status.Error(codes.InvalidArgument, "actor scope and project_id are required")
	}
	metadata := requestcontext.Metadata{TenantID: actor.GetTenantId(), WorkspaceID: actor.GetWorkspaceId(), UserID: actor.GetUserId(), WorkspaceRole: workspaceRole, Service: "canvas", Action: action, Version: maturehttp.ProjectAPIVersion, IdentityType: "service"}
	ctx = requestcontext.WithMetadata(ctx, metadata)
	workspaceID := actor.GetWorkspaceId()
	if server.access == nil {
		return nil, "", status.Error(codes.Internal, "canvas access authorizer is not configured")
	}
	if err := server.access.Check(ctx, actor.GetTenantId(), &workspaceID, actor.GetUserId(), projectID, access); err != nil {
		return nil, "", status.Error(codes.PermissionDenied, "canvas is missing or inaccessible")
	}
	return ctx, workspaceID, nil
}

func planningConfig(value *canvasv1.StoryboardPlanningConfig) *contractcanvasnode.StoryboardPlanningConfig {
	if value == nil {
		return nil
	}
	return &contractcanvasnode.StoryboardPlanningConfig{CanvasNodeDurationMinSeconds: value.CanvasNodeDurationMinSeconds, CanvasNodeDurationMaxSeconds: value.CanvasNodeDurationMaxSeconds, TotalDurationMinSeconds: value.TotalDurationMinSeconds, TotalDurationMaxSeconds: value.TotalDurationMaxSeconds}
}

func modelConfig(value *canvasv1.StoryboardModelConfig) *contractcanvasnode.StoryboardModelConfig {
	if value == nil {
		return nil
	}
	result := &contractcanvasnode.StoryboardModelConfig{InferenceModelServiceID: value.InferenceModelServiceId, VideoModelServiceID: value.VideoModelServiceId}
	if value.GetVideoParameters() != nil {
		result.VideoParameters = &contractcanvasnode.StoryboardVideoParameters{Resolution: contractcanvasnode.CanvasNodeResolution(value.GetVideoParameters().GetResolution()), AspectRatio: contractcanvasnode.CanvasNodeAspectRatio(value.GetVideoParameters().GetAspectRatio()), GenerateAudio: value.GetVideoParameters().GetGenerateAudio(), Watermark: value.GetVideoParameters().GetWatermark()}
	}
	return result
}

func generationPatch(value *canvasv1.GenerationConfigPatch) *contractcanvasnode.CanvasNodeGenerationConfigPatch {
	result := &contractcanvasnode.CanvasNodeGenerationConfigPatch{ModelServiceID: value.ModelServiceId, DurationSeconds: value.DurationSeconds, GenerateAudio: value.GenerateAudio, Watermark: value.Watermark}
	if value.Resolution != nil {
		converted := contractcanvasnode.CanvasNodeResolution(value.GetResolution())
		result.Resolution = &converted
	}
	if value.AspectRatio != nil {
		converted := contractcanvasnode.CanvasNodeAspectRatio(value.GetAspectRatio())
		result.AspectRatio = &converted
	}
	return result
}

func transcode(value any, output proto.Message) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return status.Error(codes.Internal, "canvas response serialization failed")
	}
	var decoded any
	if err = json.Unmarshal(encoded, &decoded); err != nil {
		return status.Error(codes.Internal, "canvas response serialization failed")
	}
	encoded, err = json.Marshal(renameJSONKeys(decoded, pascalToSnake))
	if err != nil || (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(encoded, output) != nil {
		return status.Error(codes.Internal, "canvas response does not satisfy its RPC contract")
	}
	return nil
}

func rpcError(err error) error {
	if err == nil {
		return nil
	}
	code := codes.Internal
	switch errno.Status(err) {
	case http.StatusBadRequest:
		code = codes.InvalidArgument
	case http.StatusUnauthorized:
		code = codes.Unauthenticated
	case http.StatusForbidden:
		code = codes.PermissionDenied
	case http.StatusNotFound:
		code = codes.NotFound
	case http.StatusConflict:
		code = codes.FailedPrecondition
	case http.StatusTooManyRequests:
		code = codes.ResourceExhausted
	}
	return status.Error(code, errno.MessageOf(err))
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

func pascalToSnake(value string) string {
	value = strings.NewReplacer("IDs", "Ids", "ID", "Id", "URL", "Url", "URI", "Uri", "HTTP", "Http", "API", "Api", "provider", "Provider", "XLSX", "Xlsx").Replace(value)
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
