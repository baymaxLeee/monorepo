package admin

import (
	"context"
	"errors"
	"time"

	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	commonv1 "github.com/example/monorepo/inner-api-go/gen/common/v1"
	"google.golang.org/grpc"
)

type Provider struct {
	ID                 string         `json:"id"`
	Name               string         `json:"name"`
	Model              string         `json:"model"`
	ProviderKind       string         `json:"provider_kind"`
	BaseURL            string         `json:"base_url"`
	APIKey             string         `json:"api_key"`
	ExtraBody          map[string]any `json:"extra_body"`
	Pricing            *Pricing       `json:"pricing"`
	ContextWindow      int64          `json:"context_window"`
	MaxOutputTokens    int64          `json:"max_output_tokens"`
	SupportsImageInput bool           `json:"supports_image_input"`
	IsDefault          bool           `json:"is_default"`
	IsEnabled          bool           `json:"is_enabled"`
}

type Pricing struct {
	Currency        string `json:"currency"`
	Unit            string `json:"unit"`
	UnitPriceMicros int64  `json:"unit_price_micros"`
}

type Directory struct {
	providers adminv1.ProviderServiceClient
	settings  adminv1.ConfigurationServiceClient
	benefits  adminv1.BenefitPackageServiceClient
}

func New(connection grpc.ClientConnInterface) *Directory {
	return &Directory{
		providers: adminv1.NewProviderServiceClient(connection),
		settings:  adminv1.NewConfigurationServiceClient(connection),
		benefits:  adminv1.NewBenefitPackageServiceClient(connection),
	}
}

func (d *Directory) Get(ctx context.Context, tenantID, workspaceID, providerID string) (Provider, error) {
	return d.get(ctx, tenantID, workspaceID, providerID, false)
}

func (d *Directory) GetTaskCredentials(ctx context.Context, tenantID, workspaceID, providerID string) (Provider, error) {
	return d.get(ctx, tenantID, workspaceID, providerID, true)
}

func (d *Directory) get(ctx context.Context, tenantID, workspaceID, providerID string, taskCredentials bool) (Provider, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	actor := actor(tenantID, workspaceID)
	if taskCredentials {
		response, err := d.providers.GetTaskProvider(ctx, &adminv1.GetTaskProviderRequest{Actor: actor, ProviderId: providerID})
		if err != nil {
			return Provider{}, err
		}
		if response.GetProvider() == nil {
			return Provider{}, errors.New("admin returned no task provider")
		}
		return providerFromProto(response.GetProvider()), nil
	}
	response, err := d.providers.GetProvider(ctx, &adminv1.GetProviderRequest{Actor: actor, ProviderId: providerID})
	if err != nil {
		return Provider{}, err
	}
	if response.GetProvider() == nil {
		return Provider{}, errors.New("admin returned no provider")
	}
	return providerFromProto(response.GetProvider()), nil
}

func (d *Directory) List(ctx context.Context, tenantID, workspaceID string) ([]Provider, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := d.providers.ListProviderCatalog(ctx, &adminv1.ListProviderCatalogRequest{Actor: actor(tenantID, workspaceID)})
	if err != nil {
		return nil, err
	}
	providers := make([]Provider, 0, len(response.GetProviders()))
	for _, item := range response.GetProviders() {
		providers = append(providers, Provider{
			ID: item.GetId(), Name: item.GetName(), Model: item.GetModel(), ProviderKind: providerKind(item.GetProviderKind()),
			Pricing: pricingFromProto(item.GetPricing()), IsDefault: item.GetIsDefault(), IsEnabled: item.GetIsEnabled(),
		})
	}
	return providers, nil
}

func actor(tenantID, workspaceID string) *commonv1.ActorContext {
	return &commonv1.ActorContext{TenantId: tenantID, WorkspaceId: workspaceID}
}

func providerFromProto(value *adminv1.ModelProvider) Provider {
	extra := map[string]any(nil)
	if value.GetExtraBody() != nil {
		extra = value.GetExtraBody().AsMap()
	}
	return Provider{
		ID: value.GetId(), Name: value.GetName(), Model: value.GetModel(), ProviderKind: providerKind(value.GetProviderKind()),
		BaseURL: value.GetBaseUrl(), APIKey: value.GetApiKey(), ExtraBody: extra, Pricing: pricingFromProto(value.GetPricing()),
		ContextWindow: int64(value.GetContextWindow()), MaxOutputTokens: int64(value.GetMaxOutputTokens()),
		SupportsImageInput: value.GetSupportsImageInput(), IsDefault: value.GetIsDefault(), IsEnabled: value.GetIsEnabled(),
	}
}

func providerKind(value adminv1.ProviderKind) string {
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

func pricingFromProto(value *adminv1.ProviderPricing) *Pricing {
	if value == nil {
		return nil
	}
	unit := ""
	switch value.GetUnit() {
	case adminv1.PricingUnit_PRICING_UNIT_GENERATED_ITEM:
		unit = "generated_item"
	case adminv1.PricingUnit_PRICING_UNIT_GENERATED_SECOND:
		unit = "generated_second"
	}
	return &Pricing{Currency: value.GetCurrency(), Unit: unit, UnitPriceMicros: value.GetUnitPriceMicros()}
}
