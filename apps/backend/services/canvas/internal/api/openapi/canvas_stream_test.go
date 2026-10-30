package openapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	handler "github.com/example/monorepo/canvas/internal/api/handler"
	app "github.com/example/monorepo/canvas/internal/application/canvas"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	"github.com/go-chi/chi/v5"
)

type streamSource struct {
	observe func(int)
	events  []stream.Event
	err     error
	calls   int
}

func (s *streamSource) Snapshot(context.Context, app.Scope, string, string) (stream.State, error) {
	return stream.State{}, nil
}
func (s *streamSource) Cursor(context.Context, app.Scope, string, string) (int64, error) {
	return 1, nil
}
func (s *streamSource) Events(context.Context, app.Scope, string, string, int64, int) ([]stream.Event, error) {
	s.calls++
	if s.observe != nil {
		s.observe(s.calls)
	}
	return s.events, s.err
}

type failingStreamWriter struct{ *httptest.ResponseRecorder }

func (w *failingStreamWriter) Write([]byte) (int, error) { return 0, errors.New("peer disconnected") }
func TestCanvasStreamInitialFlushAndCleanup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source := &streamSource{}
	nodes := &handler.CanvasNodeHandler{}
	nodes.SetStream(source)
	router := &Router{nodes: nodes}
	request := httptest.NewRequest(http.MethodGet, "/events?cursor=1", nil).WithContext(ctx)
	writer := httptest.NewRecorder()
	if err := router.canvasStream(ctx, writer, request); err != nil {
		t.Fatal(err)
	}
	if !writer.Flushed || !strings.Contains(writer.Body.String(), "event: heartbeat") || strings.Contains(writer.Body.String(), "id:") {
		t.Fatalf("idle handshake: %s", writer.Body.String())
	}
	if source.calls != 1 {
		t.Fatalf("cancelled subscriber kept reading: %d", source.calls)
	}
	source.calls = 0
	if err := router.canvasStream(context.Background(), &failingStreamWriter{httptest.NewRecorder()}, request); err != nil {
		t.Fatal(err)
	}
	if source.calls != 1 {
		t.Fatal("write failure kept polling")
	}
}
func TestCanvasStreamExpiredCursorAndInvalidSubscription(t *testing.T) {
	source := &streamSource{err: stream.ErrCursorExpired}
	nodes := &handler.CanvasNodeHandler{}
	nodes.SetStream(source)
	router := &Router{nodes: nodes}
	request := httptest.NewRequest(http.MethodGet, "/events?cursor=1", nil)
	writer := httptest.NewRecorder()
	if err := router.canvasStream(request.Context(), writer, request); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(writer.Body.String(), "event: canvas.resync_required") {
		t.Fatalf("missing resync: %s", writer.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/events?cursor=0", nil)
	if err := router.canvasStream(request.Context(), httptest.NewRecorder(), request); err == nil {
		t.Fatal("accepted cursor 0")
	}
	// Exercise the actual auth wrapper: missing identity never opens a stream.
	protected := chi.NewRouter()
	protected.Get("/events", router.nodeStreamRoute("GetCanvasGraph", 0, router.canvasStream))
	writer = httptest.NewRecorder()
	protected.ServeHTTP(writer, httptest.NewRequest(http.MethodGet, "/events?cursor=1", nil))
	if writer.Code != http.StatusForbidden || writer.Flushed {
		t.Fatalf("unauthorized subscription: %d", writer.Code)
	}
}

func TestCanvasStreamOversizedDeltaRequestsHTTPSnapshot(t *testing.T) {
	source := &streamSource{events: []stream.Event{{ProtocolVersion: 3, BaseCursor: 1, Cursor: 2, Action: strings.Repeat("x", 16*1024*1024)}}}
	nodes := &handler.CanvasNodeHandler{}
	nodes.SetStream(source)
	router := &Router{nodes: nodes}
	request := httptest.NewRequest(http.MethodGet, "/events?cursor=1", nil)
	writer := httptest.NewRecorder()
	if err := router.canvasStream(request.Context(), writer, request); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(writer.Body.String(), "event: canvas.resync_required") || strings.Contains(writer.Body.String(), "id: 2") {
		t.Fatal("oversized frame must recover via HTTP without acknowledging the cursor")
	}
}

type writeDeadlineProbe struct {
	*httptest.ResponseRecorder
	active bool
}

func (w *writeDeadlineProbe) SetWriteDeadline(deadline time.Time) error {
	w.active = !deadline.IsZero()
	return nil
}
func TestCanvasStreamClearsDeadlineBetweenFrames(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writer := &writeDeadlineProbe{ResponseRecorder: httptest.NewRecorder()}
	source := &streamSource{observe: func(calls int) {
		if calls == 2 {
			if writer.active {
				t.Error("write deadline remained armed while waiting for the next event")
			}
			cancel()
		}
	}}
	nodes := &handler.CanvasNodeHandler{}
	nodes.SetStream(source)
	router := &Router{nodes: nodes}
	request := httptest.NewRequest(http.MethodGet, "/events?cursor=1", nil).WithContext(ctx)
	if err := router.canvasStream(ctx, writer, request); err != nil {
		t.Fatal(err)
	}
}
