package router

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/api/http/middleware"
	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/application/contracts"
	"github.com/example/monorepo/iam/internal/bootstrap/config"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/repositories"
	"github.com/example/monorepo/iam/internal/infrastructure/security"
	"github.com/go-chi/chi/v5"
)

type Router struct {
	store *repositories.Store
	cfg   config.Config
	auth  *application.AuthService
	roles *application.RoleService
	org   *application.OrgService
}

func New(store *repositories.Store, cfg config.Config) http.Handler {
	rt := &Router{
		store: store,
		cfg:   cfg,
		auth:  application.NewAuthService(store, cfg),
		roles: application.NewRoleService(store),
		org:   application.NewOrgService(store, cfg),
	}
	r := chi.NewRouter()
	r.Use(middleware.TraceId)
	r.Use(middleware.RequestLogger)
	r.Use(middleware.Recoverer)
	r.Get("/livez", rt.livez)
	r.Get("/readyz", rt.readyz)
	r.Get("/healthz", rt.readyz)
	r.Get("/account-availability", rt.accountAvailability)

	// Auth + session
	r.Post("/register", rt.register)
	r.Post("/login", rt.login)
	r.Post("/refresh", rt.refresh)
	r.Post("/logout", rt.logout)
	r.Get("/me", rt.me)
	r.Get("/me/memberships", rt.listMyMemberships)
	r.Post("/me/memberships/{orgID}/apply", rt.applyMembership)
	r.Post("/session/active-org", rt.switchActiveOrg)

	// Organizations: GET /orgs is the PUBLIC applyable list; everything else is
	// privileged (see gateway public-path config — only GET /orgs is public).
	r.Get("/orgs", rt.listPublicOrgs)
	r.Post("/orgs", rt.createOrg)
	r.Get("/orgs/admin", rt.listOrgsForAdmin)
	r.Post("/orgs/{orgID}/admins", rt.createOrgAdmin)
	r.Put("/orgs/{orgID}/owner", rt.transferOwner)
	r.Get("/orgs/{orgID}/members", rt.listOrgMembers)
	r.Post("/orgs/{orgID}/members/{userID}/approve", rt.approveMember)
	r.Post("/orgs/{orgID}/members/{userID}/reject", rt.rejectMember)
	r.Put("/orgs/{orgID}/members/{userID}/role", rt.setMemberRole)

	// Platform roles (super_admin only)
	r.Get("/roles", rt.listRoles)
	r.Get("/users/{userID}/roles", rt.listUserRoles)
	r.Post("/users/{userID}/roles", rt.assignUserRole)
	r.Delete("/users/{userID}/roles/{roleID}", rt.removeUserRole)
	return r
}

func (rt *Router) livez(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) readyz(w http.ResponseWriter, r *http.Request) {
	if err := rt.store.Ping(r.Context()); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "dependency_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) accountAvailability(w http.ResponseWriter, r *http.Request) {
	account := application.NormalizeAccount(r.URL.Query().Get("account"))
	if !application.ValidAccount(account) {
		writeProblem(w, http.StatusBadRequest, "invalid_account", "account is required and must not contain whitespace or @")
		return
	}
	exists, err := rt.store.UserExistsByAccount(r.Context(), account)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "account_check_failed", "could not check account availability")
		return
	}
	writeJSON(w, http.StatusOK, contracts.AccountAvailabilityResponse{
		Account:   account,
		Available: !exists,
	})
}

