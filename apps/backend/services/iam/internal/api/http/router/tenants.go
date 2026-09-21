package router

import (
	"errors"
	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/application/contracts"
	"net/http"
)

func (rt *Router) listTenants(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.requireSuperAdmin(w, r); !ok {
		return
	}
	rows, err := rt.workspace.ListTenants(r.Context())
	if err != nil {
		writeProblem(w, 500, "tenant_list_failed", "could not list tenants")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}
func (rt *Router) createTenant(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.CreateTenant
	if !decodeJSON(w, r, &req) {
		return
	}
	row, err := rt.workspace.CreateTenant(r.Context(), req, application.AuditMetaFromHTTP(r, claims.Subject))
	if errors.Is(err, application.ErrInvalidWorkspace) {
		writeProblem(w, 400, "invalid_tenant", "name and valid slug are required")
		return
	}
	if err != nil {
		writeProblem(w, 409, "tenant_conflict", "tenant could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, row)
}
