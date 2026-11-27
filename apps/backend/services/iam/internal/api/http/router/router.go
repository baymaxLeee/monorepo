package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/httpserver-go"
	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/application/contracts"
	"github.com/gin-gonic/gin"
)

type Config struct {
	RefreshCookieName     string
	RefreshCookieDomain   string
	RefreshCookieSecure   bool
	RefreshCookieSameSite string
}

type Claims struct {
	TenantID, Subject, Email, Name, WorkspaceID, WorkspaceRole string
	Roles                                                      []string
}

type Store interface {
	Ping(context.Context) error
	MemberRoleStatus(context.Context, string, string) (string, string, error)
}

type Dependencies struct {
	Store      Store
	Config     Config
	Auth       *application.AuthService
	Roles      *application.RoleService
	Workspace  *application.WorkspaceService
	Verify     func(string, time.Time) (Claims, error)
	IsNotFound func(error) bool
}

type Router struct {
	store     Store
	cfg       Config
	auth      *application.AuthService
	roles     *application.RoleService
	workspace *application.WorkspaceService
	verify    func(string, time.Time) (Claims, error)
	notFound  func(error) bool
}

func New(deps Dependencies) http.Handler {
	rt := &Router{
		store: deps.Store, cfg: deps.Config, auth: deps.Auth, roles: deps.Roles, workspace: deps.Workspace,
		verify: deps.Verify, notFound: deps.IsNotFound,
	}
	r := httpserver.New("iam")
	r.GET("/livez", rt.livez)
	r.GET("/readyz", rt.readyz)
	r.GET("/healthz", rt.readyz)
	r.GET("/account-availability", rt.accountAvailability)

	// Auth + session
	r.POST("/register", rt.register)
	r.POST("/login", rt.login)
	r.POST("/refresh", rt.refresh)
	r.POST("/logout", rt.logout)
	r.GET("/me", rt.me)
	r.GET("/me/memberships", rt.listMyMemberships)
	r.POST("/me/memberships/:workspaceID/apply", rt.applyMembership)
	r.POST("/session/active-workspace", rt.switchActiveWorkspace)

	// Workspaces: GET /workspaces is the PUBLIC applyable list; everything else is
	// privileged (see gateway public-path config — only GET /workspaces is public).
	r.GET("/tenants", rt.listTenants)
	r.POST("/tenants", rt.createTenant)
	r.GET("/workspaces", rt.listPublicWorkspaces)
	r.POST("/workspaces", rt.createWorkspace)
	r.GET("/workspaces/admin", rt.listWorkspacesForAdmin)
	r.POST("/workspaces/:workspaceID/admins", rt.createWorkspaceAdmin)
	r.PUT("/workspaces/:workspaceID/owner", rt.transferOwner)
	r.GET("/workspaces/:workspaceID/members", rt.listWorkspaceMembers)
	r.POST("/workspaces/:workspaceID/members/:userID/approve", rt.approveMember)
	r.POST("/workspaces/:workspaceID/members/:userID/reject", rt.rejectMember)
	r.PUT("/workspaces/:workspaceID/members/:userID/role", rt.setMemberRole)

	// Platform roles (super_admin only)
	r.GET("/roles", rt.listRoles)
	r.GET("/users/:userID/roles", rt.listUserRoles)
	r.POST("/users/:userID/roles", rt.assignUserRole)
	r.DELETE("/users/:userID/roles/:roleID", rt.removeUserRole)
	return r
}

func (rt *Router) livez(c *gin.Context) {
	w := c.Writer
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) readyz(c *gin.Context) {
	w, r := c.Writer, c.Request
	if err := rt.store.Ping(r.Context()); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "dependency_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) accountAvailability(c *gin.Context) {
	w, r := c.Writer, c.Request
	account, available, err := rt.auth.AccountAvailability(r.Context(), r.URL.Query().Get("account"))
	if errors.Is(err, application.ErrInvalidAccount) {
		writeProblem(w, http.StatusBadRequest, "invalid_account", "account is required and must not contain whitespace or @")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "account_check_failed", "could not check account availability")
		return
	}
	writeJSON(w, http.StatusOK, contracts.AccountAvailabilityResponse{
		Account:   account,
		Available: available,
	})
}

func (rt *Router) register(c *gin.Context) {
	w, r := c.Writer, c.Request
	var req contracts.AuthRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.Register(r.Context(), req, application.RequestMetaFromHTTP(r))
	switch {
	case errors.Is(err, application.ErrInvalidRegistration):
		writeProblem(w, http.StatusBadRequest, "invalid_registration", "valid account, email, and password are required")
		return
	case errors.Is(err, application.ErrWorkspaceNotFound):
		writeProblem(w, http.StatusNotFound, "workspace_not_found", "the selected workspace does not exist")
		return
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "account_or_email_already_registered", "account or email is already registered")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "session_failed", "could not create session")
		return
	}
	rt.setRefreshCookie(w, refreshToken, refreshExpiresAt)
	writeJSON(w, http.StatusCreated, response)
}

