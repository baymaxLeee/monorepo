package providerprobe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/application"
)

const maxResponseBytes = 1 << 20

type Client struct {
	HTTP *http.Client
}

func New() Client {
	return Client{HTTP: &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}}
}

func (c Client) Probe(ctx context.Context, request application.ProviderProbeRequest) application.ProviderProbeResult {
	if request.Kind == "rerank" {
		return success(0, "rerank provider saved; live test not implemented")
	}
	started := time.Now()
	var sample string
	var err error
	switch request.Kind {
	case "chat":
		sample, err = c.probeChat(ctx, request)
	case "image":
		sample, err = c.probeImage(ctx, request)
	case "video":
		sample, err = c.probeVideo(ctx, request)
	case "embedding":
		sample, err = c.probeEmbedding(ctx, request)
	default:
		err = fmt.Errorf("configuration: unsupported provider kind %s", request.Kind)
	}
	if err != nil {
		message := err.Error()
		return application.ProviderProbeResult{OK: false, Error: &message}
	}
	return success(int(time.Since(started).Milliseconds()), sample)
}

func success(latency int, sample string) application.ProviderProbeResult {
	if len(sample) > 500 {
		sample = sample[:500]
	}
	return application.ProviderProbeResult{OK: true, LatencyMS: &latency, Sample: &sample}
}

func apiRoot(raw string) string {
	root := strings.TrimRight(strings.TrimSpace(raw), "/")
	for _, suffix := range []string{"/contents/generations/tasks", "/images/generations", "/responses", "/embeddings/multimodal", "/embeddings"} {
		root = strings.TrimSuffix(root, suffix)
	}
	return strings.TrimRight(root, "/")
}