func (rt *Router) register(w http.ResponseWriter, r *http.Request) {
	var req contracts.AuthRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.Register(r.Context(), req, application.RequestMetaFromHTTP(r))
	switch {
	case errors.Is(err, application.ErrInvalidRegistration):
		writeProblem(w, http.StatusBadRequest, "invalid_registration", "valid account, email, and password are required")
		return
	case errors.Is(err, application.ErrOrgNotFound):
		writeProblem(w, http.StatusNotFound, "organization_not_found", "the selected organization does not exist")
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

func (rt *Router) login(w http.ResponseWriter, r *http.Request) {
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

func (rt *Router) refresh(w http.ResponseWriter, r *http.Request) {
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

func (rt *Router) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(rt.cfg.RefreshCookieName); err == nil {
		rt.auth.Logout(r.Context(), cookie.Value)
	}
	rt.clearRefreshCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) me(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	user, err := rt.auth.Me(r.Context(), claims.Subject, claims.OrgID)
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_subject", "user is not active")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (rt *Router) listMyMemberships(w http.ResponseWriter, r *http.Request) {
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

func (rt *Router) applyMembership(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	err := rt.org.Apply(r.Context(), chi.URLParam(r, "orgID"), claims.Subject, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrOrgNotFound):
		writeProblem(w, http.StatusNotFound, "organization_not_found", "organization does not exist")
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

func (rt *Router) switchActiveOrg(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	cookie, err := r.Cookie(rt.cfg.RefreshCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_refresh_token", "refresh token is required")
		return
	}
	var req contracts.SwitchOrgRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.SwitchActiveOrg(
		r.Context(), cookie.Value, req.OrgID, claims.Subject,
		application.RequestMetaFromHTTP(r), application.AuditMetaFromHTTP(r, claims.Subject),
	)
	switch {
	case errors.Is(err, application.ErrInvalidOrg):
		writeProblem(w, http.StatusBadRequest, "invalid_org", "orgId is required")
		return
	case errors.Is(err, application.ErrNotActiveMember):
		writeProblem(w, http.StatusForbidden, "not_active_member", "you are not an active member of that organization")
		return
	case errors.Is(err, application.ErrInvalidRefreshToken):
		writeProblem(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token is invalid")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "switch_failed", "could not switch active organization")
		return
	}
	rt.setRefreshCookie(w, refreshToken, refreshExpiresAt)
	writeJSON(w, http.StatusOK, response)
}

func (rt *Router) listPublicOrgs(w http.ResponseWriter, r *http.Request) {
	orgs, err := rt.org.ListPublic(r.Context())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "orgs_failed", "could not list organizations")
		return
	}
	writeJSON(w, http.StatusOK, orgs)
}

func (rt *Router) createOrg(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.CreateOrgRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	view, err := rt.org.Create(r.Context(), req, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrInvalidOrg):
		writeProblem(w, http.StatusBadRequest, "invalid_org", "name, slug, and exactly one owner source are required")
		return
	case errors.Is(err, application.ErrOwnerNotFound):
		writeProblem(w, http.StatusNotFound, "owner_not_found", "the specified owner does not exist")
		return
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "org_conflict", "organization slug or owner account already exists")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "org_failed", "could not create organization")
		return
	}
	writeJSON(w, http.StatusCreated, view)
}

func (rt *Router) listOrgsForAdmin(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.requireSuperAdmin(w, r); !ok {
		return
	}
	orgs, err := rt.org.ListForAdmin(r.Context())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "orgs_failed", "could not list organizations")
		return
	}
	writeJSON(w, http.StatusOK, orgs)
}

func (rt *Router) createOrgAdmin(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.CreateOrgAdminRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	view, err := rt.org.CreateOrgAdmin(r.Context(), chi.URLParam(r, "orgID"), req, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrOrgNotFound):
		writeProblem(w, http.StatusNotFound, "organization_not_found", "organization does not exist")
		return
	case errors.Is(err, application.ErrInvalidRegistration):
		writeProblem(w, http.StatusBadRequest, "invalid_registration", "valid account, email, and password are required")
		return
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "account_or_email_already_registered", "account or email is already registered")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "org_admin_failed", "could not create org admin")
		return
	}
	writeJSON(w, http.StatusCreated, view)
}

func (rt *Router) transferOwner(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.TransferOwnerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	err := rt.org.TransferOwner(r.Context(), chi.URLParam(r, "orgID"), req.NewOwnerUserID, application.AuditMetaFromHTTP(r, claims.Subject))
	switch {
	case errors.Is(err, application.ErrInvalidOrg):
		writeProblem(w, http.StatusBadRequest, "invalid_org", "newOwnerUserId is required")
		return
	case errors.Is(err, application.ErrNotFound):
		writeProblem(w, http.StatusNotFound, "organization_not_found", "organization does not exist")
		return
	case errors.Is(err, application.ErrInvariant):
		writeProblem(w, http.StatusConflict, "owner_transfer_conflict", "the new owner must be a member of this organization")
		return
	case err != nil:
		writeProblem(w, http.StatusInternalServerError, "owner_transfer_failed", "could not transfer ownership")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) listOrgMembers(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "orgID")
	if _, ok := rt.requireOrgViewer(w, r, orgID); !ok {
		return
	}
	members, err := rt.org.ListMembers(r.Context(), orgID, r.URL.Query().Get("status"))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "members_failed", "could not list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (rt *Router) approveMember(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "orgID")
	claims, ok := rt.requireOrgAdmin(w, r, orgID)
	if !ok {
		return
	}
	err := rt.org.Approve(r.Context(), orgID, chi.URLParam(r, "userID"), claims.Subject, application.AuditMetaFromHTTP(r, claims.Subject))
	rt.writeMembershipResult(w, err)
}

func (rt *Router) rejectMember(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "orgID")
	claims, ok := rt.requireOrgAdmin(w, r, orgID)
	if !ok {
		return
	}
	var req contracts.RejectMemberRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	err := rt.org.Reject(r.Context(), orgID, chi.URLParam(r, "userID"), claims.Subject, req.Reason, application.AuditMetaFromHTTP(r, claims.Subject))
	rt.writeMembershipResult(w, err)
}