func (rt *Router) login(c *gin.Context) {
	w, r := c.Writer, c.Request
	var req contracts.AuthRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.Login(r.Context(), req, application.RequestMetaFromHTTP(r))
	if errors.Is(err, application.ErrInvalidCredentials) {
		writeProblem(w, http.StatusUnauthorized, "invalid_credentials", "account or password is incorrect")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "session_failed", "could not create session")
		return
	}
	rt.setRefreshCookie(w, refreshToken, refreshExpiresAt)
	writeJSON(w, http.StatusOK, response)
}

func (rt *Router) refresh(c *gin.Context) {
	w, r := c.Writer, c.Request
	cookie, err := r.Cookie(rt.cfg.RefreshCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_refresh_token", "refresh token is required")
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.Refresh(r.Context(), cookie.Value, application.RequestMetaFromHTTP(r))
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token is invalid")
		return
	}
	rt.setRefreshCookie(w, refreshToken, refreshExpiresAt)
	writeJSON(w, http.StatusOK, response)
}

func (rt *Router) logout(c *gin.Context) {
	w, r := c.Writer, c.Request
	if cookie, err := r.Cookie(rt.cfg.RefreshCookieName); err == nil {
		if err = rt.auth.Logout(r.Context(), cookie.Value); err != nil {
			writeProblem(w, http.StatusInternalServerError, "logout_failed", "could not revoke session")
			return
		}
	}
	rt.clearRefreshCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) me(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	user, err := rt.auth.Me(r.Context(), claims.Subject, claims.WorkspaceID)
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_subject", "user is not active")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (rt *Router) listMyMemberships(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	memberships, err := rt.auth.Memberships(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "memberships_failed", "could not list memberships")
		return
	}
	writeJSON(w, http.StatusOK, memberships)
}

func (rt *Router) applyMembership(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	err := rt.workspace.Apply(r.Context(), c.Param("workspaceID"), claims.Subject, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrWorkspaceNotFound):
		writeProblem(w, http.StatusNotFound, "workspace_not_found", "workspace does not exist")
		return
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "already_applied", "an active or pending membership already exists")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "apply_failed", "could not apply")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) switchActiveWorkspace(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	cookie, err := r.Cookie(rt.cfg.RefreshCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_refresh_token", "refresh token is required")
		return
	}
	var req contracts.SwitchWorkspaceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.SwitchActiveWorkspace(
		r.Context(), cookie.Value, req.WorkspaceID, claims.Subject,
		application.RequestMetaFromHTTP(r), application.AuditMetaFromHTTP(r, claims.Subject),
	)
	switch {
	case errors.Is(err, application.ErrInvalidWorkspace):
		writeProblem(w, http.StatusBadRequest, "invalid_workspace", "workspaceId is required")
		return
	case errors.Is(err, application.ErrNotActiveMember):
		writeProblem(w, http.StatusForbidden, "not_active_member", "you are not an active member of that workspace")
		return
	case errors.Is(err, application.ErrInvalidRefreshToken):
		writeProblem(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token is invalid")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "switch_failed", "could not switch active workspace")
		return
	}
	rt.setRefreshCookie(w, refreshToken, refreshExpiresAt)
	writeJSON(w, http.StatusOK, response)
}

func (rt *Router) listPublicWorkspaces(c *gin.Context) {
	w, r := c.Writer, c.Request
	workspaces, err := rt.workspace.ListPublic(r.Context())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "workspaces_failed", "could not list workspaces")
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func (rt *Router) createWorkspace(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.CreateWorkspaceRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	view, err := rt.workspace.Create(r.Context(), req, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrInvalidWorkspace):
		writeProblem(w, http.StatusBadRequest, "invalid_workspace", "name, slug, and exactly one owner source are required")
		return
	case errors.Is(err, application.ErrOwnerNotFound):
		writeProblem(w, http.StatusNotFound, "owner_not_found", "the specified owner does not exist")
		return
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "workspace_conflict", "workspace slug or owner account already exists")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "workspace_failed", "could not create workspace")
		return
	}
	writeJSON(w, http.StatusCreated, view)
}

