package rpcapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Server struct {
	adminv1.UnimplementedProviderServiceServer
	adminv1.UnimplementedConfigurationServiceServer
	adminv1.UnimplementedBenefitPackageServiceServer
	adminv1.UnimplementedAgentPluginServiceServer
	Providers application.ProviderService
	Canvas    application.CanvasSettingsService
	Skills    *application.SkillService
	Benefits  application.BenefitPackageService
	Plugins   application.AgentPluginService
}

func Register(server *grpc.Server, providers application.ProviderService, canvas application.CanvasSettingsService, skills *application.SkillService, benefits application.BenefitPackageService, plugins application.AgentPluginService) {
	adapter := &Server{Providers: providers, Canvas: canvas, Skills: skills, Benefits: benefits, Plugins: plugins}
	adminv1.RegisterProviderServiceServer(server, adapter)
	adminv1.RegisterConfigurationServiceServer(server, adapter)
	adminv1.RegisterBenefitPackageServiceServer(server, adapter)
	adminv1.RegisterAgentPluginServiceServer(server, adapter)
}

func Authorizer() innerruntime.Authorizer {
	return innerruntime.AuthorizeFunc(func(caller, method string) bool {
		allowed := map[string]bool{"canvas": true, "runtime": true, "knowledge": true}
		if !allowed[caller] {
			return false
		}
		if strings.HasSuffix(method, "/GetTaskProvider") {
			return caller == "canvas" || caller == "runtime"
		}
		if strings.HasPrefix(method, "/admin.v1.BenefitPackageService/") {
			return caller == "canvas"
		}
		if strings.HasPrefix(method, "/admin.v1.AgentPluginService/") {
			return caller == "runtime"
		}
		return strings.HasPrefix(method, "/admin.v1.ProviderService/") || strings.HasPrefix(method, "/admin.v1.ConfigurationService/")
	})
}

func actor(value *commonv1.ActorContext) application.Actor {
	if value == nil {
		return application.Actor{}
	}
	return application.Actor{UserID: value.GetUserId(), TenantID: value.GetTenantId(), WorkspaceID: value.GetWorkspaceId()}
}

func scope(value *commonv1.ActorContext) (workspaceID, tenantID string, err error) {
	a := actor(value)
	if a.WorkspaceID == "" || a.TenantID == "" {
		return "", "", status.Error(codes.InvalidArgument, "actor workspace_id and tenant_id are required")
	}
	return a.WorkspaceID, a.TenantID, nil
}

func (s *Server) GetProvider(ctx context.Context, request *adminv1.GetProviderRequest) (*adminv1.GetProviderResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Providers.GetInternal(ctx, request.GetProviderId(), workspaceID, tenantID, false)
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.GetProviderResponse{Provider: provider(value)}, nil
}

func (s *Server) GetTaskProvider(ctx context.Context, request *adminv1.GetTaskProviderRequest) (*adminv1.GetTaskProviderResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Providers.GetInternal(ctx, request.GetProviderId(), workspaceID, tenantID, true)
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.GetTaskProviderResponse{Provider: provider(value)}, nil
}