func (c Client) probeChat(ctx context.Context, request application.ProviderProbeRequest) (string, error) {
	if request.ResponsesDialect == nil {
		return "", fmt.Errorf("configuration: chat provider requires responses_dialect")
	}
	body := filtered(request.ExtraBody, "model", "input", "instructions", "max_output_tokens", "stream", "store", "previous_response_id", "reasoning_effort", "tools", "tool_choice")
	body["model"] = request.Model
	body["instructions"] = "You are a helpful assistant."
	body["input"] = "Call provider_connectivity_probe with value ping."
	body["max_output_tokens"] = 512
	body["stream"] = false
	body["store"] = *request.ResponsesDialect != "deepseek_responses"
	body["tools"] = []any{map[string]any{"type": "function", "name": "provider_connectivity_probe", "description": "Return the supplied value.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"value": map[string]any{"type": "string"}}, "required": []string{"value"}, "additionalProperties": false}, "strict": true}}
	body["tool_choice"] = map[string]any{"type": "function", "name": "provider_connectivity_probe"}
	first, err := c.doJSON(ctx, http.MethodPost, apiRoot(request.BaseURL)+"/responses", request.APIKey, body)
	if err != nil {
		return "", err
	}
	output, _ := first["output"].([]any)
	var call map[string]any
	for _, item := range output {
		candidate, _ := item.(map[string]any)
		if candidate["type"] == "function_call" {
			call = candidate
			break
		}
	}
	if call == nil {
		return "", fmt.Errorf("api: Responses function calling returned no function_call")
	}
	functionOutput := map[string]any{"type": "function_call_output", "call_id": call["call_id"], "output": `{"value":"ping"}`}
	second := filtered(request.ExtraBody, "model", "input", "instructions", "max_output_tokens", "stream", "store", "previous_response_id", "reasoning_effort", "tools", "tool_choice")
	second["model"], second["max_output_tokens"], second["stream"], second["store"] = request.Model, 512, false, *request.ResponsesDialect != "deepseek_responses"
	if *request.ResponsesDialect == "deepseek_responses" {
		second["input"] = append(output, functionOutput)
	} else {
		second["input"] = []any{functionOutput}
		second["previous_response_id"] = first["id"]
	}
	response, err := c.doJSON(ctx, http.MethodPost, apiRoot(request.BaseURL)+"/responses", request.APIKey, second)
	if err != nil {
		return "", err
	}
	if text, _ := response["output_text"].(string); text != "" {
		return strings.TrimSpace(text), nil
	}
	return "Responses API function-call round trip succeeded", nil
}

func (c Client) probeImage(ctx context.Context, request application.ProviderProbeRequest) (string, error) {
	body := filtered(request.ExtraBody, "model", "prompt", "response_format", "n", "test_prompt")
	body["model"] = request.Model
	body["prompt"] = stringValue(request.ExtraBody["test_prompt"], "连通性测试: 一只简笔画风格的小猫。")
	body["size"] = stringValue(request.ExtraBody["size"], "2K")
	body["response_format"] = stringValue(request.ExtraBody["response_format"], "url")
	response, err := c.doJSON(ctx, http.MethodPost, apiRoot(request.BaseURL)+"/images/generations", request.APIKey, body)
	if err != nil {
		return "", err
	}
	data, _ := response["data"].([]any)
	if len(data) == 0 {
		return "", nil
	}
	first, _ := data[0].(map[string]any)
	if value, _ := first["url"].(string); value != "" {
		return value, nil
	}
	value, _ := first["b64_json"].(string)
	return value, nil
}

func (c Client) probeVideo(ctx context.Context, request application.ProviderProbeRequest) (string, error) {
	_, err := c.doJSON(ctx, http.MethodGet, apiRoot(request.BaseURL)+"/contents/generations/tasks?page_num=1&page_size=1", request.APIKey, nil)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Ark video API authenticated; model %s was not invoked", request.Model), nil
}

func (c Client) probeEmbedding(ctx context.Context, request application.ProviderProbeRequest) (string, error) {
	multimodal := strings.Contains(strings.ToLower(request.Model), "vision") || strings.Contains(strings.ToLower(request.Model), "multimodal")
	path := "/embeddings"
	body := filtered(request.ExtraBody, "model", "input", "encoding_format")
	body["model"] = request.Model
	body["input"] = "connectivity ping"
	label := "embedding"
	if multimodal {
		path, label = "/embeddings/multimodal", "multimodal embedding"
		body = map[string]any{"model": request.Model, "input": []any{map[string]any{"type": "text", "text": "connectivity ping"}}}
	}
	response, err := c.doJSON(ctx, http.MethodPost, apiRoot(request.BaseURL)+path, request.APIKey, body)
	if err != nil {
		return "", err
	}
	dimension := embeddingDimension(response["data"])
	return fmt.Sprintf("%s dim=%d", label, dimension), nil
}

func (c Client) doJSON(ctx context.Context, method, target, apiKey string, body map[string]any) (map[string]any, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("unexpected: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, fmt.Errorf("unexpected: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("authentication: invalid API key")
	}
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("api: HTTP %d %s: %s", response.StatusCode, method, strings.TrimSpace(string(raw)))
	}
	value := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("api: invalid JSON response: %w", err)
		}
	}
	return value, nil
}

func filtered(source map[string]any, reserved ...string) map[string]any {
	blocked := make(map[string]struct{}, len(reserved))
	for _, key := range reserved {
		blocked[key] = struct{}{}
	}
	result := map[string]any{}
	for key, value := range source {
		if _, exists := blocked[key]; !exists {
			result[key] = value
		}
	}
	return result
}

func stringValue(value any, fallback string) string {
	if text, ok := value.(string); ok && text != "" {
		return text
	}
	return fallback
}

func embeddingDimension(data any) int {
	if object, ok := data.(map[string]any); ok {
		if vector, ok := object["embedding"].([]any); ok {
			return len(vector)
		}
	}
	if values, ok := data.([]any); ok && len(values) > 0 {
		if object, ok := values[0].(map[string]any); ok {
			if vector, ok := object["embedding"].([]any); ok {
				return len(vector)
			}
		}
	}
	return 0
}
