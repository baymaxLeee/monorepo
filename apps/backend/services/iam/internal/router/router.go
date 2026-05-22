package router

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/schema"
	"github.com/example/monorepo/iam/internal/security"
	"github.com/example/monorepo/iam/internal/service"
	"github.com/go-chi/chi/v5"
)

type Router struct {
	store *crud.Store
	cfg   config.Config
	auth  *service.AuthService
	roles *service.RoleService
}

func New(store *crud.Store, cfg config.Config) http.Handler {
	rt := &Router{
		store: store,
		cfg:   cfg,
		auth:  service.NewAuthService(store, cfg),
		roles: service.NewRoleService(store),
	}
	r := chi.NewRouter()
	r.Get("/healthz", rt.healthz)
	r.Route("/v1/auth", func(r chi.Router) {
		r.Post("/register", rt.register)
		r.Post("/login", rt.login)
		r.Post("/refresh", rt.refresh)
		r.Post("/logout", rt.logout)
		r.Get("/me", rt.me)
	})
	r.Route("/v1/iam", func(r chi.Router) {
		r.Get("/roles", rt.listRoles)
		r.Post("/roles", rt.createRole)
		r.Get("/users/{userID}/roles", rt.listUserRoles)
		r.Post("/users/{userID}/roles", rt.assignUserRole)
		r.Delete("/users/{userID}/roles/{roleID}", rt.removeUserRole)
	})
	return r
}

func (rt *Router) healthz(w http.ResponseWriter, r *http.Request) {
	if err := rt.store.Ping(r.Context()); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "dependency_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (rt *Router) register(w http.ResponseWriter, r *http.Request) {
	var req schema.AuthRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.Register(r.Context(), req, service.RequestMetaFromHTTP(r))
	if errors.Is(err, service.ErrInvalidRegistration) {
		writeProblem(w, http.StatusBadRequest, "invalid_registration", "account and password are required")
		return
	}
	if errors.Is(err, service.ErrConflict) {
		writeProblem(w, http.StatusConflict, "email_already_registered", "email is already registered")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "session_failed", "could not create session")
		return
	}
	rt.setRefreshCookie(w, refreshToken, refreshExpiresAt)
	writeJSON(w, http.StatusCreated, response)
}

func (rt *Router) login(w http.ResponseWriter, r *http.Request) {
	var req schema.AuthRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	response, refreshToken, refreshExpiresAt, err := rt.auth.Login(r.Context(), req, service.RequestMetaFromHTTP(r))
	if errors.Is(err, service.ErrInvalidCredentials) {
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
	response, refreshToken, refreshExpiresAt, err := rt.auth.Refresh(r.Context(), cookie.Value, service.RequestMetaFromHTTP(r))
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
	user, err := rt.auth.Me(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_subject", "user is not active")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (rt *Router) listRoles(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.claimsFromRequest(w, r); !ok {
		return
	}
	roles, err := rt.roles.List(r.Context())
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "roles_failed", "could not list roles")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (rt *Router) createRole(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.claimsFromRequest(w, r); !ok {
		return
	}
	var req schema.RoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	role, err := rt.roles.Create(r.Context(), req)
	if errors.Is(err, service.ErrInvalidRole) {
		writeProblem(w, http.StatusBadRequest, "invalid_role", "role name is required and must not contain whitespace")
		return
	}
	if errors.Is(err, service.ErrConflict) {
		writeProblem(w, http.StatusConflict, "role_already_exists", "role name already exists")
		return
	}
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "role_failed", "could not create role")
		return
	}
	writeJSON(w, http.StatusCreated, role)
}

func (rt *Router) listUserRoles(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.claimsFromRequest(w, r); !ok {
		return
	}
	roles, err := rt.roles.ListUserRoles(r.Context(), chi.URLParam(r, "userID"))
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "roles_failed", "could not list user roles")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

func (rt *Router) assignUserRole(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.claimsFromRequest(w, r); !ok {
		return
	}
	var req schema.AssignRoleRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := rt.roles.Assign(r.Context(), chi.URLParam(r, "userID"), req.RoleID); err != nil {
		writeProblem(w, http.StatusBadRequest, "role_assignment_failed", "could not assign role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (rt *Router) removeUserRole(w http.ResponseWriter, r *http.Request) {
	if _, ok := rt.claimsFromRequest(w, r); !ok {
		return
	}
	if err := rt.roles.Remove(r.Context(), chi.URLParam(r, "userID"), chi.URLParam(r, "roleID")); err != nil {
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

func (rt *Router) setRefreshCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     rt.cfg.RefreshCookieName,
		Value:    token,
		Path:     "/v1/auth",
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
		Path:     "/v1/auth",
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
