package handlers

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/example/monorepo/identity/internal/config"
	"github.com/example/monorepo/identity/internal/security"
	"github.com/example/monorepo/identity/internal/store"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	store *store.Store
	cfg   config.Config
}

type authRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Locale      string `json:"locale"`
	Timezone    string `json:"timezone"`
}

type authResponse struct {
	AccessToken string       `json:"accessToken"`
	ExpiresAt   time.Time    `json:"expiresAt"`
	User        userResponse `json:"user"`
}

type userResponse struct {
	ID             string `json:"id"`
	Email          string `json:"email"`
	DisplayName    string `json:"displayName"`
	AvatarURL      string `json:"avatarUrl"`
	Locale         string `json:"locale"`
	Timezone       string `json:"timezone"`
	Theme          string `json:"theme"`
	MarketingOptIn bool   `json:"marketingOptIn"`
	EmailVerified  bool   `json:"emailVerified"`
}

func NewRouter(st *store.Store, cfg config.Config) http.Handler {
	h := &Handler{store: st, cfg: cfg}
	r := chi.NewRouter()
	r.Use(h.cors)
	r.Get("/healthz", h.healthz)
	r.Route("/v1/auth", func(r chi.Router) {
		r.Post("/register", h.register)
		r.Post("/login", h.login)
		r.Post("/refresh", h.refresh)
		r.Post("/logout", h.logout)
		r.Get("/me", h.me)
	})
	return r
}

func (h *Handler) healthz(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Ping(r.Context()); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "dependency_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Email = normalizeEmail(req.Email)
	if !validEmail(req.Email) || len(req.Password) < 8 {
		writeProblem(w, http.StatusBadRequest, "invalid_registration", "email and password are required")
		return
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = strings.Split(req.Email, "@")[0]
	}
	passwordHash, err := security.HashPassword(req.Password)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "password_hash_failed", "could not create credentials")
		return
	}
	user := store.User{
		ID:          newID(),
		Email:       req.Email,
		DisplayName: displayName,
		Locale:      fallback(req.Locale, "zh-CN"),
		Timezone:    fallback(req.Timezone, "Asia/Shanghai"),
		Theme:       "system",
	}
	if err := h.store.CreateUserWithPassword(r.Context(), user, passwordHash); err != nil {
		writeProblem(w, http.StatusConflict, "email_already_registered", "email is already registered")
		return
	}
	h.issueSession(w, r, http.StatusCreated, user)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	email := normalizeEmail(req.Email)
	user, passwordHash, err := h.store.UserByEmail(r.Context(), email)
	if err != nil || !security.VerifyPassword(passwordHash, req.Password) {
		writeProblem(w, http.StatusUnauthorized, "invalid_credentials", "email or password is incorrect")
		return
	}
	_ = h.store.MarkLogin(r.Context(), user.ID)
	h.issueSession(w, r, http.StatusOK, user)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(h.cfg.RefreshCookieName)
	if err != nil || cookie.Value == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_refresh_token", "refresh token is required")
		return
	}
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "refresh_failed", "could not rotate refresh token")
		return
	}
	user, err := h.store.RotateRefreshToken(
		r.Context(),
		security.DigestToken(cookie.Value),
		newID(),
		digest,
		userAgent(r),
		clientIP(r),
		time.Now().UTC().Add(h.cfg.RefreshTokenTTL),
	)
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token is invalid")
		return
	}
	h.setRefreshCookie(w, plain, time.Now().UTC().Add(h.cfg.RefreshTokenTTL))
	h.writeAuthResponse(w, http.StatusOK, user)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(h.cfg.RefreshCookieName); err == nil && cookie.Value != "" {
		_ = h.store.RevokeRefreshToken(r.Context(), security.DigestToken(cookie.Value))
	}
	h.clearRefreshCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	claims, ok := h.claimsFromRequest(w, r)
	if !ok {
		return
	}
	user, err := h.store.UserByID(r.Context(), claims.Subject)
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_subject", "user is not active")
		return
	}
	writeJSON(w, http.StatusOK, toUserResponse(user))
}

func (h *Handler) issueSession(w http.ResponseWriter, r *http.Request, status int, user store.User) {
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "session_failed", "could not create session")
		return
	}
	refreshExpiresAt := time.Now().UTC().Add(h.cfg.RefreshTokenTTL)
	if err := h.store.CreateRefreshToken(r.Context(), newID(), user.ID, digest, userAgent(r), clientIP(r), refreshExpiresAt); err != nil {
		writeProblem(w, http.StatusInternalServerError, "session_failed", "could not persist session")
		return
	}
	h.setRefreshCookie(w, plain, refreshExpiresAt)
	h.writeAuthResponse(w, status, user)
}

func (h *Handler) writeAuthResponse(w http.ResponseWriter, status int, user store.User) {
	expiresAt := time.Now().UTC().Add(h.cfg.AccessTokenTTL)
	token, err := security.SignAccessToken(h.cfg.AccessTokenSecret, security.Claims{
		Subject: user.ID,
		Email:   user.Email,
		Name:    user.DisplayName,
		Issued:  time.Now().UTC().Unix(),
		Expiry:  expiresAt.Unix(),
	})
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "token_sign_failed", "could not sign token")
		return
	}
	writeJSON(w, status, authResponse{AccessToken: token, ExpiresAt: expiresAt, User: toUserResponse(user)})
}

func (h *Handler) claimsFromRequest(w http.ResponseWriter, r *http.Request) (security.Claims, bool) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if raw == "" {
		writeProblem(w, http.StatusUnauthorized, "missing_access_token", "access token is required")
		return security.Claims{}, false
	}
	claims, err := security.VerifyAccessToken(h.cfg.AccessTokenSecret, raw, time.Now().UTC())
	if err != nil {
		writeProblem(w, http.StatusUnauthorized, "invalid_access_token", "access token is invalid")
		return security.Claims{}, false
	}
	return claims, true
}

func (h *Handler) setRefreshCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cfg.RefreshCookieName,
		Value:    token,
		Path:     "/v1/auth",
		Domain:   h.cfg.RefreshCookieDomain,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   h.cfg.RefreshCookieSecure,
		SameSite: sameSite(h.cfg.RefreshCookieSameSite),
	})
}

func (h *Handler) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cfg.RefreshCookieName,
		Value:    "",
		Path:     "/v1/auth",
		Domain:   h.cfg.RefreshCookieDomain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.cfg.RefreshCookieSecure,
		SameSite: sameSite(h.cfg.RefreshCookieSameSite),
	})
}

func (h *Handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == h.cfg.AllowedFrontendOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
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

func toUserResponse(user store.User) userResponse {
	return userResponse{
		ID:             user.ID,
		Email:          user.Email,
		DisplayName:    user.DisplayName,
		AvatarURL:      user.AvatarURL,
		Locale:         user.Locale,
		Timezone:       user.Timezone,
		Theme:          user.Theme,
		MarketingOptIn: user.MarketingOptIn,
		EmailVerified:  user.EmailVerifiedAt.Valid,
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validEmail(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil && strings.Contains(email, "@")
}

func fallback(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func userAgent(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 512 {
		return ua[:512]
	}
	return ua
}

func clientIP(r *http.Request) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(strings.Split(r.Header.Get(header), ",")[0])
		if value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
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

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}
