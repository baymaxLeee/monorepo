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

func TestChatStreamsClearEdgeWriteDeadline(t *testing.T) {
	for _, tc := range []struct {
		method string
		path   string
		want   bool
	}{
		{http.MethodPost, "/api/chat-server/conversations/conversation/stream", true},
		{http.MethodPost, "/api/chat-server/local-inference/stream", true},
		{http.MethodGet, "/api/chat-server/local-inference/config", false},
	} {
		proxy := &deadlineAwareProxy{service: "chat-server", externalPrefix: "/api/chat-server", inner: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })}
		writer := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}
		proxy.ServeHTTP(writer, httptest.NewRequest(tc.method, tc.path, nil))
		if writer.cleared != tc.want {
			t.Errorf("%s cleared deadline = %v, want %v", tc.path, writer.cleared, tc.want)
		}
	}
}

func TestUpstreamTransportUsesGatewayDefaultTimeout(t *testing.T) {
	const defaultTimeout = 60 * time.Second
	transport := newUpstreamTransport(defaultTimeout)

	if transport.ResponseHeaderTimeout != defaultTimeout {
		t.Fatalf("response header timeout = %s, want %s", transport.ResponseHeaderTimeout, defaultTimeout)
	}
}

func TestGatewayDefaultTimeoutExcludesLongLivedTransfers(t *testing.T) {
	const defaultTimeout = 60 * time.Second
	for _, tc := range []struct {
		service string
		method  string
		prefix  string
		path    string
		want    bool
	}{
		{"chat-server", http.MethodGet, "/api/chat-server", "/api/chat-server/conversations/c", true},
		{"chat-server", http.MethodPost, "/api/chat-server", "/api/chat-server/conversations/c/stream", false},
		{"chat-server", http.MethodPost, "/api/chat-server", "/api/chat-server/local-inference/stream", false},
		{"canvas-server", http.MethodGet, "/api/canvas-server", "/api/canvas-server/projects/p/canvases/c/events", false},
		{"storage-server", http.MethodPut, "/api/storage-server", "/api/storage-server/uploads/u", false},
	} {
		t.Run(tc.service+tc.path, func(t *testing.T) {
			var gotDeadline bool
			proxy := &deadlineAwareProxy{
				service: tc.service, externalPrefix: tc.prefix, defaultTimeout: defaultTimeout,
				inner: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					_, gotDeadline = r.Context().Deadline()
					w.WriteHeader(http.StatusOK)
				}),
			}
			proxy.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(tc.method, tc.path, nil))
			if gotDeadline != tc.want {
				t.Fatalf("context has deadline = %v, want %v", gotDeadline, tc.want)
			}
		})
	}
}

func TestOrdinaryUpstreamTimeoutReturnsGatewayTimeout(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	proxy := NewServiceProxy(upstream.URL, "iam-server", "/api/iam-server", 10*time.Millisecond)
	recorder := httptest.NewRecorder()

	proxy.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/iam-server/users", nil))

	if recorder.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusGatewayTimeout)
	}
}
