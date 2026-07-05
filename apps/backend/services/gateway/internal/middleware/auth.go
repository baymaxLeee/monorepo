package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/gateway/internal/security"
)

const (
	HeaderAuthUserID = "X-Auth-User-ID"
	HeaderAuthEmail  = "X-Auth-Email"
	HeaderAuthName   = "X-Auth-Name"
	HeaderAuthOrgID  = "X-Auth-Org-ID"
	HeaderAuthRoles  = "X-Auth-Roles"
)

func IdentityPropagation(secret string, publicPathPrefixes []string, optionalAuthPathPrefixes []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Header.Del(HeaderAuthUserID)
			r.Header.Del(HeaderAuthEmail)
			r.Header.Del(HeaderAuthName)
			r.Header.Del(HeaderAuthOrgID)
			r.Header.Del(HeaderAuthRoles)

			if isPublicPath(r.URL.Path, publicPathPrefixes) {
				next.ServeHTTP(w, r)
				return
			}

			raw := bearerToken(r.Header.Get("Authorization"))
			if isPublicPath(r.URL.Path, optionalAuthPathPrefixes) {
				if raw != "" {
					if claims, err := security.VerifyAccessToken(secret, raw, time.Now().UTC()); err == nil {
						propagateClaims(r, claims)
					}
				}
				next.ServeHTTP(w, r)
				return
			}

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

			propagateClaims(r, claims)
			next.ServeHTTP(w, r)
		})
	}
}

func propagateClaims(r *http.Request, claims security.Claims) {
	r.Header.Set(HeaderAuthUserID, claims.Subject)
	if claims.Email != "" {
		r.Header.Set(HeaderAuthEmail, claims.Email)
	}
	if claims.Name != "" {
		r.Header.Set(HeaderAuthName, claims.Name)
	}
	if claims.OrgID != "" {
		r.Header.Set(HeaderAuthOrgID, claims.OrgID)
	}
	if len(claims.Roles) > 0 {
		r.Header.Set(HeaderAuthRoles, strings.Join(claims.Roles, ","))
	}
}

func bearerToken(header string) string {
	parts := strings.SplitN(strings.TrimSpace(header), " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

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