func (rt *Router) setMemberRole(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "orgID")
	claims, ok := rt.requireOrgAdmin(w, r, orgID)
	if !ok {
		return
	}
	var req contracts.SetMemberRoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	err := rt.org.SetMemberRole(r.Context(), orgID, chi.URLParam(r, "userID"), req.Role, application.AuditMetaFromHTTP(r, claims.Subject))
	if errors.Is(err, application.ErrInvalidRole) {
		writeProblem(w, http.StatusBadRequest, "invalid_role", "role must be org_admin or member")
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
		writeProblem(w, http.StatusConflict, "invariant_violation", "operation would break an organization invariant")
	default:
		writeProblem(w, http.StatusInternalServerError, "member_update_failed", "could not update membership")
	}
}

func (rt *Router) listRoles(w http.ResponseWriter, r *http.Request) {
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

func (rt *Router) listUserRoles(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return
	}
	userID := chi.URLParam(r, "userID")
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

func (rt *Router) assignUserRole(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	var req contracts.AssignRoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := rt.roles.Assign(r.Context(), chi.URLParam(r, "userID"), req.RoleID, application.AuditMetaFromHTTP(r, claims.Subject)); err != nil {
		writeProblem(w, http.StatusBadRequest, "role_assignment_failed", "could not assign role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) removeUserRole(w http.ResponseWriter, r *http.Request) {
	claims, ok := rt.requireSuperAdmin(w, r)
	if !ok {
		return
	}
	err := rt.roles.Remove(r.Context(), chi.URLParam(r, "userID"), chi.URLParam(r, "roleID"), application.AuditMetaFromHTTP(r, claims.Subject))
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

func (rt *Router) claimsFromRequest(w http.ResponseWriter, r *http.Request) (security.Claims, bool) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if raw == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_access_token", "access token is required")
		return security.Claims{}, false
	}
	claims, err := security.VerifyAccessToken(rt.cfg.AccessTokenSecret, raw, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_access_token", "access token is invalid")
		return security.Claims{}, false
	}
	return claims, true
}

func (rt *Router) requireSuperAdmin(w http.ResponseWriter, r *http.Request) (security.Claims, bool) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return security.Claims{}, false
	}
	isSuper, err := rt.roles.IsSuperAdmin(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return security.Claims{}, false
	}
	if !isSuper {
		writeProblem(w, http.StatusForbidden, "forbidden", "super_admin privileges are required")
		return security.Claims{}, false
	}
	return claims, true
}

// requireOrgAdmin authorizes org-membership WRITE operations (approve / reject /
// role change). The actor MUST be an active org_admin of THIS org. A platform
// super_admin is deliberately NOT auto-granted org-admin power here: to act
// inside a tenant it must hold an active org_admin membership there. This
// mirrors GitHub's enterprise-owner model — the platform role is the control
// plane (create org, appoint the first admin, transfer owner, platform roles,
// global apps/telemetry), never a standing god-mode over every tenant's members
// or data. Membership is verified against the DB, never a stale JWT role.
func (rt *Router) requireOrgAdmin(w http.ResponseWriter, r *http.Request, orgID string) (security.Claims, bool) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return security.Claims{}, false
	}
	isAdmin, err := rt.activeOrgAdmin(r.Context(), orgID, claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return security.Claims{}, false
	}
	if !isAdmin {
		writeProblem(w, http.StatusForbidden, "forbidden", "org_admin privileges are required")
		return security.Claims{}, false
	}
	return claims, true
}

// requireOrgViewer authorizes READ access to an org's member roster: a platform
// super_admin (governance/oversight — the enterprise "People" view, e.g. to look
// up a user id for owner transfer or a platform-role grant) OR an active
// org_admin of THIS org. Reading the roster is metadata oversight, not access to
// the org's business data (knowledge/chat/config), which still requires a
// session bound to the org.
func (rt *Router) requireOrgViewer(w http.ResponseWriter, r *http.Request, orgID string) (security.Claims, bool) {
	claims, ok := rt.claimsFromRequest(w, r)
	if !ok {
		return security.Claims{}, false
	}
	isSuper, err := rt.roles.IsSuperAdmin(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return security.Claims{}, false
	}
	if isSuper {
		return claims, true
	}
	isAdmin, err := rt.activeOrgAdmin(r.Context(), orgID, claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "authorization_failed", "could not verify privileges")
		return security.Claims{}, false
	}
	if !isAdmin {
		writeProblem(w, http.StatusForbidden, "forbidden", "org_admin privileges are required")
		return security.Claims{}, false
	}
	return claims, true
}

// activeOrgAdmin reports whether userID is an active org_admin of orgID. A
// missing membership is a clean false, not an error.
func (rt *Router) activeOrgAdmin(ctx context.Context, orgID, userID string) (bool, error) {
	role, status, err := rt.store.MemberRoleStatus(ctx, orgID, userID)
	if err != nil {
		if errors.Is(err, repositories.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return status == "active" && role == "org_admin", nil
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
