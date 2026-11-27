package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/example/monorepo/admin/internal/application"
)

type readyStub struct{}

func (readyStub) Check(context.Context) map[string]error { return map[string]error{} }

func TestGeneratedGinRouterPreservesActionRouteColon(t *testing.T) {
	router := New(
		readyStub{},
		application.ProviderService{},
		application.AppService{},
		application.CanvasSettingsService{},
		application.SkillService{},
		application.BenefitPackageService{},
		application.AgentPluginService{},
	)
	request := httptest.NewRequest(http.MethodPost, "/skills/skill-1/uploads:prepare", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code == http.StatusNotFound || response.Code == http.StatusMethodNotAllowed {
		t.Fatalf("action route was not registered: status = %d", response.Code)
	}
}
