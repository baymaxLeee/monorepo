package application

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/google/uuid"
)

type ProviderService struct {
	Repository ProviderRepository
	Keys       SecretCipher
	Errors     ErrorClassifier
	Probe      ProviderProbe
}

type TestProviderInput struct {
	BaseURL *string
	APIKey  *string
	Model   *string
}
type ProviderPublic struct {
	Provider     domain.Provider
	APIKeyMasked string
	ExtraBody    map[string]any
	Pricing      map[string]any
}
type ProviderInternal struct {
	Provider  domain.Provider
	APIKey    string
	ExtraBody map[string]any
	Pricing   map[string]any
}
type CreateProvider struct {
	Name, Model, Kind, BaseURL, APIKey       string
	ResponsesDialect                         *string
	ExtraBody                                map[string]any
	Pricing                                  map[string]any
	ContextWindow, MaxOutputTokens           int
	SupportsImageInput, IsDefault, IsEnabled bool
}

func parseObject(raw string) map[string]any {
	value := map[string]any{}
	_ = json.Unmarshal([]byte(raw), &value)
	return value
}
func parseOptionalObject(raw *string) map[string]any {
	if raw == nil {
		return nil
	}
	return parseObject(*raw)
}
func (s ProviderService) public(p domain.Provider) (ProviderPublic, error) {
	key, err := s.Keys.Decrypt(p.APIKeyEncrypted)
	if err != nil {
		return ProviderPublic{}, NewError(500, "provider_key_undecryptable", err.Error())
	}
	return ProviderPublic{Provider: p, APIKeyMasked: maskSecret(key), ExtraBody: parseObject(p.ExtraBody), Pricing: parseOptionalObject(p.PricingJSON)}, nil
}
func (s ProviderService) internal(p domain.Provider) (ProviderInternal, error) {
	key, err := s.Keys.Decrypt(p.APIKeyEncrypted)
	if err != nil {
		return ProviderInternal{}, NewError(500, "provider_key_undecryptable", err.Error())
	}
	return ProviderInternal{Provider: p, APIKey: key, ExtraBody: parseObject(p.ExtraBody), Pricing: parseOptionalObject(p.PricingJSON)}, nil
}
func (s ProviderService) List(ctx context.Context, a Actor) ([]ProviderPublic, error) {
	rows, err := s.Repository.List(ctx, a.WorkspaceID, a.TenantID)
	if err != nil {
		return nil, err
	}
	out := make([]ProviderPublic, 0, len(rows))
	for _, row := range rows {
		p, err := s.public(row)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}
func (s ProviderService) Catalog(ctx context.Context, workspaceID, tenantID string) ([]domain.Provider, error) {
	return s.Repository.List(ctx, workspaceID, tenantID)
}
func (s ProviderService) Get(ctx context.Context, id, workspaceID, tenantID string) (ProviderPublic, error) {
	p, err := s.Repository.Get(ctx, id, workspaceID, tenantID)
	if s.Errors.IsNotFound(err) {
		return ProviderPublic{}, NotFound("model provider %s not found", id)
	}
	if err != nil {
		return ProviderPublic{}, err
	}
	return s.public(p)
}
func (s ProviderService) GetInternal(ctx context.Context, id, workspaceID, tenantID string, allowDisabled bool) (ProviderInternal, error) {
	p, err := s.Repository.Get(ctx, id, workspaceID, tenantID)
	if s.Errors.IsNotFound(err) {
		return ProviderInternal{}, NotFound("model provider %s not found", id)
	}
	if err != nil {
		return ProviderInternal{}, err
	}
	if !p.IsEnabled && !allowDisabled {
		return ProviderInternal{}, Conflict(fmt.Sprintf("model provider %s is disabled", id))
	}
	return s.internal(p)
}
func (s ProviderService) Default(ctx context.Context, workspaceID, tenantID string) (ProviderInternal, error) {
	p, err := s.Repository.Default(ctx, workspaceID, tenantID)
	if s.Errors.IsNotFound(err) {
		return ProviderInternal{}, NotFound("no default model provider for workspace %s", workspaceID)
	}
	if err != nil {
		return ProviderInternal{}, err
	}
	return s.internal(p)
}
func (s ProviderService) ByKind(ctx context.Context, workspaceID, tenantID, kind string) (ProviderInternal, error) {
	p, err := s.Repository.ByKind(ctx, workspaceID, tenantID, kind)
	if s.Errors.IsNotFound(err) {
		return ProviderInternal{}, NotFound("no enabled %s provider for workspace %s", kind, workspaceID)
	}
	if err != nil {
		return ProviderInternal{}, err
	}
	return s.internal(p)
}
func (s ProviderService) Create(ctx context.Context, a Actor, input CreateProvider) (ProviderPublic, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return ProviderPublic{}, err
	}
	if err := validateProvider(input.Kind, input.ResponsesDialect, input.Pricing, input.ContextWindow, input.MaxOutputTokens, input.IsDefault, input.IsEnabled); err != nil {
		return ProviderPublic{}, err
	}
	baseURL, err := validatePublicURL(ctx, input.BaseURL)
	if err != nil {
		return ProviderPublic{}, err
	}
	encrypted, err := s.Keys.Encrypt(input.APIKey)
	if err != nil {
		return ProviderPublic{}, err
	}
	extra, _ := json.Marshal(input.ExtraBody)
	var pricing *string
	if input.Pricing != nil {
		raw, _ := json.Marshal(input.Pricing)
		text := string(raw)
		pricing = &text
	}
	p := domain.Provider{ID: strings.ReplaceAll(uuid.NewString(), "-", "")[:12], UserID: a.UserID, WorkspaceID: a.WorkspaceID, TenantID: a.TenantID, Name: input.Name, Model: input.Model, Kind: input.Kind, ResponsesDialect: input.ResponsesDialect, BaseURL: baseURL, APIKeyEncrypted: encrypted, ExtraBody: string(extra), PricingJSON: pricing, ContextWindow: input.ContextWindow, MaxOutputTokens: input.MaxOutputTokens, SupportsImageInput: input.SupportsImageInput, IsDefault: input.IsDefault, IsEnabled: input.IsEnabled}
	p, err = s.Repository.Create(ctx, p, input.IsDefault)
	if err != nil {
		return ProviderPublic{}, err
	}
	return s.public(p)
}
func (s ProviderService) Delete(ctx context.Context, a Actor, id string) error {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return err
	}
	deleted, err := s.Repository.Delete(ctx, id, a.WorkspaceID, a.TenantID)
	if err != nil {
		return err
	}
	if !deleted {
		return NotFound("model provider %s not found", id)
	}
	return nil
}
func (s ProviderService) Update(ctx context.Context, a Actor, value ProviderPublic, apiKey *string) (ProviderPublic, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return ProviderPublic{}, err
	}
	p := value.Provider
	if err := validateProvider(p.Kind, p.ResponsesDialect, value.Pricing, p.ContextWindow, p.MaxOutputTokens, p.IsDefault, p.IsEnabled); err != nil {
		return ProviderPublic{}, err
	}
	if p.IsDefault && !p.IsEnabled {
		return ProviderPublic{}, Conflict("set a replacement default before disabling this provider")
	}
	baseURL, err := validatePublicURL(ctx, p.BaseURL)
	if err != nil {
		return ProviderPublic{}, err
	}
	p.BaseURL = baseURL
	if apiKey != nil {
		p.APIKeyEncrypted, err = s.Keys.Encrypt(*apiKey)
		if err != nil {
			return ProviderPublic{}, err
		}
	}
	extra, _ := json.Marshal(value.ExtraBody)
	p.ExtraBody = string(extra)
	if value.Pricing == nil {
		p.PricingJSON = nil
	} else {
		raw, _ := json.Marshal(value.Pricing)
		text := string(raw)
		p.PricingJSON = &text
	}
	p, err = s.Repository.Save(ctx, p)
	if err != nil {
		return ProviderPublic{}, err
	}
	return s.public(p)
}
func (s ProviderService) BulkDelete(ctx context.Context, a Actor, ids []string) (int64, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return 0, err
	}
	return s.Repository.BulkDelete(ctx, ids, a.WorkspaceID, a.TenantID)
}
func (s ProviderService) SetDefault(ctx context.Context, a Actor, id string) (ProviderPublic, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return ProviderPublic{}, err
	}
	existing, err := s.Repository.Get(ctx, id, a.WorkspaceID, a.TenantID)
	if s.Errors.IsNotFound(err) {
		return ProviderPublic{}, NotFound("model provider %s not found", id)
	}
	if err != nil {
		return ProviderPublic{}, err
	}
	if existing.Kind != "chat" {
		return ProviderPublic{}, BadRequest("only chat providers can be set as default")
	}
	if !existing.IsEnabled {
		return ProviderPublic{}, Conflict("cannot mark a disabled provider as default")
	}
	p, err := s.Repository.SetDefault(ctx, id, a.WorkspaceID, a.TenantID)
	if err != nil {
		return ProviderPublic{}, err
	}
	return s.public(p)
}

