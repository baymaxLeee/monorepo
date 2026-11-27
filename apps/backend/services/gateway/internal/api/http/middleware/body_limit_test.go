package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBodyLimitScopesLargeUploadsToStorage(t *testing.T) {
	next := func(c *gin.Context) {
		w, r := c.Writer, c.Request
		_, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
	handler := testHandler(BodyLimit(4), next)
	for name, testCase := range map[string]struct {
		path string
		want int
	}{
		"ordinary endpoint": {path: "/api/chat-server/messages", want: http.StatusRequestEntityTooLarge},
		"asset upload":      {path: "/api/storage-server/upload-sessions/id/content", want: http.StatusNoContent},
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, testCase.path, strings.NewReader("12345"))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != testCase.want {
				t.Fatalf("status = %d, want %d", response.Code, testCase.want)
			}
		})
	}
}
