package rpcapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/example/monorepo/admin/internal/application"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type Server struct {
	adminv1.UnimplementedProviderServiceServer
	adminv1.UnimplementedAgentConfigurationServiceServer
	adminv1.UnimplementedBenefitPackageServiceServer
	Providers application.ProviderService
	Bots      application.BotService
	Canvas    application.CanvasSettingsService
	Skills    *application.SkillService
	Benefits  application.BenefitPackageService
}

func Register(server *grpc.Server, providers application.ProviderService, bots application.BotService, canvas application.CanvasSettingsService, skills *application.SkillService, benefits application.BenefitPackageService) {
	adapter := &Server{Providers: providers, Bots: bots, Canvas: canvas, Skills: skills, Benefits: benefits}
	adminv1.RegisterProviderServiceServer(server, adapter)
	adminv1.RegisterAgentConfigurationServiceServer(server, adapter)
	adminv1.RegisterBenefitPackageServiceServer(server, adapter)
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
		return strings.HasPrefix(method, "/admin.v1.ProviderService/") || strings.HasPrefix(method, "/admin.v1.AgentConfigurationService/")
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

func (s *Server) GetResolvedAgent(ctx context.Context, request *adminv1.GetResolvedAgentRequest) (*adminv1.GetResolvedAgentResponse, error) {
	a := actor(request.GetActor())
	if a.WorkspaceID == "" || a.TenantID == "" || a.UserID == "" {
		return nil, status.Error(codes.InvalidArgument, "actor user_id, workspace_id and tenant_id are required")
	}
	bot, err := s.Bots.Get(ctx, a, request.GetAgentId())
	if err != nil {
		return nil, rpcError(err)
	}
	skills, err := s.Bots.Skills(ctx, a, bot.ID, true)
	if err != nil {
		return nil, rpcError(err)
	}
	result := &adminv1.ResolvedAgent{Id: bot.ID, Name: bot.Name, RoleDescription: bot.RoleDescription, DomainDescription: bot.DomainDescription, Audience: bot.Audience, Tone: bot.Tone}
	for _, skill := range skills {
		result.Skills = append(result.Skills, &adminv1.AgentSkill{Id: skill.ID, Name: skill.Name, Description: skill.Description})
	}
	resolve := func(id *string) *adminv1.ModelProvider {
		if id == nil {
			return nil
		}
		value, lookupErr := s.Providers.GetInternal(ctx, *id, a.WorkspaceID, a.TenantID, false)
		if lookupErr != nil {
			return nil
		}
		return provider(value)
	}
	result.TextProvider = resolve(bot.TextProviderID)
	result.ImageProvider = resolve(bot.ImageProviderID)
	result.VideoProvider = resolve(bot.VideoProviderID)
	return &adminv1.GetResolvedAgentResponse{Agent: result}, nil
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
