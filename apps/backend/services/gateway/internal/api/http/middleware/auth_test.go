package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIdentityPropagationAllowsAssetDeliveryCapabilitiesOnly(t *testing.T) {
	t.Parallel()

	handler := IdentityPropagation(
		"secret",
		[]string{"/api/asset-server/media"},
		nil,
		nil,
	)(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))

	tests := []struct {
		name       string
		path       string
		wantStatus int
	}{
		{
			name:       "signed media route reaches asset without bearer token",
			path:       "/api/asset-server/media/asset/revisions/revision/content?expires=1&signature=value",
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "asset control plane remains protected",
			path:       "/api/asset-server/assets",
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}
