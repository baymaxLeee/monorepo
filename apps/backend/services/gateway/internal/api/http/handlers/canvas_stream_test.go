package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type deadlineRecorder struct {
	*httptest.ResponseRecorder
	cleared bool
}

func (w *deadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	w.cleared = deadline.IsZero()
	return nil
}
func TestCanvasEventStreamClearsEdgeWriteDeadline(t *testing.T) {
	for _, tc := range []struct {
		method string
		path   string
		want   bool
	}{
		{http.MethodGet, "/api/canvas-server/projects/p/canvases/c/events", true},
		{http.MethodPost, "/api/canvas-server/projects/p/canvases/c/nodes/n/text-generations:stream", true},
		{http.MethodGet, "/api/canvas-server/projects/p/canvases/c/nodes", false},
	} {
		proxy := &deadlineAwareProxy{service: "canvas-server", externalPrefix: "/api/canvas-server", inner: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })}
		writer := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
		proxy.ServeHTTP(writer, httptest.NewRequest(tc.method, tc.path, nil))
		if writer.cleared != tc.want {
			t.Errorf("%s cleared deadline = %v, want %v", tc.path, writer.cleared, tc.want)
		}
	}
}
