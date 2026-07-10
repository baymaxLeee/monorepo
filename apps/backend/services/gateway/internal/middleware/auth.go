package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/gateway/internal/security"
)

const (
	HeaderAuthUserID  = "X-Auth-User-ID"
	HeaderAuthEmail   = "X-Auth-Email"
	HeaderAuthName    = "X-Auth-Name"
	HeaderAuthOrgID   = "X-Auth-Org-ID"
	HeaderAuthOrgRole = "X-Auth-Org-Role"
	HeaderAuthRoles   = "X-Auth-Roles"

	// HeaderInternalToken carries the shared S2S secret between backend
	// services. The gateway is an edge component, not a peer service — it
	// must never accept this header from a client and must never forward a
	// client-supplied value upstream, or an external caller could impersonate
	// trusted S2S traffic on any internal route an upstream fails to gate.
	HeaderInternalToken = "X-Internal-Token"
	HeaderCallerService = "X-Caller-Service"
)

func IdentityPropagation(secret string, publicPathPrefixes, publicExactPaths, optionalAuthPathPrefixes []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Header.Del(HeaderAuthUserID)
			r.Header.Del(HeaderAuthEmail)
			r.Header.Del(HeaderAuthName)
			r.Header.Del(HeaderAuthOrgID)
			r.Header.Del(HeaderAuthOrgRole)
			r.Header.Del(HeaderAuthRoles)
			r.Header.Del(HeaderInternalToken)
			r.Header.Del(HeaderCallerService)

			// Prefix publics cover whole subtrees; method-aware exact publics
			// open a single route (e.g. GET /api/iam-server/orgs) WITHOUT
			// exposing sibling management routes under the same prefix.
			if isPublicPath(r.URL.Path, publicPathPrefixes) || isPublicExact(r.Method, r.URL.Path, publicExactPaths) {
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
	if claims.OrgRole != "" {
		r.Header.Set(HeaderAuthOrgRole, claims.OrgRole)
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

// isPublicExact matches method-aware exact public routes, entries formatted as
// "METHOD /exact/path". Unlike prefix publics it never matches subpaths or a
// different method, so a public GET can coexist with a protected POST/subtree.
func isPublicExact(method, path string, entries []string) bool {
	for _, e := range entries {
		m, p, ok := strings.Cut(strings.TrimSpace(e), " ")
		if !ok {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(m), method) && strings.TrimSpace(p) == path {
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
