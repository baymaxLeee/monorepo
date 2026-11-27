package httpapi

import (
	"encoding/json"
	"net/http"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
	"github.com/example/monorepo/admin/internal/application"
	"github.com/gin-gonic/gin"
)

func actor(r *http.Request) (application.Actor, error) { return application.ActorFromRequest(r) }
func pointer[T any](value T) *T                        { return &value }
func pricing(value map[string]any) *adminapi.ProviderPricing {
	if value == nil {
		return nil
	}
	raw, _ := json.Marshal(value)
	var result adminapi.ProviderPricing
	if json.Unmarshal(raw, &result) != nil {
		return nil
	}
	return &result
}
func publicProvider(value application.ProviderPublic) adminapi.ModelProvider {
	p := value.Provider
	var dialect *adminapi.ModelProviderResponsesDialect
	if p.Kind == "chat" {
		v := adminapi.ModelProviderResponsesDialectArkResponses
		dialect = &v
	}
	return adminapi.ModelProvider{Id: p.ID, UserId: p.UserID, WorkspaceId: p.WorkspaceID, TenantId: p.TenantID, Name: p.Name, Model: p.Model, ProviderKind: adminapi.ModelProviderProviderKind(p.Kind), ResponsesDialect: dialect, BaseUrl: p.BaseURL, ApiKeyMasked: value.APIKeyMasked, ExtraBody: value.ExtraBody, Pricing: pricing(value.Pricing), ContextWindowK: float32(p.ContextWindow) / 1024, MaxOutputTokensK: float32(p.MaxOutputTokens) / 1024, SupportsImageInput: p.SupportsImageInput, IsDefault: p.IsDefault, IsEnabled: p.IsEnabled, CreatedAt: p.CreatedAt.UTC().Format(timeLayout), UpdatedAt: p.UpdatedAt.UTC().Format(timeLayout)}
}

const timeLayout = "2006-01-02T15:04:05.999999Z"

func (h *Handler) ListProviders(c *gin.Context, _ adminapi.ListProvidersParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	values, err := h.Providers.List(r.Context(), a)
	if err != nil {
		writeError(w, err)
		return
	}
	out := make([]adminapi.ModelProvider, 0, len(values))
	for _, v := range values {
		out = append(out, publicProvider(v))
	}
	writeJSON(w, 200, out)
}
func (h *Handler) GetProvider(c *gin.Context, id string, _ adminapi.GetProviderParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Providers.Get(r.Context(), id, a.WorkspaceID, a.TenantID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, publicProvider(value))
}
func (h *Handler) UpdateProvider(c *gin.Context, id string, _ adminapi.UpdateProviderParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	current, err := h.Providers.Get(r.Context(), id, a.WorkspaceID, a.TenantID)
	if err != nil {
		writeError(w, err)
		return
	}
	var raw map[string]json.RawMessage
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&raw); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	p := &current.Provider
	decode := func(name string, target any) {
		if value, ok := raw[name]; ok {
			_ = json.Unmarshal(value, target)
		}
	}
	decode("name", &p.Name)
	decode("model", &p.Model)
	decode("base_url", &p.BaseURL)
	decode("supports_image_input", &p.SupportsImageInput)
	decode("is_default", &p.IsDefault)
	decode("is_enabled", &p.IsEnabled)
	if value, ok := raw["provider_kind"]; ok {
		_ = json.Unmarshal(value, &p.Kind)
	}
	if value, ok := raw["responses_dialect"]; ok {
		_ = json.Unmarshal(value, &p.ResponsesDialect)
	}
	if value, ok := raw["extra_body"]; ok {
		_ = json.Unmarshal(value, &current.ExtraBody)
	}
	if value, ok := raw["pricing"]; ok {
		_ = json.Unmarshal(value, &current.Pricing)
	}
	var apiKey *string
	if value, ok := raw["api_key"]; ok {
		_ = json.Unmarshal(value, &apiKey)
	}
	var k float32
	if value, ok := raw["context_window_k"]; ok {
		if json.Unmarshal(value, &k) == nil {
			p.ContextWindow = int(k * 1024)
		}
	}
	if value, ok := raw["max_output_tokens_k"]; ok {
		if json.Unmarshal(value, &k) == nil {
			p.MaxOutputTokens = int(k * 1024)
		}
	}
	updated, err := h.Providers.Update(r.Context(), a, current, apiKey)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, publicProvider(updated))
}
func (h *Handler) CreateProvider(c *gin.Context, _ adminapi.CreateProviderParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.CreateModelProviderInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	kind := "chat"
	if body.ProviderKind != nil {
		kind = string(*body.ProviderKind)
	}
	contextWindow, maxOutput := 512*1024, 256*1024
	if body.ContextWindowK != nil {
		contextWindow = int(*body.ContextWindowK * 1024)
	}
	if body.MaxOutputTokensK != nil {
		maxOutput = int(*body.MaxOutputTokensK * 1024)
	}
	isDefault, isEnabled, supportsImage := false, true, false
	if body.IsDefault != nil {
		isDefault = *body.IsDefault
	}
	if body.IsEnabled != nil {
		isEnabled = *body.IsEnabled
	}
	if body.SupportsImageInput != nil {
		supportsImage = *body.SupportsImageInput
	}
	extra := map[string]any{}
	if body.ExtraBody != nil {
		extra = *body.ExtraBody
	}
	var dialect *string
	if body.ResponsesDialect != nil {
		value := string(*body.ResponsesDialect)
		dialect = &value
	}
	var price map[string]any
	if body.Pricing != nil {
		raw, _ := json.Marshal(body.Pricing)
		_ = json.Unmarshal(raw, &price)
	}
	value, err := h.Providers.Create(r.Context(), a, application.CreateProvider{Name: body.Name, Model: body.Model, Kind: kind, ResponsesDialect: dialect, BaseURL: body.BaseUrl, APIKey: body.ApiKey, ExtraBody: extra, Pricing: price, ContextWindow: contextWindow, MaxOutputTokens: maxOutput, SupportsImageInput: supportsImage, IsDefault: isDefault, IsEnabled: isEnabled})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, publicProvider(value))
}
func (h *Handler) DeleteProvider(c *gin.Context, id string, _ adminapi.DeleteProviderParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err == nil {
		err = h.Providers.Delete(r.Context(), a, id)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (h *Handler) BulkDeleteProviders(c *gin.Context, _ adminapi.BulkDeleteProvidersParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.BulkDeleteModelProvidersInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	deleted, err := h.Providers.BulkDelete(r.Context(), a, body.Ids)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, adminapi.BulkDeleteModelProvidersResult{Deleted: int(deleted)})
}
func (h *Handler) SetDefaultProvider(c *gin.Context, id string, _ adminapi.SetDefaultProviderParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	value, err := h.Providers.SetDefault(r.Context(), a, id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, publicProvider(value))
}

func (h *Handler) TestProvider(c *gin.Context, id string, _ adminapi.TestProviderParams) {
	w, r := c.Writer, c.Request
	a, err := actor(r)
	if err != nil {
		writeError(w, err)
		return
	}
	var body adminapi.TestModelProviderInput
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, application.BadRequest(err.Error()))
		return
	}
	result, err := h.Providers.Test(r.Context(), a, id, application.TestProviderInput{
		BaseURL: body.BaseUrl, APIKey: body.ApiKey, Model: body.Model,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminapi.TestModelProviderResult{
		Ok: result.OK, LatencyMs: result.LatencyMS, Sample: result.Sample, Error: result.Error,
	})
}
