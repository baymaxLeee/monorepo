package rpcapi

import (
	"testing"

	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
)

func TestAuthorizerUsesExactCallerMethodMatrix(t *testing.T) {
	authorizer := Authorizer()
	allowed := map[string][]string{
		"chat":      {adminv1.ProviderService_GetProvider_FullMethodName, adminv1.ProviderService_GetTaskProvider_FullMethodName, adminv1.ConfigurationService_ListSkills_FullMethodName, adminv1.AgentPluginService_ResolveAgentPlugins_FullMethodName},
		"knowledge": {adminv1.ProviderService_GetProviderByKind_FullMethodName},
		"canvas":    {adminv1.ConfigurationService_GetCanvasSettings_FullMethodName, adminv1.BenefitPackageService_ReserveReview_FullMethodName},
	}
	for caller, methods := range allowed {
		for _, method := range methods {
			if !authorizer.Authorize(caller, method) {
				t.Fatalf("%s was denied %s", caller, method)
			}
		}
	}
	for _, denied := range []struct{ caller, method string }{
		{"runtime", adminv1.ProviderService_GetProvider_FullMethodName},
		{"chat", adminv1.ConfigurationService_GetCanvasSettings_FullMethodName},
		{"chat", adminv1.AgentPluginService_ListAgentPlugins_FullMethodName},
		{"knowledge", adminv1.ProviderService_GetTaskProvider_FullMethodName},
		{"canvas", adminv1.AgentPluginService_ResolveAgentPlugins_FullMethodName},
		{"chat", "/admin.v1.OtherService/GetProvider"},
	} {
		if authorizer.Authorize(denied.caller, denied.method) {
			t.Fatalf("%s was allowed %s", denied.caller, denied.method)
		}
	}
}
