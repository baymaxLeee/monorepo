package admin

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/example/monorepo/chat/internal/application"
	adminv1 "github.com/example/monorepo/inner-api-go/gen/admin/v1"
	"google.golang.org/grpc"
)

type pluginClientStub struct {
	response *adminv1.ResolveAgentPluginsResponse
	request  *adminv1.ResolveAgentPluginsRequest
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
