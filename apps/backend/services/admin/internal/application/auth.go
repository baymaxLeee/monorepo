package application

import (
	"net/http"
	"strings"
)

type Actor struct {
	UserID, Name, Email, WorkspaceID, TenantID, WorkspaceRole string
	Roles                                                     map[string]bool
}

func ActorFromRequest(r *http.Request) (Actor, error) {
	userID := r.Header.Get("X-Auth-User-ID")
	if userID == "" {
		return Actor{}, NewError(401, "unauthorized", "X-Auth-User-ID header is required")
	}
	roles := map[string]bool{}
	for _, role := range strings.Split(r.Header.Get("X-Auth-Roles"), ",") {
		if role = strings.TrimSpace(role); role != "" {
			roles[role] = true
		}
	}
	name := r.Header.Get("X-Auth-Name")
	if name == "" {
		name = userID
	}
	return Actor{UserID: userID, Name: name, Email: r.Header.Get("X-Auth-Email"), WorkspaceID: r.Header.Get("X-Auth-Workspace-ID"), TenantID: r.Header.Get("X-Auth-Tenant-ID"), WorkspaceRole: r.Header.Get("X-Auth-Workspace-Role"), Roles: roles}, nil
}
func (a Actor) CanWriteWorkspace() bool {
	return a.WorkspaceID != "" && a.WorkspaceRole == "workspace_admin"
}
func (a Actor) IsSuperAdmin() bool { return a.Roles["super_admin"] }
func RequireWorkspaceAdmin(a Actor) error {
	if !a.CanWriteWorkspace() {
		return Forbidden("workspace_admin role required")
	}
	return nil
}