func (s ProviderService) Test(ctx context.Context, a Actor, id string, input TestProviderInput) (ProviderProbeResult, error) {
	if err := RequireWorkspaceAdmin(a); err != nil {
		return ProviderProbeResult{}, err
	}
	provider, err := s.GetInternal(ctx, id, a.WorkspaceID, a.TenantID, true)
	if err != nil {
		return ProviderProbeResult{}, err
	}
	baseURL, apiKey, model := provider.Provider.BaseURL, provider.APIKey, provider.Provider.Model
	if input.BaseURL != nil {
		baseURL, err = validatePublicURL(ctx, *input.BaseURL)
		if err != nil {
			return ProviderProbeResult{}, err
		}
	}
	if input.APIKey != nil {
		apiKey = *input.APIKey
	}
	if input.Model != nil {
		model = *input.Model
	}
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(model) == "" {
		return ProviderProbeResult{}, BadRequest("provider test requires an API key and model")
	}
	if s.Probe == nil {
		return ProviderProbeResult{}, NewError(500, "provider_probe_unavailable", "provider probe is not configured")
	}
	return s.Probe.Probe(ctx, ProviderProbeRequest{
		Kind:    provider.Provider.Kind,
		BaseURL: baseURL, APIKey: apiKey, Model: model, ExtraBody: provider.ExtraBody,
	}), nil
}

