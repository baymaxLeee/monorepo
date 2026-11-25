package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	canvasPluginID         = "canvas@platform"
	maxConversationPlugins = 16
)

var (
	conversationPluginComponentPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`)
	conversationBindingKeyPattern      = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
)

type Service struct {
	repository   Repository
	runtime      RuntimeClient
	capabilities TurnCapabilityResolver
}

func NewService(repository Repository, runtime RuntimeClient, capabilities ...TurnCapabilityResolver) *Service {
	var resolver TurnCapabilityResolver
	if len(capabilities) > 0 {
		resolver = capabilities[0]
	}
	return &Service{repository: repository, runtime: runtime, capabilities: resolver}
}

func (service *Service) Ping(ctx context.Context) error { return service.repository.Ping(ctx) }
func (service *Service) Close()                         { service.repository.Close() }

func (service *Service) List(ctx context.Context, scope AuthContext) ([]map[string]any, error) {
	items, err := service.repository.List(ctx, scope)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, PublicConversation(item))
	}
	return result, nil
}

func (service *Service) Create(ctx context.Context, scope AuthContext, headers http.Header, input CreateConversationInput) (map[string]any, error) {
	intent, err := createConversationIntent(input)
	if err != nil {
		return nil, err
	}
	product, runtimeValue, err := service.establishConversation(ctx, scope, headers, intent)
	if err != nil {
		return nil, err
	}
	return ProjectConversation(product, runtimeValue), nil
}

func (service *Service) CreateCanvas(ctx context.Context, scope AuthContext, headers http.Header, input CreateCanvasConversationInput) (map[string]any, error) {
	conversationInput := CreateConversationInput{
		RequestID: input.RequestID, Title: input.Title, ProviderID: input.ProviderID, ReasoningEffort: input.ReasoningEffort,
		PluginSelections: []ConversationPluginSelection{{
			PluginID: canvasPluginID,
			Bindings: map[string]string{"project_id": input.ProjectID, "canvas_id": input.CanvasID},
		}},
	}
	intent, err := createConversationIntent(conversationInput)
	if err != nil {
		return nil, err
	}
	product, _, err := service.establishConversation(ctx, scope, headers, intent)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": product.ID, "project_id": input.ProjectID, "canvas_id": input.CanvasID}, nil
}

func (service *Service) Get(ctx context.Context, scope AuthContext, headers http.Header, conversationID string) (map[string]any, error) {
	product, err := service.requireReadyConversation(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodGet, Path: runtimePath(*product, ""), Headers: headers})
	if err != nil {
		return nil, err
	}
	runtimeValue, err := requireRuntimeJSON(response)
	if err != nil {
		return nil, err
	}
	return ProjectConversation(*product, runtimeValue), nil
}

func (service *Service) Update(ctx context.Context, scope AuthContext, conversationID, title string) (map[string]any, error) {
	if _, err := service.requireReadyConversation(ctx, scope, conversationID); err != nil {
		return nil, err
	}
	product, err := service.repository.UpdateTitle(ctx, scope, conversationID, title)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, NotFound("conversation not found")
	}
	return PublicConversation(*product), nil
}

func (service *Service) Delete(ctx context.Context, scope AuthContext, headers http.Header, conversationID string) error {
	existing, err := service.repository.Get(ctx, scope, conversationID)
	if err != nil {
		return err
	}
	if existing == nil {
		return NotFound("conversation not found")
	}
	if existing.State == ConversationCreating {
		return Conflict("conversation_creating", "conversation is still being created")
	}
	product, err := service.repository.BeginDelete(ctx, scope, conversationID)
	if err != nil {
		return err
	}
	if product == nil {
		return Conflict("conversation_delete_conflict", "conversation cannot enter deleting state")
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodDelete, Path: runtimePath(*product, ""), Headers: headers})
	if err != nil {
		return service.sagaFailure(ctx, scope, *product, err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode != http.StatusNotFound {
			return service.sagaFailure(ctx, scope, *product, &RuntimeResponseError{Response: response})
		}
	}
	if response.Body != nil {
		_ = response.Body.Close()
	}
	if err := service.repository.CompleteDelete(ctx, scope, product.ID, product.RuntimeThreadID); err != nil {
		return service.sagaFailure(ctx, scope, *product, err)
	}
	return nil
}

func (service *Service) Fork(ctx context.Context, scope AuthContext, headers http.Header, conversationID, messageID, requestID string) (map[string]any, error) {
	source, err := service.requireReadyConversation(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]string{"message_id": messageID, "request_id": requestID})
	if err != nil {
		return nil, err
	}
	runtimeRequest, err := encodeDurableRuntimeRequest(durableRuntimeRequest{
		Method: http.MethodPost,
		Path:   runtimePath(*source, "/forks"),
		Body:   body,
	})
	if err != nil {
		return nil, err
	}
	title := source.Title
	runes := []rune(title)
	if len(runes) > 190 {
		title = string(runes[:190])
	}
	title += " · 分支"
	sourceConversationID := source.ID
	sourceMessageID := messageID
	intent := ConversationIntent{
		Operation: ConversationFork,
		Input: CreateConversationInput{
			RequestID:        requestID,
			Title:            &title,
			PluginSelections: clonePluginSelections(source.PluginSelections),
		},
		CreateFingerprint:    fingerprintConversationIntent(runtimeRequest, source.PluginSelections),
		RuntimeRequest:       runtimeRequest,
		SourceConversationID: &sourceConversationID,
		SourceMessageID:      &sourceMessageID,
	}
	product, fork, err := service.establishConversation(ctx, scope, headers, intent)
	if err != nil {
		return nil, err
	}
	if value, ok := fork["source_message_id"].(string); ok && value != "" {
		sourceMessageID = value
	}
	return map[string]any{"id": product.ID, "source_conversation_id": source.ID, "source_message_id": sourceMessageID}, nil
}

func (service *Service) ProxyConversation(ctx context.Context, scope AuthContext, headers http.Header, method, conversationID, suffix, rawQuery string, body io.Reader) (*http.Response, error) {
	product, err := service.requireReadyConversation(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	requestBody := body
	if suffix == "/stream" && method == http.MethodPost {
		var input map[string]any
		decoder := json.NewDecoder(body)
		decoder.UseNumber()
		if err := decoder.Decode(&input); err != nil {
			return nil, BadRequest("request body must be valid JSON")
		}
		if service.capabilities == nil {
			return nil, errors.New("Runtime Turn capability resolver is not configured")
		}
		providerID, err := service.runtimeProviderSelection(ctx, headers, *product)
		if err != nil {
			return nil, err
		}
		capabilities, err := service.capabilities.ResolveTurn(ctx, scope, providerID, product.PluginSelections)
		if err != nil {
			return nil, err
		}
		if memories, ok := service.repository.(MemoryRepository); ok {
			capabilities.Memories, err = memories.ListActiveMemories(ctx, scope)
			if err != nil {
				return nil, err
			}
		}
		projected, err := RuntimeRunBody(*product, input, capabilities)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(projected)
		if err != nil {
			return nil, err
		}
		requestBody = bytes.NewReader(encoded)
	} else if suffix == "/model" && method == http.MethodPatch {
		if service.capabilities == nil {
			return nil, errors.New("Runtime provider capability resolver is not configured")
		}
		var input struct {
			ProviderID      string `json:"provider_id"`
			ReasoningEffort string `json:"reasoning_effort"`
		}
		if err := json.NewDecoder(body).Decode(&input); err != nil || input.ProviderID == "" || input.ReasoningEffort == "" {
			return nil, BadRequest("provider_id and reasoning_effort are required")
		}
		provider, err := service.capabilities.ResolveProvider(ctx, scope, &input.ProviderID)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(map[string]any{
			"provider_id": provider.ID, "model": provider.Model, "reasoning_effort": input.ReasoningEffort,
		})
		if err != nil {
			return nil, err
		}
		requestBody = bytes.NewReader(encoded)
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{
		Method: method, Path: runtimePath(*product, suffix) + querySuffix(rawQuery), Headers: headers, Body: requestBody,
	})
	if err != nil {
		return nil, err
	}
	projected, err := ProjectRuntimeResponse(*product, response)
	if err != nil {
		return nil, err
	}
	if suffix == "/stream" && method == http.MethodPost {
		service.observeConversationTitle(ctx, scope, *product, projected)
	}
	return projected, nil
}

func (service *Service) runtimeProviderSelection(ctx context.Context, headers http.Header, product Conversation) (*string, error) {
	response, err := service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodGet, Path: runtimePath(product, ""), Headers: headers})
	if err != nil {
		return nil, err
	}
	value, err := requireRuntimeJSON(response)
	if err != nil {
		return nil, err
	}
	providerID, _ := value["provider_id"].(string)
	if providerID == "" {
		return nil, nil
	}
	return &providerID, nil
}

func (service *Service) ProxyRuntime(ctx context.Context, scope AuthContext, headers http.Header, method, path, rawQuery string, body io.Reader) (*http.Response, error) {
	if service.capabilities == nil {
		return nil, errors.New("Runtime capability resolver is not configured")
	}
	switch path {
	case "/local-inference/config":
		if method != http.MethodGet {
			return nil, BadRequest("local inference config requires GET")
		}
		query, err := url.ParseQuery(rawQuery)
		if err != nil {
			return nil, BadRequest("invalid local inference query")
		}
		providerID := strings.TrimSpace(query.Get("provider_id"))
		reasoningEffort := strings.TrimSpace(query.Get("reasoning_effort"))
		if providerID == "" || reasoningEffort == "" {
			return nil, BadRequest("provider_id and reasoning_effort are required")
		}
		provider, err := service.capabilities.ResolveProvider(ctx, scope, &providerID)
		if err != nil {
			return nil, err
		}
		return service.runtimeJSON(ctx, headers, "/local-inference/config", map[string]any{
			"provider": provider, "reasoningEffort": reasoningEffort,
		})
	case "/local-inference/plugins/resolve":
		if method != http.MethodPost {
			return nil, BadRequest("local plugin resolution requires POST")
		}
		var input struct {
			Activations []struct {
				PluginID string            `json:"pluginId"`
				Bindings map[string]string `json:"bindings,omitempty"`
			} `json:"activations"`
		}
		if err := json.NewDecoder(body).Decode(&input); err != nil {
			return nil, BadRequest("invalid plugin activation request")
		}
		selections := make([]ConversationPluginSelection, 0, len(input.Activations))
		for _, activation := range input.Activations {
			selections = append(selections, ConversationPluginSelection{PluginID: activation.PluginID, Bindings: activation.Bindings})
		}
		selections, err := normalizePluginSelections(selections)
		if err != nil {
			return nil, BadRequest(err.Error())
		}
		plugins, err := service.capabilities.ResolvePlugins(ctx, scope, selections)
		if err != nil {
			return nil, err
		}
		if localSnapshotContainsSystemPlugin(plugins) {
			return nil, BadRequest("system plugins require cloud Runtime execution")
		}
		return jsonResponse(http.StatusOK, plugins)
	case "/local-inference/stream":
		if method != http.MethodPost {
			return nil, BadRequest("local inference stream requires POST")
		}
		var request map[string]any
		decoder := json.NewDecoder(body)
		decoder.UseNumber()
		if err := decoder.Decode(&request); err != nil {
			return nil, BadRequest("invalid local inference request")
		}
		providerID, _ := request["providerId"].(string)
		if providerID == "" {
			return nil, BadRequest("local inference providerId is required")
		}
		provider, err := service.capabilities.ResolveProvider(ctx, scope, &providerID)
		if err != nil {
			return nil, err
		}
		return service.runtimeJSON(ctx, headers, path, map[string]any{"provider": provider, "request": request})
	default:
		return service.runtime.Do(ctx, RuntimeRequest{Method: method, Path: path + querySuffix(rawQuery), Headers: headers, Body: body})
	}
}

func (service *Service) runtimeJSON(ctx context.Context, headers http.Header, path string, value any) (*http.Response, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	nextHeaders := headers.Clone()
	nextHeaders.Set("Content-Type", "application/json")
	return service.runtime.Do(ctx, RuntimeRequest{Method: http.MethodPost, Path: path, Headers: nextHeaders, Body: bytes.NewReader(encoded)})
}

func localSnapshotContainsSystemPlugin(snapshot map[string]any) bool {
	plugins, _ := snapshot["plugins"].([]any)
	for _, value := range plugins {
		plugin, _ := value.(map[string]any)
		manifest, _ := plugin["manifest"].(map[string]any)
		if manifest["source"] == "system" || manifest["trust"] == "system" {
			return true
		}
	}
	return false
}

func jsonResponse(status int, value any) (*http.Response, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}, "Cache-Control": []string{"no-store"}},
		Body:       io.NopCloser(bytes.NewReader(encoded)),
	}, nil
}

type durableRuntimeRequest struct {
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Body   json.RawMessage `json:"body,omitempty"`
}

func createConversationIntent(input CreateConversationInput) (ConversationIntent, error) {
	pluginSelections, err := normalizePluginSelections(input.PluginSelections)
	if err != nil {
		return ConversationIntent{}, BadRequest(err.Error())
	}
	input.PluginSelections = pluginSelections
	body, err := json.Marshal(struct {
		RequestID         string  `json:"request_id"`
		ProviderID        *string `json:"provider_id,omitempty"`
		ReasoningEffort   *string `json:"reasoning_effort,omitempty"`
		ApprovalPolicy    *string `json:"approval_policy,omitempty"`
		PermissionProfile *string `json:"permission_profile,omitempty"`
	}{
		RequestID: input.RequestID, ProviderID: input.ProviderID, ReasoningEffort: input.ReasoningEffort,
		ApprovalPolicy: input.ApprovalPolicy, PermissionProfile: input.PermissionProfile,
	})
	if err != nil {
		return ConversationIntent{}, err
	}
	runtimeRequest, err := encodeDurableRuntimeRequest(durableRuntimeRequest{
		Method: http.MethodPost,
		Path:   "/v1/sessions",
		Body:   body,
	})
	if err != nil {
		return ConversationIntent{}, err
	}
	return ConversationIntent{
		Operation:         ConversationCreate,
		Input:             input,
		CreateFingerprint: fingerprintConversationIntent(runtimeRequest, pluginSelections),
		RuntimeRequest:    runtimeRequest,
	}, nil
}

func encodeDurableRuntimeRequest(request durableRuntimeRequest) (json.RawMessage, error) {
	if request.Method == "" || request.Path == "" {
		return nil, errors.New("durable Runtime request requires method and path")
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("encode durable Runtime request: %w", err)
	}
	return encoded, nil
}

func fingerprintConversationIntent(request json.RawMessage, selections []ConversationPluginSelection) string {
	encoded, err := json.Marshal(struct {
		RuntimeRequest   json.RawMessage               `json:"runtime_request"`
		PluginSelections []ConversationPluginSelection `json:"plugin_selections"`
	}{RuntimeRequest: request, PluginSelections: selections})
	if err != nil {
		panic(fmt.Sprintf("encode normalized conversation intent: %v", err))
	}
	return fmt.Sprintf("%x", sha256.Sum256(encoded))
}

func normalizePluginSelections(input []ConversationPluginSelection) ([]ConversationPluginSelection, error) {
	if len(input) > maxConversationPlugins {
		return nil, fmt.Errorf("conversation may select at most %d plugins", maxConversationPlugins)
	}
	result := clonePluginSelections(input)
	sort.Slice(result, func(left, right int) bool { return result[left].PluginID < result[right].PluginID })
	for index := range result {
		selection := &result[index]
		separator := strings.LastIndex(selection.PluginID, "@")
		if separator <= 0 || separator == len(selection.PluginID)-1 ||
			!validPluginComponent(selection.PluginID[:separator]) || !validPluginComponent(selection.PluginID[separator+1:]) {
			return nil, fmt.Errorf("invalid plugin id %q", selection.PluginID)
		}
		if index > 0 && result[index-1].PluginID == selection.PluginID {
			return nil, fmt.Errorf("duplicate plugin selection %q", selection.PluginID)
		}
		for key, value := range selection.Bindings {
			if !conversationBindingKeyPattern.MatchString(key) || value == "" || len(value) > 256 || containsControlCharacter(value) {
				return nil, fmt.Errorf("plugin %q has invalid binding %q", selection.PluginID, key)
			}
		}
		if len(selection.Bindings) == 0 {
			selection.Bindings = nil
		}
	}
	return result, nil
}

func validPluginComponent(value string) bool {
	return conversationPluginComponentPattern.MatchString(value) && !strings.Contains(value, "--") && !strings.Contains(value, "..")
}

func containsControlCharacter(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

func clonePluginSelections(input []ConversationPluginSelection) []ConversationPluginSelection {
	if len(input) == 0 {
		return []ConversationPluginSelection{}
	}
	result := make([]ConversationPluginSelection, len(input))
	for index, selection := range input {
		result[index].PluginID = selection.PluginID
		if len(selection.Bindings) > 0 {
			result[index].Bindings = make(map[string]string, len(selection.Bindings))
			for key, value := range selection.Bindings {
				result[index].Bindings[key] = value
			}
		}
	}
	return result
}

func (service *Service) establishConversation(
	ctx context.Context,
	scope AuthContext,
	headers http.Header,
	intent ConversationIntent,
) (Conversation, map[string]any, error) {
	product, err := service.repository.Reserve(ctx, scope, intent)
	if err != nil {
		return Conversation{}, nil, err
	}
	var request durableRuntimeRequest
	if err := json.Unmarshal(product.RuntimeRequest, &request); err != nil {
		failure := fmt.Errorf("decode durable Runtime request: %w", err)
		return Conversation{}, nil, service.sagaFailure(ctx, scope, product, failure)
	}
	if request.Method == "" || request.Path == "" {
		failure := errors.New("durable Runtime request is incomplete")
		return Conversation{}, nil, service.sagaFailure(ctx, scope, product, failure)
	}
	response, err := service.runtime.Do(ctx, RuntimeRequest{
		Method:  request.Method,
		Path:    request.Path,
		Headers: headers,
		Body:    bytes.NewReader(request.Body),
	})
	if err != nil {
		return Conversation{}, nil, service.sagaFailure(ctx, scope, product, err)
	}
	runtimeValue, err := requireRuntimeJSON(response)
	if err != nil {
		return Conversation{}, nil, service.sagaFailure(ctx, scope, product, err)
	}
	runtimeThreadID, ok := runtimeValue["id"].(string)
	if !ok || runtimeThreadID == "" {
		failure := errors.New("Runtime Thread response has no id")
		return Conversation{}, nil, service.sagaFailure(ctx, scope, product, failure)
	}
	bound, err := service.repository.BindRuntimeThread(ctx, scope, product.ID, runtimeThreadID)
	if err != nil {
		return Conversation{}, nil, service.sagaFailure(ctx, scope, product, err)
	}
	return bound, runtimeValue, nil
}

func (service *Service) sagaFailure(ctx context.Context, scope AuthContext, product Conversation, cause error) error {
	if err := service.repository.RecordSagaFailure(ctx, scope, product.ID, product.State, cause); err != nil {
		return errors.Join(cause, fmt.Errorf("record conversation saga failure: %w", err))
	}
	return cause
}

func (service *Service) requireReadyConversation(ctx context.Context, scope AuthContext, conversationID string) (*Conversation, error) {
	product, err := service.repository.Get(ctx, scope, conversationID)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, NotFound("conversation not found")
	}
	if product.State == ConversationCreating {
		return nil, Conflict("conversation_creating", "conversation is still being created")
	}
	if product.State == ConversationDeleting {
		return nil, Conflict("conversation_deleting", "conversation is being deleted")
	}
	if product.State != ConversationReady || product.RuntimeThreadID == "" {
		return nil, Conflict("conversation_not_ready", "conversation is not ready")
	}
	return product, nil
}

func requireRuntimeJSON(response *http.Response) (map[string]any, error) {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &RuntimeResponseError{Response: response}
	}
	defer response.Body.Close()
	var value map[string]any
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode Runtime response: %w", err)
	}
	return value, nil
}

func ProjectRuntimeResponse(product Conversation, response *http.Response) (*http.Response, error) {
	if response.Body == nil || response.StatusCode == http.StatusNoContent || response.StatusCode == http.StatusNotModified ||
		!strings.Contains(response.Header.Get("Content-Type"), "application/json") {
		return response, nil
	}
	defer response.Body.Close()
	var value any
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode Runtime response: %w", err)
	}
	body, err := json.Marshal(ProjectRuntimeValue(product, value))
	if err != nil {
		return nil, err
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = -1
	response.Header.Del("Content-Length")
	return response, nil
}

func PublicConversation(product Conversation) map[string]any {
	return map[string]any{
		"id": product.ID, "user_id": product.UserID, "tenant_id": product.TenantID, "workspace_id": product.WorkspaceID,
		"title": product.Title, "plugin_selections": clonePluginSelections(product.PluginSelections),
		"created_at": isoMilliseconds(product.CreatedAt), "updated_at": isoMilliseconds(product.UpdatedAt),
	}
}

func runtimePath(product Conversation, suffix string) string {
	return "/v1/sessions/" + url.PathEscape(product.RuntimeThreadID) + suffix
}

func querySuffix(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	return "?" + rawQuery
}

func isoMilliseconds(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}
