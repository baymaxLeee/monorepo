package admin

import (
	"context"
	"errors"
	"fmt"

	"github.com/example/monorepo/chat/internal/application"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type CapabilityResolver struct {
	providers adminv1.ProviderServiceClient
	settings  adminv1.ConfigurationServiceClient
	plugins   adminv1.AgentPluginServiceClient
}

func NewCapabilityResolver(connection grpc.ClientConnInterface) *CapabilityResolver {
	return &CapabilityResolver{
		providers: adminv1.NewProviderServiceClient(connection),
		settings:  adminv1.NewConfigurationServiceClient(connection),
		plugins:   adminv1.NewAgentPluginServiceClient(connection),
	}
}

func (resolver *CapabilityResolver) ResolveTurn(
	ctx context.Context,
	scope application.AuthContext,
	providerID *string,
	selections []application.ConversationPluginSelection,
) (application.TurnCapabilities, error) {
	provider, err := resolver.ResolveProvider(ctx, scope, providerID)
	if err != nil {
		return application.TurnCapabilities{}, err
	}
	plugins, err := resolver.ResolvePlugins(ctx, scope, selections)
	if err != nil {
		return application.TurnCapabilities{}, err
	}
	skills, err := resolver.resolveSkills(ctx, scope)
	if err != nil {
		return application.TurnCapabilities{}, err
	}
	media, err := resolver.resolveMedia(ctx, scope)
	if err != nil {
		return application.TurnCapabilities{}, err
	}
	return application.TurnCapabilities{
		Provider: provider, Media: media, Plugins: plugins, Skills: skills, Memories: []application.UserMemory{},
	}, nil
}

func actor(scope application.AuthContext) *commonv1.ActorContext {
	return &commonv1.ActorContext{UserId: scope.UserID, TenantId: scope.TenantID, WorkspaceId: scope.WorkspaceID}
}

func (resolver *CapabilityResolver) ResolveProvider(
	ctx context.Context,
	scope application.AuthContext,
	providerID *string,
) (application.RuntimeProviderCapability, error) {
	var provider *adminv1.ModelProvider
	if providerID != nil && *providerID != "" {
		response, err := resolver.providers.GetProvider(ctx, &adminv1.GetProviderRequest{Actor: actor(scope), ProviderId: *providerID})
		if err != nil {
			return application.RuntimeProviderCapability{}, adminRPCError("resolve Runtime provider", err)
		}
		provider = response.GetProvider()
	} else {
		response, err := resolver.providers.GetDefaultProvider(ctx, &adminv1.GetDefaultProviderRequest{Actor: actor(scope)})
		if err != nil {
			return application.RuntimeProviderCapability{}, adminRPCError("resolve default Runtime provider", err)
		}
		provider = response.GetProvider()
	}
	if provider == nil {
		return application.RuntimeProviderCapability{}, errors.New("admin returned no Runtime provider")
	}
	if provider.GetProviderKind() != adminv1.ProviderKind_PROVIDER_KIND_CHAT || !provider.GetIsEnabled() {
		return application.RuntimeProviderCapability{}, errors.New("selected Runtime provider is not an enabled chat provider")
	}
	extraBody := map[string]any{}
	if provider.GetExtraBody() != nil {
		extraBody = provider.GetExtraBody().AsMap()
	}
	return application.RuntimeProviderCapability{
		ID: provider.GetId(), Name: provider.GetName(), Model: provider.GetModel(), BaseURL: provider.GetBaseUrl(),
		APIKey: provider.GetApiKey(), ExtraBody: extraBody, ContextWindow: int(provider.GetContextWindow()),
		MaxOutputTokens: int(provider.GetMaxOutputTokens()), SupportsImageInput: provider.GetSupportsImageInput(),
		ProviderKind: "chat",
	}, nil
}

func (resolver *CapabilityResolver) resolveMedia(
	ctx context.Context,
	scope application.AuthContext,
) (application.RuntimeMediaCapabilities, error) {
	listed, err := resolver.providers.ListProviderCatalog(ctx, &adminv1.ListProviderCatalogRequest{Actor: actor(scope)})
	if err != nil {
		return application.RuntimeMediaCapabilities{}, adminRPCError("list Runtime media providers", err)
	}
	providers := make([]application.RuntimeMediaProviderCapability, 0, len(listed.GetProviders()))
	for _, summary := range listed.GetProviders() {
		kind := summary.GetProviderKind()
		if !summary.GetIsEnabled() || (kind != adminv1.ProviderKind_PROVIDER_KIND_IMAGE && kind != adminv1.ProviderKind_PROVIDER_KIND_VIDEO) {
			continue
		}
		response, resolveErr := resolver.providers.GetTaskProvider(ctx, &adminv1.GetTaskProviderRequest{
			Actor: actor(scope), ProviderId: summary.GetId(),
		})
		if resolveErr != nil {
			return application.RuntimeMediaCapabilities{}, adminRPCError("resolve Runtime media provider", resolveErr)
		}
		provider := response.GetProvider()
		if provider == nil || !provider.GetIsEnabled() || provider.GetProviderKind() != kind {
			return application.RuntimeMediaCapabilities{}, fmt.Errorf("admin returned an invalid Runtime media provider %s", summary.GetId())
		}
		extraBody := map[string]any{}
		if provider.GetExtraBody() != nil {
			extraBody = provider.GetExtraBody().AsMap()
		}
		var pricing *application.RuntimeProviderPricing
		if value := provider.GetPricing(); value != nil {
			unit := "generated_item"
			if value.GetUnit() == adminv1.PricingUnit_PRICING_UNIT_GENERATED_SECOND {
				unit = "generated_second"
			}
			pricing = &application.RuntimeProviderPricing{
				Currency: value.GetCurrency(), Unit: unit, UnitPriceMicros: value.GetUnitPriceMicros(),
			}
		}
		providerKind := "image"
		if kind == adminv1.ProviderKind_PROVIDER_KIND_VIDEO {
			providerKind = "video"
		}
		providers = append(providers, application.RuntimeMediaProviderCapability{
			ID: provider.GetId(), Name: provider.GetName(), Model: provider.GetModel(), BaseURL: provider.GetBaseUrl(),
			APIKey: provider.GetApiKey(), ExtraBody: extraBody, ContextWindow: int(provider.GetContextWindow()),
			MaxOutputTokens: int(provider.GetMaxOutputTokens()), Pricing: pricing, ProviderKind: providerKind,
			IsDefault: provider.GetIsDefault(),
		})
	}
	return application.RuntimeMediaCapabilities{Providers: providers}, nil
}

func (resolver *CapabilityResolver) resolveSkills(ctx context.Context, scope application.AuthContext) ([]map[string]any, error) {
	listed, err := resolver.settings.ListSkills(ctx, &adminv1.ListSkillsRequest{Actor: actor(scope)})
	if err != nil {
		return nil, adminRPCError("list Runtime skills", err)
	}
	result := make([]map[string]any, 0, len(listed.GetSkills()))
	for _, summary := range listed.GetSkills() {
		response, err := resolver.settings.GetSkill(ctx, &adminv1.GetSkillRequest{Actor: actor(scope), SkillId: summary.GetId()})
		if err != nil {
			return nil, adminRPCError("resolve Runtime skill", err)
		}
		skill := response.GetSkill()
		if skill == nil {
			return nil, fmt.Errorf("admin returned no Runtime skill %s", summary.GetId())
		}
		files := make(map[string]any, len(skill.GetFiles()))
		for _, path := range skill.GetFiles() {
			fileResponse, err := resolver.settings.GetSkillFile(ctx, &adminv1.GetSkillFileRequest{
				Actor: actor(scope), SkillId: skill.GetId(), Path: path,
			})
			if err != nil {
				return nil, adminRPCError("resolve Runtime skill file", err)
			}
			file := fileResponse.GetFile()
			if file == nil {
				return nil, fmt.Errorf("admin returned no Runtime skill %s file %s", skill.GetId(), path)
			}
			resource, err := skillFileCapability(file)
			if err != nil {
				return nil, fmt.Errorf("resolve Runtime skill %s file %s: %w", skill.GetId(), path, err)
			}
			files[path] = resource
		}
		result = append(result, map[string]any{
			"id": skill.GetId(), "name": skill.GetName(), "description": skill.GetDescription(),
			"body": skill.GetBody(), "files": files,
		})
	}
	return result, nil
}

func skillFileCapability(file *adminv1.SkillFile) (map[string]any, error) {
	mimeType := any(nil)
	if file.MimeType != nil {
		mimeType = file.GetMimeType()
	}
	switch file.GetStorageKind() {
	case "inline":
		if file.Content == nil {
			return nil, errors.New("inline skill file has no content")
		}
		return map[string]any{"storageKind": "inline", "mimeType": mimeType, "content": file.GetContent()}, nil
	case "asset":
		if file.AssetId == nil || file.RevisionId == nil || file.SizeBytes == nil || file.Sha256 == nil || file.Url == nil {
			return nil, errors.New("asset skill file has incomplete immutable revision metadata")
		}
		return map[string]any{
			"storageKind": "asset", "mimeType": mimeType, "assetId": file.GetAssetId(),
			"revisionId": file.GetRevisionId(), "sizeBytes": file.GetSizeBytes(), "sha256": file.GetSha256(),
			"url": file.GetUrl(),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported skill file storage kind %q", file.GetStorageKind())
	}
}

func (resolver *CapabilityResolver) ResolvePlugins(
	ctx context.Context,
	scope application.AuthContext,
	selections []application.ConversationPluginSelection,
) (map[string]any, error) {
	activations := make([]*adminv1.AgentPluginActivation, 0, len(selections))
	for _, selection := range selections {
		activations = append(activations, &adminv1.AgentPluginActivation{PluginId: selection.PluginID, Bindings: selection.Bindings})
	}
	response, err := resolver.plugins.ResolveAgentPlugins(ctx, &adminv1.ResolveAgentPluginsRequest{
		Actor: actor(scope), WorkspaceRole: scope.WorkspaceRole, Activations: activations,
	})
	if err != nil {
		return nil, adminRPCError("resolve Runtime plugins", err)
	}
	snapshot := response.GetSnapshot()
	if snapshot == nil || snapshot.GetTenantId() != scope.TenantID || snapshot.GetWorkspaceId() != scope.WorkspaceID {
		return nil, errors.New("admin returned a Runtime plugin snapshot for another business scope")
	}
	plugins := make([]any, 0, len(snapshot.GetPlugins()))
	for _, plugin := range snapshot.GetPlugins() {
		manifest, err := pluginManifestCapability(plugin.GetManifest())
		if err != nil {
			return nil, err
		}
		activation := plugin.GetActivation()
		if activation == nil {
			return nil, errors.New("admin returned a Runtime plugin without activation")
		}
		activationValue := map[string]any{"pluginId": activation.GetPluginId()}
		if len(activation.GetBindings()) > 0 {
			activationValue["bindings"] = activation.GetBindings()
		}
		plugins = append(plugins, map[string]any{"manifest": manifest, "activation": activationValue})
	}
	grants := make([]any, 0, len(snapshot.GetConnectionGrants()))
	for _, grant := range snapshot.GetConnectionGrants() {
		value := map[string]any{
			"pluginId": grant.GetPluginId(), "serverName": grant.GetServerName(), "headers": grant.GetHeaders(),
		}
		if grant.GetExpiresAt() != nil {
			value["expiresAt"] = grant.GetExpiresAt().AsTime().Format("2006-01-02T15:04:05.999999999Z07:00")
		}
		grants = append(grants, value)
	}
	return map[string]any{
		"schemaVersion": int(snapshot.GetSchemaVersion()), "snapshotId": snapshot.GetSnapshotId(),
		"snapshotDigest": snapshot.GetSnapshotDigest(), "plugins": plugins, "connectionGrants": grants,
	}, nil
}

func adminRPCError(operation string, err error) error {
	if innerruntime.IsWorkloadIdentityError(err) {
		return &application.Error{
			Status:  502,
			Code:    "internal_auth_failed",
			Message: "internal capability service authentication failed",
		}
	}
	switch status.Code(err) {
	case codes.Unauthenticated:
		return &application.Error{
			Status:  401,
			Code:    "capability_unauthorized",
			Message: "capability request is not authenticated",
		}
	case codes.PermissionDenied:
		return &application.Error{
			Status:  403,
			Code:    "capability_forbidden",
			Message: "capability request is not allowed",
		}
	case codes.Unavailable, codes.DeadlineExceeded:
		return &application.Error{
			Status:  503,
			Code:    "capability_service_unavailable",
			Message: "internal capability service is unavailable",
		}
	default:
		return fmt.Errorf("%s: %w", operation, err)
	}
}

func pluginManifestCapability(manifest *adminv1.AgentPluginManifest) (map[string]any, error) {
	if manifest == nil {
		return nil, errors.New("admin returned a Runtime plugin without manifest")
	}
	servers := make([]any, 0, len(manifest.GetMcpServers()))
	for _, server := range manifest.GetMcpServers() {
		tools := make([]any, 0, len(server.GetTools()))
		for _, tool := range server.GetTools() {
			policy, planning := tool.GetPolicy(), tool.GetPlanning()
			if tool.GetInputSchema() == nil || policy == nil || planning == nil {
				return nil, fmt.Errorf("admin returned incomplete Runtime plugin tool %s", tool.GetName())
			}
			policyValue := map[string]any{
				"capability": policy.GetCapability(), "callableByCodeMode": policy.GetCallableByCodeMode(),
				"effect": policy.GetEffect(), "trust": policy.GetTrust(), "execution": policy.GetExecution(),
				"streaming": policy.GetStreaming(),
			}
			if policy.GetSourceProjection() != nil {
				policyValue["sourceProjection"] = policy.GetSourceProjection().AsMap()
			}
			if policy.UiKind != nil {
				policyValue["uiKind"] = policy.GetUiKind()
			}
			toolValue := map[string]any{
				"name": tool.GetName(), "description": tool.GetDescription(), "inputSchema": tool.GetInputSchema().AsMap(),
				"policy": policyValue,
				"planning": map[string]any{
					"summary": planning.GetSummary(), "constraints": planning.GetConstraints(),
					"prerequisites": planning.GetPrerequisites(), "parallelizable": planning.GetParallelizable(),
				},
			}
			if tool.GetOutputSchema() != nil {
				toolValue["outputSchema"] = tool.GetOutputSchema().AsMap()
			}
			tools = append(tools, toolValue)
		}
		servers = append(servers, map[string]any{
			"name": server.GetName(), "url": server.GetUrl(), "requiredBindings": server.GetRequiredBindings(),
			"optionalBindings": server.GetOptionalBindings(), "tools": tools,
		})
	}
	skills := make([]any, 0, len(manifest.GetSkills()))
	for _, skill := range manifest.GetSkills() {
		skills = append(skills, map[string]any{
			"id": skill.GetId(), "name": skill.GetName(), "description": skill.GetDescription(),
			"assetId": skill.GetAssetId(), "revisionId": skill.GetRevisionId(), "sha256": skill.GetSha256(),
		})
	}
	return map[string]any{
		"schemaVersion": int(manifest.GetSchemaVersion()), "id": manifest.GetPluginId(), "version": manifest.GetVersion(),
		"digest": manifest.GetDigest(), "displayName": manifest.GetDisplayName(), "description": manifest.GetDescription(),
		"source": manifest.GetSource(), "trust": manifest.GetTrust(), "mcpServers": servers, "skills": skills,
	}, nil
}