func maskSecret(value string) string {
	if len(value) <= 8 {
		return strings.Repeat("*", len(value))
	}
	return value[:4] + "****" + value[len(value)-4:]
}
func validateProvider(kind string, dialect *string, pricing map[string]any, contextWindow, maxOutput int, isDefault, isEnabled bool) error {
	if kind == "chat" && (dialect == nil || *dialect != "ark_responses") {
		return BadRequest("chat providers must use ark_responses")
	}
	if kind != "chat" && dialect != nil {
		return BadRequest("responses_dialect is only valid for chat providers")
	}
	if maxOutput >= contextWindow {
		return BadRequest("max_output_tokens_k must be less than context_window_k")
	}
	if isDefault && kind != "chat" {
		return BadRequest("only chat providers can be set as default")
	}
	if isDefault && !isEnabled {
		return Conflict("cannot create a disabled default provider")
	}
	if pricing != nil {
		unit, _ := pricing["unit"].(string)
		expected := map[string]string{"image": "generated_item", "video": "generated_second"}[kind]
		if expected == "" {
			return BadRequest("pricing is only supported for image and video providers")
		}
		if unit != expected {
			return BadRequest(fmt.Sprintf("%s provider pricing must use %s", kind, expected))
		}
	}
	return nil
}
func validatePublicURL(ctx context.Context, raw string) (string, error) {
	normalized := strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return "", BadRequest("provider base_url must be an absolute HTTP(S) URL")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return "", BadRequest("provider base_url must use a public host")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return "", BadRequest("provider base_url host could not be resolved")
	}
	for _, address := range addresses {
		if !address.IP.IsGlobalUnicast() || address.IP.IsPrivate() || address.IP.IsLoopback() {
			return "", BadRequest("provider base_url must not resolve to a private or reserved address")
		}
	}
	return normalized, nil
}
