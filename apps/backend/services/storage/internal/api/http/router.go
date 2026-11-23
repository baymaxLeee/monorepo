package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/example/monorepo/storage/internal/application"
	"github.com/example/monorepo/storage/internal/domain"
	"github.com/go-chi/chi/v5"
)

const apiVersion = "2026-09-24"

type Router struct {
	service    *application.Service
	readiness  func(context.Context) error
	maxBytes   int64
	signingKey []byte
}

type RouterOptions struct {
	DeliverySigningKey string
}

func NewRouter(service *application.Service, readiness func(context.Context) error, maxBytes int64, options RouterOptions) http.Handler {
	transport := &Router{
		service: service, readiness: readiness, maxBytes: maxBytes,
		signingKey: []byte(options.DeliverySigningKey),
	}
	router := chi.NewRouter()
	router.Get("/livez", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", transport.readinessRoute())
	router.Get("/healthz", transport.readinessRoute())
	router.Put("/upload-sessions/{uploadID}/content", transport.uploadSessionContentRoute())
	router.MethodFunc(http.MethodGet, "/media/{assetID}/revisions/{revisionID}/content", transport.capabilityContentRoute())
	router.MethodFunc(http.MethodHead, "/media/{assetID}/revisions/{revisionID}/content", transport.capabilityContentRoute())
	return router
}

func (router *Router) uploadSessionContentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		uploadID := chi.URLParam(request, "uploadID")
		expires, err := strconv.ParseInt(request.URL.Query().Get("expires"), 10, 64)
		expected := router.signUploadSession(uploadID, expires)
		provided := request.URL.Query().Get("signature")
		if err != nil || time.Now().Unix() >= expires || len(provided) != len(expected) ||
			subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			writeProblem(w, http.StatusForbidden, "forbidden", "invalid or expired upload capability")
			return
		}
		request.Body = http.MaxBytesReader(w, request.Body, router.maxBytes)
		asset, revision, err := router.service.UploadSession(request.Context(), uploadID, request.Body)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, uploadResponse(asset, revision))
	}
}

func UploadSessionURL(signingKey string, session application.UploadSession) string {
	expires := session.ExpiresAt.Unix()
	mac := hmac.New(sha256.New, []byte(signingKey))
	_, _ = fmt.Fprintf(mac, "upload\x00%s\x00%d", session.ID, expires)
	query := url.Values{"expires": {strconv.FormatInt(expires, 10)}, "signature": {fmt.Sprintf("%x", mac.Sum(nil))}}
	return fmt.Sprintf("/api/storage-server/upload-sessions/%s/content?%s", url.PathEscape(session.ID), query.Encode())
}

func (router *Router) signUploadSession(uploadID string, expires int64) string {
	mac := hmac.New(sha256.New, router.signingKey)
	_, _ = fmt.Fprintf(mac, "upload\x00%s\x00%d", uploadID, expires)
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func (router *Router) capabilityContentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		expires, err := strconv.ParseInt(query.Get("expires"), 10, 64)
		if err != nil {
			writeProblem(w, 403, "forbidden", "invalid expiry")
			return
		}
		maxDim := 0
		if raw := query.Get("max_dim"); raw != "" {
			maxDim, err = strconv.Atoi(raw)
			if err != nil || maxDim < 1 || maxDim > 4096 {
				writeProblem(w, 403, "forbidden", "invalid image capability")
				return
			}
		}
		expected := router.signDeliveryVariant(chi.URLParam(request, "assetID"), chi.URLParam(request, "revisionID"), expires, maxDim)
		provided := query.Get("signature")
		if err != nil || time.Now().Unix() >= expires || len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			writeProblem(w, http.StatusForbidden, "forbidden", "invalid or expired delivery capability")
			return
		}
		if maxDim > 0 {
			router.imageVariantRoute()(w, request)
			return
		}
		router.serveContent(w, request)
	}
}

func (router *Router) signDelivery(assetID, revisionID string, expires int64) string {
	mac := hmac.New(sha256.New, router.signingKey)
	_, _ = fmt.Fprintf(mac, "%s\x00%s\x00%d", assetID, revisionID, expires)
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func (router *Router) readinessRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		defer cancel()
		if router.readiness == nil || router.readiness(ctx) != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func uploadResponse(asset domain.Asset, revision domain.Revision) map[string]any {
	return map[string]any{
		"asset_id": asset.ID, "revision_id": revision.ID, "filename": revision.Filename,
		"media_type": revision.MediaType, "size_bytes": revision.SizeBytes, "sha256": revision.SHA256,
	}
}

func (router *Router) serveContent(w http.ResponseWriter, request *http.Request) {
	revision, blob, err := router.service.Open(request.Context(), chi.URLParam(request, "assetID"), chi.URLParam(request, "revisionID"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	defer blob.Body.Close()
	w.Header().Set("Content-Type", revision.MediaType)
	w.Header().Set("ETag", `"sha256:`+revision.SHA256+`"`)
	w.Header().Set("Cache-Control", "private, no-cache")
	if raw := request.URL.Query().Get("expires"); raw != "" {
		expires, _ := strconv.ParseInt(raw, 10, 64)
		w.Header().Set("Cache-Control", fmt.Sprintf("private, max-age=%d, immutable", max(0, expires-time.Now().Unix())))
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(revision.MediaType, ";")[0]))
	if mediaType == "text/html" || mediaType == "application/xhtml+xml" || mediaType == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads")
	}
	disposition := "inline"
	if request.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": revision.Filename}))
	http.ServeContent(w, request, revision.Filename, revision.CreatedAt, blob.Body)
}

func writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, application.ErrInvalidInput):
		writeProblem(w, http.StatusBadRequest, "invalid_request", err.Error())
	case errors.Is(err, application.ErrNotFound):
		writeProblem(w, http.StatusNotFound, "not_found", err.Error())
	case errors.Is(err, application.ErrConflict):
		writeProblem(w, http.StatusConflict, "conflict", err.Error())
	default:
		writeProblem(w, http.StatusInternalServerError, "internal_error", "asset operation failed")
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-API-Version", apiVersion)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": title, "detail": detail, "status": status})
}

func (router *Router) signDeliveryVariant(assetID, revisionID string, expires int64, maxDim int) string {
	if maxDim == 0 {
		return router.signDelivery(assetID, revisionID, expires)
	}
	mac := hmac.New(sha256.New, router.signingKey)
	_, _ = fmt.Fprintf(mac, "image-v2\x00%s\x00%s\x00%d\x00%d", assetID, revisionID, expires, maxDim)
	return fmt.Sprintf("%x", mac.Sum(nil))
}