func (rt *Router) listWorkspacesForAdmin(c *gin.Context) {
	w, r := c.Writer, c.Request
	if _, ok := rt.requireSuperAdmin(w, r); !ok {
		return
	}
	workspaces, err := rt.workspace.ListForAdmin(r.Context())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "workspaces_failed", "could not list workspaces")
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func (rt *Router) createWorkspaceAdmin(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.CreateWorkspaceAdminRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	view, err := rt.workspace.CreateWorkspaceAdmin(r.Context(), c.Param("workspaceID"), req, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrWorkspaceNotFound):
		writeProblem(w, http.StatusNotFound, "workspace_not_found", "workspace does not exist")
		return
	case errors.Is(err, application.ErrInvalidRegistration):
		writeProblem(w, http.StatusBadRequest, "invalid_registration", "valid account, email, and password are required")
		return
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "account_or_email_already_registered", "account or email is already registered")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "workspace_admin_failed", "could not create workspace admin")
		return
	}
	writeJSON(w, http.StatusCreated, view)
}

func (rt *Router) transferOwner(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.TransferOwnerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	err := rt.workspace.TransferOwner(r.Context(), c.Param("workspaceID"), req.NewOwnerUserID, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrInvalidWorkspace):
		writeProblem(w, http.StatusBadRequest, "invalid_workspace", "newOwnerUserId is required")
		return
	case errors.Is(err, application.ErrNotFound):
		writeProblem(w, http.StatusNotFound, "workspace_not_found", "workspace does not exist")
		return
	case errors.Is(err, application.ErrInvariant):
		writeProblem(w, http.StatusConflict, "owner_transfer_conflict", "the new owner must be a member of this workspace")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "owner_transfer_failed", "could not transfer ownership")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) listWorkspaceMembers(c *gin.Context) {
	w, r := c.Writer, c.Request
	workspaceID := c.Param("workspaceID")
	if _, ok := rt.requireWorkspaceViewer(w, r, workspaceID); !ok {
		return
	}
	members, err := rt.workspace.ListMembers(r.Context(), workspaceID, r.URL.Query().Get("status"))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "members_failed", "could not list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (rt *Router) approveMember(c *gin.Context) {
	w, r := c.Writer, c.Request
	workspaceID := c.Param("workspaceID")
	claims, ok := rt.requireWorkspaceAdmin(w, r, workspaceID)
	if !ok {
		return
	}
	err := rt.workspace.Approve(r.Context(), workspaceID, c.Param("userID"), claims.Subject, application.AuditMetaFromHTTP(r, claims.Subject))
	rt.writeMembershipResult(w, err)
}

func (rt *Router) rejectMember(c *gin.Context) {
	w, r := c.Writer, c.Request
	workspaceID := c.Param("workspaceID")
	claims, ok := rt.requireWorkspaceAdmin(w, r, workspaceID)
	if !ok {
		return
	}
	var req contracts.RejectMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	err := rt.workspace.Reject(r.Context(), workspaceID, c.Param("userID"), claims.Subject, req.Reason, application.AuditMetaFromHTTP(r, claims.Subject))
	rt.writeMembershipResult(w, err)
}

func (rt *Router) setMemberRole(c *gin.Context) {
	w, r := c.Writer, c.Request
	workspaceID := c.Param("workspaceID")
	claims, ok := rt.requireWorkspaceAdmin(w, r, workspaceID)
	if !ok {
		return
	}
	var req contracts.SetMemberRoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	err := rt.workspace.SetMemberRole(r.Context(), workspaceID, c.Param("userID"), req.Role, application.AuditMetaFromHTTP(r, claims.Subject))
	if errors.Is(err, application.ErrInvalidRole) {
		writeProblem(w, http.StatusBadRequest, "invalid_role", "role must be workspace_admin or member")
		return
	}
	rt.writeMembershipResult(w, err)
}

// writeMembershipResult maps the shared membership-transition errors to HTTP.
func (rt *Router) writeMembershipResult(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, application.ErrNotFound):
		writeProblem(w, http.StatusNotFound, "member_not_found", "membership not found")
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "member_state_conflict", "membership is not in the expected state")
	case errors.Is(err, application.ErrInvariant):
		writeProblem(w, http.StatusConflict, "invariant_violation", "operation would break an workspace invariant")
	default:
		writeProblem(w, http.StatusInternalServerError, "member_update_failed", "could not update membership")
	}
}

