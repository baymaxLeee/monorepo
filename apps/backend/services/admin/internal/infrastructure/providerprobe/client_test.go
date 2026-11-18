package providerprobe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/example/monorepo/admin/internal/application"
)

func TestProbeChatRetriesWithoutForcedToolChoiceWhenThinkingRejectsIt(t *testing.T) {
	t.Parallel()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		switch requests {
		case 1:
			choice, ok := body["tool_choice"].(map[string]any)
			if !ok || choice["type"] != "function" || choice["name"] != "provider_connectivity_probe" {
				t.Errorf("initial tool_choice = %#v", body["tool_choice"])
			}
			w.WriteHeader(http.StatusBadRequest)
			writeProbeJSON(t, w, map[string]any{"error": map[string]any{
				"code":    "InvalidParameter",
				"message": "The tool_choice parameter does not support being set to required or object in thinking mode",
			}})
		case 2:
			if _, exists := body["tool_choice"]; exists {
				t.Errorf("fallback request forced tool_choice: %#v", body["tool_choice"])
			}
			if got := body["reasoning_effort"]; got != "high" {
				t.Errorf("reasoning_effort = %#v, want high", got)
			}
			writeProbeJSON(t, w, map[string]any{
				"id": "response-1",
				"output": []any{map[string]any{
					"type": "function_call", "call_id": "call-1", "name": "provider_connectivity_probe",
				}},
			})
		default:
			writeProbeJSON(t, w, map[string]any{"output_text": "pong"})
		}
	}))
	defer server.Close()

	dialect := "ark_responses"
	result := New().Probe(context.Background(), application.ProviderProbeRequest{
		Kind:             "chat",
		ResponsesDialect: &dialect,
		BaseURL:          server.URL,
		APIKey:           "test-key",
		Model:            "kimi-k3-1-pro-261024",
		ExtraBody: map[string]any{
			"reasoning_effort": "high",
			"thinking":         map[string]any{"type": "enabled"},
		},
	})

	if !result.OK {
		t.Fatalf("probe failed: %v", result.Error)
	}
	if requests != 3 {
		t.Fatalf("request count = %d, want 3", requests)
	}
}

func TestProbeChatWithoutThinkingKeepsForcedToolChoice(t *testing.T) {
	t.Parallel()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if requests == 1 {
			choice, ok := body["tool_choice"].(map[string]any)
			if !ok || choice["type"] != "function" || choice["name"] != "provider_connectivity_probe" {
				t.Errorf("tool_choice = %#v", body["tool_choice"])
			}
			writeProbeJSON(t, w, map[string]any{
				"id": "response-1",
				"output": []any{map[string]any{
					"type": "function_call", "call_id": "call-1", "name": "provider_connectivity_probe",
				}},
			})
			return
		}
		writeProbeJSON(t, w, map[string]any{"output_text": "pong"})
	}))
	defer server.Close()

	dialect := "ark_responses"
	result := New().Probe(context.Background(), application.ProviderProbeRequest{
		Kind: "chat", ResponsesDialect: &dialect, BaseURL: server.URL, APIKey: "test-key", Model: "doubao-model",
	})
	if !result.OK {
		t.Fatalf("probe failed: %v", result.Error)
	}
}

func TestProbeChatDoesNotRetryUnrelatedBadRequest(t *testing.T) {
	t.Parallel()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.WriteHeader(http.StatusBadRequest)
		writeProbeJSON(t, w, map[string]any{"error": map[string]any{
			"code": "InvalidParameter", "message": "model is unavailable",
		}})
	}))
	defer server.Close()

	dialect := "ark_responses"
	result := New().Probe(context.Background(), application.ProviderProbeRequest{
		Kind: "chat", ResponsesDialect: &dialect, BaseURL: server.URL, APIKey: "test-key", Model: "unknown-model",
	})
	if result.OK || result.Error == nil {
		t.Fatalf("probe result = %#v, want error", result)
	}
	if requests != 1 {
		t.Fatalf("request count = %d, want 1", requests)
	}
}

func TestProbeImageChecksArkConnectivityWithoutGeneratingImage(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks" {
			t.Errorf("request = %s %s", r.Method, r.URL.String())
		}
		if r.URL.Query().Get("page_num") != "1" || r.URL.Query().Get("page_size") != "1" {
			t.Errorf("query = %s", r.URL.RawQuery)
		}
		writeProbeJSON(t, w, map[string]any{})
	}))
	defer server.Close()

	result := New().Probe(context.Background(), application.ProviderProbeRequest{
		Kind: "image", BaseURL: server.URL, APIKey: "test-key", Model: "seedream-model",
		ExtraBody: map[string]any{"size": "2K", "watermark": false},
	})
	if !result.OK || result.Sample == nil || *result.Sample != "Ark API authenticated; image model seedream-model was not invoked" {
		t.Fatalf("probe result = %#v", result)
	}
}

func TestProbeVideoChecksArkConnectivityWithoutCreatingTask(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/contents/generations/tasks" {
			t.Errorf("request = %s %s", r.Method, r.URL.String())
		}
		if r.URL.Query().Get("page_num") != "1" || r.URL.Query().Get("page_size") != "1" {
			t.Errorf("query = %s", r.URL.RawQuery)
		}
		writeProbeJSON(t, w, map[string]any{})
	}))
	defer server.Close()

	result := New().Probe(context.Background(), application.ProviderProbeRequest{
		Kind: "video", BaseURL: server.URL, APIKey: "test-key", Model: "seedance-model",
	})
	if !result.OK || result.Sample == nil || *result.Sample != "Ark video API authenticated; model seedance-model was not invoked" {
		t.Fatalf("probe result = %#v", result)
	}
}

func writeProbeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Errorf("encode response: %v", err)
	}
}