func (s *Server) GetDefaultProvider(ctx context.Context, request *adminv1.GetDefaultProviderRequest) (*adminv1.GetDefaultProviderResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Providers.Default(ctx, workspaceID, tenantID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.GetDefaultProviderResponse{Provider: provider(value)}, nil
}

func (s *Server) GetProviderByKind(ctx context.Context, request *adminv1.GetProviderByKindRequest) (*adminv1.GetProviderByKindResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Providers.ByKind(ctx, workspaceID, tenantID, providerKindName(request.GetKind()))
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.GetProviderByKindResponse{Provider: provider(value)}, nil
}

func (s *Server) ListProviderCatalog(ctx context.Context, request *adminv1.ListProviderCatalogRequest) (*adminv1.ListProviderCatalogResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	values, err := s.Providers.Catalog(ctx, workspaceID, tenantID)
	if err != nil {
		return nil, rpcError(err)
	}
	result := make([]*adminv1.ProviderCatalogItem, 0, len(values))
	for _, value := range values {
		pricing := pricingFromJSON(value.PricingJSON)
		result = append(result, &adminv1.ProviderCatalogItem{Id: value.ID, Name: value.Name, Model: value.Model, ProviderKind: providerKind(value.Kind), Pricing: pricing, IsDefault: value.IsDefault, IsEnabled: value.IsEnabled})
	}
	return &adminv1.ListProviderCatalogResponse{Providers: result}, nil
}

func (s *Server) ListAgentPlugins(ctx context.Context, request *adminv1.ListAgentPluginsRequest) (*adminv1.ListAgentPluginsResponse, error) {
	values, err := s.Plugins.List(ctx, actor(request.GetActor()))
	if err != nil {
		return nil, rpcError(err)
	}
	result := make([]*adminv1.AgentPluginCatalogItem, 0, len(values))
	for _, value := range values {
		manifest, err := agentPluginManifest(value.Manifest)
		if err != nil {
			return nil, status.Error(codes.Internal, "stored agent plugin release is invalid")
		}
		result = append(result, &adminv1.AgentPluginCatalogItem{
			PluginId: value.Catalog.ID, DisplayName: value.Catalog.DisplayName, Description: value.Catalog.Description,
			Source: string(value.Catalog.Source), Trust: string(value.Catalog.Trust), InstallPolicy: string(value.Catalog.InstallPolicy),
			Availability: value.Catalog.Availability, Installed: value.Installed, Enabled: value.Enabled,
			StateRevision: value.StateRevision, LatestRelease: manifest,
		})
	}
	return &adminv1.ListAgentPluginsResponse{Plugins: result}, nil
}

func (s *Server) ResolveAgentPlugins(ctx context.Context, request *adminv1.ResolveAgentPluginsRequest) (*adminv1.ResolveAgentPluginsResponse, error) {
	activations := make([]domain.AgentPluginActivation, 0, len(request.GetActivations()))
	for _, value := range request.GetActivations() {
		activations = append(activations, domain.AgentPluginActivation{PluginID: value.GetPluginId(), Bindings: value.GetBindings()})
	}
	requestActor := actor(request.GetActor())
	requestActor.WorkspaceRole = request.GetWorkspaceRole()
	value, err := s.Plugins.Resolve(ctx, requestActor, activations)
	if err != nil {
		return nil, rpcError(err)
	}
	plugins := make([]*adminv1.ResolvedAgentPlugin, 0, len(value.Plugins))
	for _, resolved := range value.Plugins {
		manifest, err := agentPluginManifest(resolved.Manifest)
		if err != nil {
			return nil, status.Error(codes.Internal, "stored agent plugin release is invalid")
		}
		plugins = append(plugins, &adminv1.ResolvedAgentPlugin{
			Manifest:   manifest,
			Activation: &adminv1.AgentPluginActivation{PluginId: resolved.Activation.PluginID, Bindings: resolved.Activation.Bindings},
		})
	}
	grants := make([]*adminv1.AgentPluginConnectionGrant, 0, len(value.ConnectionGrants))
	for _, grant := range value.ConnectionGrants {
		item := &adminv1.AgentPluginConnectionGrant{PluginId: grant.PluginID, ServerName: grant.ServerName, Headers: grant.Headers}
		if grant.ExpiresAt != nil {
			item.ExpiresAt = timestamppb.New(*grant.ExpiresAt)
		}
		grants = append(grants, item)
	}
	return &adminv1.ResolveAgentPluginsResponse{Snapshot: &adminv1.ResolvedAgentPluginSnapshot{
		SchemaVersion: int32(value.SchemaVersion), SnapshotId: value.SnapshotID, SnapshotDigest: value.SnapshotDigest,
		WorkspaceRevision: value.WorkspaceRevision, TenantId: value.TenantID, WorkspaceId: value.WorkspaceID,
		ResolvedAt: timestamppb.New(value.ResolvedAt), Plugins: plugins, ConnectionGrants: grants,
	}}, nil
}

func agentPluginManifest(value domain.AgentPluginManifest) (*adminv1.AgentPluginManifest, error) {
	servers := make([]*adminv1.AgentPluginMCPServer, 0, len(value.MCPServers))
	for _, server := range value.MCPServers {
		tools := make([]*adminv1.AgentPluginMCPTool, 0, len(server.Tools))
		for _, tool := range server.Tools {
			input, err := rawStruct(tool.InputSchema)
			if err != nil {
				return nil, fmt.Errorf("decode %s/%s input schema: %w", value.ID, tool.Name, err)
			}
			var output *structpb.Struct
			if len(tool.OutputSchema) > 0 {
				output, err = rawStruct(tool.OutputSchema)
				if err != nil {
					return nil, fmt.Errorf("decode %s/%s output schema: %w", value.ID, tool.Name, err)
				}
			}
			var sourceProjection *structpb.Struct
			if tool.Policy.SourceProjection != nil {
				sourceProjection, err = structpb.NewStruct(tool.Policy.SourceProjection)
				if err != nil {
					return nil, fmt.Errorf("decode %s/%s source projection: %w", value.ID, tool.Name, err)
				}
			}
			policy := &adminv1.AgentPluginToolPolicy{
				Capability: tool.Policy.Capability, CallableByCodeMode: tool.Policy.CallableByCodeMode,
				Effect: tool.Policy.Effect, Trust: tool.Policy.Trust, Execution: tool.Policy.Execution,
				SourceProjection: sourceProjection, Streaming: tool.Policy.Streaming,
			}
			if tool.Policy.UIKind != "" {
				policy.UiKind = &tool.Policy.UIKind
			}
			tools = append(tools, &adminv1.AgentPluginMCPTool{
				Name: tool.Name, Description: tool.Description, InputSchema: input, OutputSchema: output,
				Policy: policy,
				Planning: &adminv1.AgentPluginToolPlanning{
					Summary: tool.Planning.Summary, Constraints: tool.Planning.Constraints,
					Prerequisites: tool.Planning.Prerequisites, Parallelizable: tool.Planning.Parallelizable,
				},
			})
		}
		servers = append(servers, &adminv1.AgentPluginMCPServer{
			Name: server.Name, Url: server.URL, RequiredBindings: server.RequiredBindings,
			OptionalBindings: server.OptionalBindings, Tools: tools,
		})
	}
	skills := make([]*adminv1.AgentPluginSkillContribution, 0, len(value.Skills))
	for _, skill := range value.Skills {
		skills = append(skills, &adminv1.AgentPluginSkillContribution{
			Id: skill.ID, Name: skill.Name, Description: skill.Description,
			AssetId: skill.AssetID, RevisionId: skill.RevisionID, Sha256: skill.SHA256,
		})
	}
	return &adminv1.AgentPluginManifest{
		SchemaVersion: int32(value.SchemaVersion), PluginId: value.ID, Version: value.Version,
		Digest: value.Digest, DisplayName: value.DisplayName, Description: value.Description,
		Source: string(value.Source), Trust: string(value.Trust), McpServers: servers, Skills: skills,
	}, nil
}

func rawStruct(raw json.RawMessage) (*structpb.Struct, error) {
	var value map[string]interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return structpb.NewStruct(value)
}

func (s *Server) ListSkills(ctx context.Context, request *adminv1.ListSkillsRequest) (*adminv1.ListSkillsResponse, error) {
	if s.Skills == nil {
		return nil, status.Error(codes.Unavailable, "skill service is not configured")
	}
	a := actor(request.GetActor())
	if a.WorkspaceID == "" || a.TenantID == "" {
		return nil, status.Error(codes.InvalidArgument, "actor workspace_id and tenant_id are required")
	}
	values, err := s.Skills.List(ctx, a)
	if err != nil {
		return nil, rpcError(err)
	}
	result := make([]*adminv1.SkillSummary, 0, len(values))
	for _, value := range values {
		if !value.IsEnabled || value.Status != "published" {
			continue
		}
		result = append(result, &adminv1.SkillSummary{Id: value.ID, Name: value.Name, Description: value.Description})
	}
	return &adminv1.ListSkillsResponse{Skills: result}, nil
}

func (s *Server) GetSkill(ctx context.Context, request *adminv1.GetSkillRequest) (*adminv1.GetSkillResponse, error) {
	if s.Skills == nil {
		return nil, status.Error(codes.Unavailable, "skill service is not configured")
	}
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Skills.Internal(ctx, request.GetSkillId(), workspaceID, tenantID)
	if err != nil {
		return nil, rpcError(err)
	}
	return &adminv1.GetSkillResponse{Skill: &adminv1.Skill{Id: value.ID, Name: value.Name, Description: value.Description, Body: value.Body, Files: value.Files}}, nil
}

func (s *Server) GetSkillFile(ctx context.Context, request *adminv1.GetSkillFileRequest) (*adminv1.GetSkillFileResponse, error) {
	if s.Skills == nil {
		return nil, status.Error(codes.Unavailable, "skill service is not configured")
	}
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Skills.InternalFile(ctx, request.GetSkillId(), workspaceID, tenantID, request.GetPath())
	if err != nil {
		return nil, rpcError(err)
	}
	node := value.Node
	return &adminv1.GetSkillFileResponse{File: &adminv1.SkillFile{Path: value.Path, StorageKind: node.StorageKind, MimeType: node.MimeType, Content: node.Content, AssetId: node.AssetID, RevisionId: node.RevisionID, SizeBytes: node.SizeBytes, Sha256: node.SHA256, Url: value.URL}}, nil
}

func (s *Server) GetCanvasSettings(ctx context.Context, request *adminv1.GetCanvasSettingsRequest) (*adminv1.GetCanvasSettingsResponse, error) {
	workspaceID, tenantID, err := scope(request.GetActor())
	if err != nil {
		return nil, err
	}
	value, err := s.Canvas.Get(ctx, workspaceID, tenantID)
	if err != nil {
		return nil, rpcError(err)
	}
	var raw struct {
		Inference *selection `json:"inference"`
		Image     *selection `json:"image"`
		Video     *selection `json:"video"`
	}
	if err = json.Unmarshal(value.Defaults, &raw); err != nil {
		return nil, status.Error(codes.Internal, "stored canvas settings are invalid")
	}
	return &adminv1.GetCanvasSettingsResponse{Settings: &adminv1.CanvasSettings{Revision: int64(value.Revision), Defaults: &adminv1.CanvasDefaults{Inference: raw.Inference.proto(), Image: raw.Image.proto(), Video: raw.Video.proto()}}}, nil
}

type selection struct {
	ProviderID string         `json:"provider_id"`
	Parameters map[string]any `json:"parameters"`
}

func (value *selection) proto() *adminv1.CanvasModelSelection {
	if value == nil {
		return nil
	}
	parameters, _ := structpb.NewStruct(value.Parameters)
	return &adminv1.CanvasModelSelection{ProviderId: value.ProviderID, Parameters: parameters}
}

func provider(value application.ProviderInternal) *adminv1.ModelProvider {
	p := value.Provider
	extra, _ := structpb.NewStruct(value.ExtraBody)
	result := &adminv1.ModelProvider{Id: p.ID, UserId: p.UserID, Name: p.Name, Model: p.Model, ProviderKind: providerKind(p.Kind), BaseUrl: p.BaseURL, ApiKey: value.APIKey, ExtraBody: extra, Pricing: pricing(value.Pricing), ContextWindow: int32(p.ContextWindow), MaxOutputTokens: int32(p.MaxOutputTokens), SupportsImageInput: p.SupportsImageInput, IsDefault: p.IsDefault, IsEnabled: p.IsEnabled}
	if p.Kind == "chat" {
		dialect := adminv1.ResponsesDialect_RESPONSES_DIALECT_ARK
		result.ResponsesDialect = &dialect
	}
	return result
}

func providerKind(value string) adminv1.ProviderKind {
	switch value {
	case "chat":
		return adminv1.ProviderKind_PROVIDER_KIND_CHAT
	case "image":
		return adminv1.ProviderKind_PROVIDER_KIND_IMAGE
	case "video":
		return adminv1.ProviderKind_PROVIDER_KIND_VIDEO
	case "embedding":
		return adminv1.ProviderKind_PROVIDER_KIND_EMBEDDING
	case "rerank":
		return adminv1.ProviderKind_PROVIDER_KIND_RERANK
	default:
		return adminv1.ProviderKind_PROVIDER_KIND_UNSPECIFIED
	}
}

func providerKindName(value adminv1.ProviderKind) string {
	switch value {
	case adminv1.ProviderKind_PROVIDER_KIND_CHAT:
		return "chat"
	case adminv1.ProviderKind_PROVIDER_KIND_IMAGE:
		return "image"
	case adminv1.ProviderKind_PROVIDER_KIND_VIDEO:
		return "video"
	case adminv1.ProviderKind_PROVIDER_KIND_EMBEDDING:
		return "embedding"
	case adminv1.ProviderKind_PROVIDER_KIND_RERANK:
		return "rerank"
	default:
		return ""
	}
}

func pricing(value map[string]any) *adminv1.ProviderPricing {
	if value == nil {
		return nil
	}
	currency, _ := value["currency"].(string)
	unit, _ := value["unit"].(string)
	price, _ := value["unit_price_micros"].(float64)
	result := &adminv1.ProviderPricing{Currency: currency, UnitPriceMicros: int64(price)}
	if unit == "generated_item" {
		result.Unit = adminv1.PricingUnit_PRICING_UNIT_GENERATED_ITEM
	}
	if unit == "generated_second" {
		result.Unit = adminv1.PricingUnit_PRICING_UNIT_GENERATED_SECOND
	}
	return result
}

func pricingFromJSON(raw *string) *adminv1.ProviderPricing {
	if raw == nil {
		return nil
	}
	value := map[string]any{}
	if json.Unmarshal([]byte(*raw), &value) != nil {
		return nil
	}
	return pricing(value)
}

func rpcError(err error) error {
	var appError *application.Error
	if !errors.As(err, &appError) {
		return status.Error(codes.Internal, "internal server error")
	}
	code := codes.Internal
	switch appError.Status {
	case 400:
		code = codes.InvalidArgument
	case 401:
		code = codes.Unauthenticated
	case 403:
		code = codes.PermissionDenied
	case 404:
		code = codes.NotFound
	case 409:
		code = codes.FailedPrecondition
	case 429:
		code = codes.ResourceExhausted
	}
	return status.Error(code, appError.Message)
}