func (rt *Router) listRoles(c *gin.Context) {
	w, r := c.Writer, c.Request
	if _, ok := rt.requireSuperAdmin(w, r); !ok {
		return
	}
	roles, err := rt.roles.List(r.Context())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "roles_failed", "could not list roles")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (rt *Router) listUserRoles(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	userID := c.Param("userID")
	if userID != claims.Subject {
		isSuper, err := rt.roles.IsSuperAdmin(r.Context(), claims.Subject)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
			return
		}
		if !isSuper {
			writeProblem(w, http.StatusForbidden, "forbidden", "super_admin privileges are required")
			return
		}
	}
	roles, err := rt.roles.ListUserRoles(r.Context(), userID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "roles_failed", "could not list user roles")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (rt *Router) assignUserRole(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.AssignRoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := rt.roles.Assign(r.Context(), c.Param("userID"), req.RoleID, application.AuditMetaFromHTTP(r, claims.Subject)); err != nil {
		writeProblem(w, http.StatusBadRequest, "role_assignment_failed", "could not assign role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) removeUserRole(c *gin.Context) {
	w, r := c.Writer, c.Request
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	err := rt.roles.Remove(r.Context(), c.Param("userID"), c.Param("roleID"), application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrLastSuperAdmin):
		writeProblem(w, http.StatusConflict, "last_super_admin", "cannot revoke the last super_admin")
		return
	case err != nil:
		writeProblem(w, http.StatusNotFound, "role_assignment_not_found", "role assignment not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) claimsFromRequest(w http.ResponseWriter, r *http.Request) (Claims, bool) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if raw == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_access_token", "access token is required")
		return Claims{}, false
	}
	claims, err := rt.verify(raw, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_access_token", "access token is invalid")
		return Claims{}, false
	}
	return claims, true
}

func (rt *Router) requireSuperAdmin(w http.ResponseWriter, r *http.Request) (Claims, bool) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return Claims{}, false
	}
	isSuper, err := rt.roles.IsSuperAdmin(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return Claims{}, false
	}
	if !isSuper {
		writeProblem(w, http.StatusForbidden, "forbidden", "super_admin privileges are required")
		return Claims{}, false
	}
	return claims, true
}

// requireWorkspaceAdmin authorizes workspace-membership WRITE operations (approve / reject /
// role change). The actor MUST be an active workspace_admin of THIS workspace. A platform
// super_admin is deliberately NOT auto-granted workspace-admin power here: to act
// inside a tenant it must hold an active workspace_admin membership there. This
// mirrors GitHub's enterprise-owner model — the platform role is the control
// plane (create workspace, appoint the first admin, transfer owner, platform roles,
// global apps/telemetry), never a standing god-mode over every tenant's members
// or data. Membership is verified against the DB, never a stale JWT role.
func (rt *Router) requireWorkspaceAdmin(w http.ResponseWriter, r *http.Request, workspaceID string) (Claims, bool) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return Claims{}, false
	}
	isAdmin, err := rt.activeWorkspaceAdmin(r.Context(), workspaceID, claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return Claims{}, false
	}
	if !isAdmin {
		writeProblem(w, http.StatusForbidden, "forbidden", "workspace_admin privileges are required")
		return Claims{}, false
	}
	return claims, true
}

// requireWorkspaceViewer authorizes READ access to an workspace's member roster: a platform
// super_admin (governance/oversight — the enterprise "People" view, e.g. to look
// up a user id for owner transfer or a platform-role grant) OR an active
// workspace_admin of THIS workspace. Reading the roster is metadata oversight, not access to
// the workspace's business data (knowledge/chat/config), which still requires a
// session bound to the workspace.
func (rt *Router) requireWorkspaceViewer(w http.ResponseWriter, r *http.Request, workspaceID string) (Claims, bool) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return Claims{}, false
	}
	isSuper, err := rt.roles.IsSuperAdmin(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return Claims{}, false
	}
	if isSuper {
		return claims, true
	}
	isAdmin, err := rt.activeWorkspaceAdmin(r.Context(), workspaceID, claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return Claims{}, false
	}
	if !isAdmin {
		writeProblem(w, http.StatusForbidden, "forbidden", "workspace_admin privileges are required")
		return Claims{}, false
	}
	return claims, true
}

// activeWorkspaceAdmin reports whether userID is an active workspace_admin of workspaceID. A
// missing membership is a clean false, not an error.
func (rt *Router) activeWorkspaceAdmin(ctx context.Context, workspaceID, userID string) (bool, error) {
	role, status, err := rt.store.MemberRoleStatus(ctx, workspaceID, userID)
	if err != nil {
		if rt.notFound(err) {
			return false, nil
		}
		return false, err
	}
	return status == "active" && role == "workspace_admin", nil
}

func (rt *Router) setRefreshCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     rt.cfg.RefreshCookieName,
		Value:    token,
		Path:     "/api/iam-server",
		Domain:   rt.cfg.RefreshCookieDomain,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   rt.cfg.RefreshCookieSecure,
		SameSite: sameSite(rt.cfg.RefreshCookieSameSite),
	})
}

func (rt *Router) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     rt.cfg.RefreshCookieName,
		Value:    "",
		Path:     "/api/iam-server",
		Domain:   rt.cfg.RefreshCookieDomain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   rt.cfg.RefreshCookieSecure,
		SameSite: sameSite(rt.cfg.RefreshCookieSameSite),
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, out any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(out); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	writeJSON(w, status, map[string]any{
		"type":   "about:blank",
		"title":  title,
		"detail": detail,
		"status": status,
	})
}

func sameSite(value string) http.SameSite {
	switch strings.ToLower(value) {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}
