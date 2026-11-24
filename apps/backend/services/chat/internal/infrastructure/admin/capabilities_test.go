package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/example/monorepo/chat/internal/application"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	innerruntime "github.com/example/monorepo/inner-api-go/runtime"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type pluginClientStub struct {
	response *adminv1.ResolveAgentPluginsResponse
	request  *adminv1.ResolveAgentPluginsRequest
}

func TestAdminRPCErrorExposesDependencyFailuresWithoutLeakingGRPCDetails(t *testing.T) {
	tests := []struct {
		code       codes.Code
		wantStatus int
		wantCode   string
	}{
		{codes.PermissionDenied, 403, "capability_forbidden"},
		{codes.Unauthenticated, 401, "capability_unauthorized"},
		{codes.Unavailable, 503, "capability_service_unavailable"},
		{codes.DeadlineExceeded, 503, "capability_service_unavailable"},
	}
	for _, test := range tests {
		var applicationError *application.Error
		err := adminRPCError("resolve provider", status.Error(test.code, "sensitive upstream detail"))
		if !errors.As(err, &applicationError) {
			t.Fatalf("%s returned %T, want application error", test.code, err)
		}
		if applicationError.Status != test.wantStatus || applicationError.Code != test.wantCode {
			t.Fatalf("%s mapped to %#v", test.code, applicationError)
		}
		if strings.Contains(applicationError.Message, "sensitive") {
			t.Fatalf("%s leaked upstream detail: %q", test.code, applicationError.Message)
		}
	}
}

func TestAdminRPCErrorMapsOnlyWorkloadIdentityFailuresToBadGateway(t *testing.T) {
	for _, dependencyError := range []error{
		innerruntime.WorkloadAuthenticationError(),
		innerruntime.WorkloadAuthorizationError(),
	} {
		code := status.Code(dependencyError)
		if !innerruntime.IsWorkloadIdentityError(dependencyError) {
			t.Fatalf("test setup returned unmarked %v", code)
		}

		var applicationError *application.Error
		err := adminRPCError("resolve provider", dependencyError)
		if !errors.As(err, &applicationError) {
			t.Fatalf("%s returned %T, want application error", code, err)
		}
		if applicationError.Status != 502 || applicationError.Code != "internal_auth_failed" {
			t.Fatalf("%s mapped to %#v", code, applicationError)
		}
	}
}

func (stub *pluginClientStub) ListAgentPlugins(context.Context, *adminv1.ListAgentPluginsRequest, ...grpc.CallOption) (*adminv1.ListAgentPluginsResponse, error) {
	return &adminv1.ListAgentPluginsResponse{}, nil
}

func (stub *pluginClientStub) ResolveAgentPlugins(_ context.Context, request *adminv1.ResolveAgentPluginsRequest, _ ...grpc.CallOption) (*adminv1.ResolveAgentPluginsResponse, error) {
	stub.request = request
	return stub.response, nil
}

func TestResolvePluginsValidatesBusinessScopeBeforeProjectingRuntimeCapability(t *testing.T) {
	scope := application.AuthContext{
		UserID: "user-1", TenantID: "tenant-1", WorkspaceID: "workspace-1", WorkspaceRole: "member",
	}
	client := &pluginClientStub{response: &adminv1.ResolveAgentPluginsResponse{
		Snapshot: &adminv1.ResolvedAgentPluginSnapshot{TenantId: "other-tenant", WorkspaceId: scope.WorkspaceID},
	}}
	resolver := &CapabilityResolver{plugins: client}

	_, err := resolver.ResolvePlugins(context.Background(), scope, nil)
	if err == nil || !strings.Contains(err.Error(), "another business scope") {
		t.Fatalf("error = %v, want business scope rejection", err)
	}
	if client.request.GetActor().GetUserId() != scope.UserID || client.request.GetActor().GetTenantId() != scope.TenantID || client.request.GetActor().GetWorkspaceId() != scope.WorkspaceID {
		t.Fatalf("Admin actor = %#v", client.request.GetActor())
	}
	if client.request.GetWorkspaceRole() != scope.WorkspaceRole {
		t.Fatalf("workspace role = %q", client.request.GetWorkspaceRole())
	}
}

func TestResolvePluginsProjectsTenantNeutralRuntimeCapability(t *testing.T) {
	scope := application.AuthContext{UserID: "user-1", TenantID: "tenant-1", WorkspaceID: "workspace-1"}
	client := &pluginClientStub{response: &adminv1.ResolveAgentPluginsResponse{
		Snapshot: &adminv1.ResolvedAgentPluginSnapshot{
			SchemaVersion:  1,
			SnapshotId:     "snapshot-1",
			SnapshotDigest: "sha256:" + strings.Repeat("a", 64),
			TenantId:       scope.TenantID,
			WorkspaceId:    scope.WorkspaceID,
		},
	}}
	resolver := &CapabilityResolver{plugins: client}

	capability, err := resolver.ResolvePlugins(context.Background(), scope, nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(capability)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{scope.UserID, scope.TenantID, scope.WorkspaceID, "tenantId", "workspaceId", "userId"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("Runtime capability contains upper-host scope %q: %s", forbidden, encoded)
		}
	}
	if capability["snapshotId"] != "snapshot-1" {
		t.Fatalf("snapshot id = %#v", capability["snapshotId"])
	}
}
