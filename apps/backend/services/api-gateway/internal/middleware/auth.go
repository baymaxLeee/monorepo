package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/api-gateway/internal/security"
)

// Header names propagated to upstream services. Upstream code MUST treat these
// as the only source of truth for caller identity and MUST ignore any X-Auth-*
// headers it has not received from a trusted gateway path.
const (
	HeaderAuthUserID = "X-Auth-User-ID"
	HeaderAuthEmail  = "X-Auth-Email"
	HeaderAuthName   = "X-Auth-Name"
)

// IdentityPropagation parses the bearer access token, verifies it against the
// shared HS256 secret, and forwards the resulting identity to upstream services
// via X-Auth-* headers.
//
// Behavior:
//   - Inbound X-Auth-* headers are ALWAYS stripped (defense against forgery).
//   - Public paths (login/register/refresh/health) are passed through without
//     requiring or parsing a token.
//   - Protected paths require a valid bearer token; missing/invalid token →
//     401 application/problem+json. Upstream services therefore can trust
//     X-Auth-User-ID without re-validating.
func IdentityPropagation(secret string, publicPathPrefixes []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Header.Del(HeaderAuthUserID)
			r.Header.Del(HeaderAuthEmail)
			r.Header.Del(HeaderAuthName)

			if isPublicPath(r.URL.Path, publicPathPrefixes) {
				next.ServeHTTP(w, r)
				return
			}

			raw := bearerToken(r.Header.Get("Authorization"))
			if raw == "" {
				writeProblem(w, http.StatusUnauthorized,
					"missing_access_token", "access token is required")
				return
			}

			claims, err := security.VerifyAccessToken(secret, raw, time.Now().UTC())
			if err != nil {
				writeProblem(w, http.StatusUnauthorized,
					"invalid_access_token", "access token is invalid")
				return
			}

			r.Header.Set(HeaderAuthUserID, claims.Subject)
			if claims.Email != "" {
				r.Header.Set(HeaderAuthEmail, claims.Email)
			}
			if claims.Name != "" {
				r.Header.Set(HeaderAuthName, claims.Name)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func bearerToken(header string) string {
	parts := strings.SplitN(strings.TrimSpace(header), " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// isPublicPath returns true when the request path matches any configured
// public entry. Each entry is matched as either an exact path or a path
// prefix delimited by "/" — e.g. "/v1/auth/login" matches "/v1/auth/login"
// and "/v1/auth/login/anything", but "/v1/auth/login_other" is NOT matched.
func isPublicPath(path string, prefixes []string) bool {
	for _, p := range prefixes {
		if p == "" {
			continue
		}
		if path == p {
			return true
		}
		if p != "/" && strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":   "about:blank",
		"title":  title,
		"detail": detail,
		"status": status,
	})
}
