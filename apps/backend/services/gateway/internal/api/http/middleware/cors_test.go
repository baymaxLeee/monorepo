package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCORSCanvasCursor(t *testing.T) {
	handler := CORS([]string{"https://canvas.example"}, false)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Canvas-Cursor", "42")
	}))
	for _, method := range []string{http.MethodOptions, http.MethodPost} {
		req := httptest.NewRequest(method, "/api/canvas-server/projects/p/canvases/c", nil)
		req.Header.Set("Origin", "https://canvas.example")
		req.Header.Set("Access-Control-Request-Headers", "Last-Event-ID")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if !strings.Contains(res.Header().Get("Access-Control-Allow-Headers"), "Last-Event-ID") {
			t.Fatal("cross-origin replay must allow Last-Event-ID")
		}
		if !strings.Contains(res.Header().Get("Access-Control-Expose-Headers"), "X-Canvas-Cursor") {
			t.Fatal("cross-origin command receipts must be readable by the replica")
		}
	}
}
