package application

import (
	"net/http/httptest"
	"testing"
)

func TestActorAndInternalAuthentication(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Auth-User-ID", "user-1")
	r.Header.Set("X-Auth-Workspace-ID", "workspace-1")
	r.Header.Set("X-Auth-Workspace-Role", "workspace_admin")
	r.Header.Set("X-Auth-Roles", "member,super_admin")
	a, err := ActorFromRequest(r)
	if err != nil {
		t.Fatal(err)
	}
	if !a.CanWriteWorkspace() || !a.IsSuperAdmin() {
		t.Fatalf("unexpected actor: %+v", a)
	}
}
