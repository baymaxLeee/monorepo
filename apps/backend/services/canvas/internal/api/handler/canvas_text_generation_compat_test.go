package http

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationtext "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
)

type legacyTextGenerationService struct {
	states []applicationtext.Session
}

func (s *legacyTextGenerationService) Start(context.Context, applicationcanvas.Scope, string, string, string) (applicationtext.Session, error) {
	return s.states[0], nil
}

func (s *legacyTextGenerationService) Get(context.Context, applicationcanvas.Scope, string, string, string, string) (applicationtext.Session, error) {
	state := s.states[0]
	if len(s.states) > 1 {
		s.states = s.states[1:]
	}
	return state, nil
}

func TestLegacyTextGenerationStreamProjectsDurableCheckpoints(t *testing.T) {
	now := time.Now()
	service := &legacyTextGenerationService{states: []applicationtext.Session{
		{ID: "run", ProjectID: "project", CanvasID: "canvas", NodeID: "node", Status: applicationtext.StatusQueued, CreatedAt: now, UpdatedAt: now},
		{ID: "run", ProjectID: "project", CanvasID: "canvas", NodeID: "node", Status: applicationtext.StatusRunning, Content: "你", CreatedAt: now, UpdatedAt: now},
		{ID: "run", ProjectID: "project", CanvasID: "canvas", NodeID: "node", Status: applicationtext.StatusSucceeded, Content: "你好", CreatedAt: now, UpdatedAt: now},
	}}
	handler := &CanvasNodeHandler{textGenerations: service}
	response := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/projects/project/canvases/canvas/nodes/node/text-generations:stream", nil)

	ctx := requestcontext.WithMetadata(context.Background(), requestcontext.Metadata{
		TenantID: "tenant", UserID: "user", Service: "canvas", Action: "StartCanvasNodeTextGeneration", Version: projectAPIVersion,
	})
	err := handler.StreamLegacyCanvasNodeTextGeneration(ctx, response, request, "project", "canvas", "node", nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.Header().Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	body := response.Body.String()
	for _, expected := range []string{
		"event: session",
		`"task_run_id":"run"`,
		`"status":1`,
		"event: delta\ndata: {\"delta\":\"你\",\"offset\":3}",
		"event: delta\ndata: {\"delta\":\"好\",\"offset\":6}",
		"event: completed\ndata: {\"content\":\"你好\",\"task_run_id\":\"run\"}",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("missing %q in %s", expected, body)
		}
	}
}

func TestLegacyTextGenerationStreamProjectsTerminalFailure(t *testing.T) {
	now := time.Now()
	service := &legacyTextGenerationService{states: []applicationtext.Session{
		{ID: "run", ProjectID: "project", CanvasID: "canvas", NodeID: "node", Status: applicationtext.StatusQueued, CreatedAt: now, UpdatedAt: now},
		{ID: "run", ProjectID: "project", CanvasID: "canvas", NodeID: "node", Status: applicationtext.StatusFailed, Failure: &applicationtext.Failure{Code: "provider_error", Message: "provider failed"}, CreatedAt: now, UpdatedAt: now},
	}}
	handler := &CanvasNodeHandler{textGenerations: service}
	response := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/projects/project/canvases/canvas/nodes/node/text-generations:stream", nil)
	ctx := requestcontext.WithMetadata(context.Background(), requestcontext.Metadata{
		TenantID: "tenant", UserID: "user", Service: "canvas", Action: "StartCanvasNodeTextGeneration", Version: projectAPIVersion,
	})

	if err := handler.StreamLegacyCanvasNodeTextGeneration(ctx, response, request, "project", "canvas", "node", nil); err != nil {
		t.Fatal(err)
	}
	body := response.Body.String()
	for _, expected := range []string{`"status":4`, `"error_code":"provider_error"`, `"error_message":"provider failed"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("missing %q in %s", expected, body)
		}
	}
}
