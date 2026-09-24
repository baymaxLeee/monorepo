package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/example/monorepo/asset/internal/application"
	"github.com/example/monorepo/asset/internal/domain"
	"github.com/go-chi/chi/v5"
)

const apiVersion = "2026-09-24"

type Router struct {
	service       *application.Service
	readiness     func(context.Context) error
	internalToken map[string]string
	maxBytes      int64
	signingKey    []byte
	deliveryTTL   time.Duration
}

type RouterOptions struct {
	DeliverySigningKey string
	DeliveryURLTTL     time.Duration
}

func NewRouter(service *application.Service, readiness func(context.Context) error, internalTokens map[string]string, maxBytes int64, options RouterOptions) http.Handler {
	deliveryTTL := options.DeliveryURLTTL
	if deliveryTTL <= 0 {
		deliveryTTL = 15 * time.Minute
	}
	transport := &Router{
		service: service, readiness: readiness, internalToken: internalTokens, maxBytes: maxBytes,
		signingKey: []byte(options.DeliverySigningKey), deliveryTTL: deliveryTTL,
	}
	router := chi.NewRouter()
	router.Get("/livez", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	router.Get("/readyz", transport.readinessRoute())
	router.Get("/healthz", transport.readinessRoute())
	router.Put("/upload-sessions/{uploadID}/content", transport.uploadSessionContentRoute())
	router.MethodFunc(http.MethodGet, "/assets/{assetID}/revisions/{revisionID}/content", transport.contentRoute())
	router.MethodFunc(http.MethodHead, "/assets/{assetID}/revisions/{revisionID}/content", transport.contentRoute())
	router.MethodFunc(http.MethodGet, "/media/{assetID}/revisions/{revisionID}/content", transport.capabilityContentRoute())
	router.MethodFunc(http.MethodHead, "/media/{assetID}/revisions/{revisionID}/content", transport.capabilityContentRoute())
	router.Group(func(internal chi.Router) {
		internal.Use(transport.serviceAuthentication)
		internal.Post("/internal/assets", transport.internalUploadRoute())
		internal.Post("/internal/upload-sessions", transport.createUploadSessionRoute())
		internal.Get("/internal/upload-sessions/{uploadID}", transport.describeUploadSessionRoute())
		internal.Get("/internal/assets/{assetID}/revisions/{revisionID}", transport.internalDescribeRoute())
		internal.MethodFunc(http.MethodGet, "/internal/assets/{assetID}/revisions/{revisionID}/content", transport.internalContentRoute())
		internal.MethodFunc(http.MethodHead, "/internal/assets/{assetID}/revisions/{revisionID}/content", transport.internalContentRoute())
		internal.Post("/internal/claims:prepare", transport.prepareClaimRoute())
		internal.Post("/internal/claims:activate", transport.mutateClaimRoute(false))
		internal.Post("/internal/claims:release", transport.mutateClaimRoute(true))
		internal.Post("/internal/delivery-capabilities:mint", transport.mintDeliveryCapabilitiesRoute())
	})
	return router
}

type createUploadSessionRequest struct {
	TenantID    string `json:"tenant_id"`
	WorkspaceID string `json:"workspace_id"`
	UserID      string `json:"user_id"`
	IntentID    string `json:"intent_id"`
	Filename    string `json:"filename"`
	MediaType   string `json:"media_type"`
	Category    string `json:"category"`
	SizeBytes   int64  `json:"size_bytes"`
}

func (router *Router) createUploadSessionRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		var body createUploadSessionRequest
		if err := decodeJSON(request, &body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		session, err := router.service.CreateUploadSession(request.Context(), application.CreateUploadSessionInput{
			TenantID: body.TenantID, WorkspaceID: body.WorkspaceID, UserID: body.UserID,
			CallerService: request.Header.Get("X-Caller-Service"), IdempotencyKey: body.IntentID,
			Filename: body.Filename, MediaType: body.MediaType, Category: body.Category, SizeBytes: body.SizeBytes,
		})
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, router.uploadSessionResponse(session))
	}
}

func (router *Router) describeUploadSessionRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		session, err := router.service.DescribeUploadSession(
			request.Context(), request.Header.Get("X-Caller-Service"), request.URL.Query().Get("tenant_id"),
			request.URL.Query().Get("workspace_id"), chi.URLParam(request, "uploadID"),
		)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, router.uploadSessionResponse(session))
	}
}

func (router *Router) uploadSessionContentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		uploadID := chi.URLParam(request, "uploadID")
		expires, err := strconv.ParseInt(request.URL.Query().Get("expires"), 10, 64)
		expected := router.signUploadSession(uploadID, expires)
		provided := request.URL.Query().Get("signature")
		if err != nil || time.Now().Unix() > expires || len(provided) != len(expected) ||
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

func (router *Router) uploadSessionResponse(session application.UploadSession) map[string]any {
	expires := session.ExpiresAt.Unix()
	query := url.Values{"expires": {strconv.FormatInt(expires, 10)}, "signature": {router.signUploadSession(session.ID, expires)}}
	result := map[string]any{
		"upload_session_id": session.ID, "intent_id": session.IdempotencyKey, "state": session.State,
		"user_id": session.UserID, "category": session.Category, "filename": session.Filename,
		"media_type": session.MediaType, "size_bytes": session.SizeBytes,
		"expires_at": session.ExpiresAt,
		"upload_url": fmt.Sprintf("/api/asset-server/upload-sessions/%s/content?%s", url.PathEscape(session.ID), query.Encode()),
	}
	if session.AssetID != "" && session.RevisionID != "" {
		result["asset_id"] = session.AssetID
		result["revision_id"] = session.RevisionID
	}
	return result
}

func (router *Router) signUploadSession(uploadID string, expires int64) string {
	mac := hmac.New(sha256.New, router.signingKey)
	_, _ = fmt.Fprintf(mac, "upload\x00%s\x00%d", uploadID, expires)
	return fmt.Sprintf("%x", mac.Sum(nil))
}

type deliveryCapabilityItem struct {
	TenantID    string `json:"tenant_id"`
	WorkspaceID string `json:"workspace_id"`
	AssetID     string `json:"asset_id"`
	RevisionID  string `json:"revision_id"`
}
type mintDeliveryCapabilitiesRequest struct {
	Items []deliveryCapabilityItem `json:"items"`
}

func (router *Router) mintDeliveryCapabilitiesRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		if len(router.signingKey) == 0 {
			writeProblem(w, http.StatusServiceUnavailable, "unavailable", "delivery capabilities are not configured")
			return
		}
		var body mintDeliveryCapabilitiesRequest
		if err := decodeJSON(request, &body); err != nil || len(body.Items) == 0 || len(body.Items) > 200 {
			writeProblem(w, http.StatusBadRequest, "invalid_request", "between 1 and 200 items are required")
			return
		}
		expires := time.Now().UTC().Add(router.deliveryTTL).Unix()
		items := make([]map[string]any, 0, len(body.Items))
		for _, item := range body.Items {
			if _, _, err := router.service.Describe(request.Context(), item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID); err != nil {
				writeServiceError(w, err)
				return
			}
			signature := router.signDelivery(item.TenantID, item.WorkspaceID, item.AssetID, item.RevisionID, expires)
			query := url.Values{
				"tenant_id": {item.TenantID}, "workspace_id": {item.WorkspaceID}, "expires": {strconv.FormatInt(expires, 10)}, "signature": {signature},
			}
			path := fmt.Sprintf("/api/asset-server/media/%s/revisions/%s/content?%s", url.PathEscape(item.AssetID), url.PathEscape(item.RevisionID), query.Encode())
			items = append(items, map[string]any{"asset_id": item.AssetID, "revision_id": item.RevisionID, "url": path, "expires_at": time.Unix(expires, 0).UTC()})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func (router *Router) capabilityContentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		tenantID, workspaceID := query.Get("tenant_id"), query.Get("workspace_id")
		expires, err := strconv.ParseInt(query.Get("expires"), 10, 64)
		expected := router.signDelivery(tenantID, workspaceID, chi.URLParam(request, "assetID"), chi.URLParam(request, "revisionID"), expires)
		provided := query.Get("signature")
		if err != nil || time.Now().Unix() > expires || len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			writeProblem(w, http.StatusForbidden, "forbidden", "invalid or expired delivery capability")
			return
		}
		router.serveContent(w, request, tenantID, workspaceID)
	}
}

func (router *Router) signDelivery(tenantID, workspaceID, assetID, revisionID string, expires int64) string {
	mac := hmac.New(sha256.New, router.signingKey)
	_, _ = fmt.Fprintf(mac, "%s\x00%s\x00%s\x00%s\x00%d", tenantID, workspaceID, assetID, revisionID, expires)
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func (router *Router) internalUploadRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		query := request.URL.Query()
		input := application.CreateUploadInput{
			TenantID: strings.TrimSpace(query.Get("tenant_id")), WorkspaceID: strings.TrimSpace(query.Get("workspace_id")),
			UserID: strings.TrimSpace(query.Get("user_id")), Filename: strings.TrimSpace(query.Get("filename")),
			MediaType: strings.TrimSpace(request.Header.Get("Content-Type")), Category: strings.TrimSpace(query.Get("category")),
			CallerService: request.Header.Get("X-Caller-Service"), IdempotencyKey: strings.TrimSpace(query.Get("idempotency_key")),
		}
		request.Body = http.MaxBytesReader(w, request.Body, router.maxBytes)
		asset, revision, err := router.service.Upload(request.Context(), input, request.Body)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, uploadResponse(asset, revision))
	}
}

func (router *Router) internalDescribeRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		tenantID := strings.TrimSpace(request.URL.Query().Get("tenant_id"))
		workspaceID := strings.TrimSpace(request.URL.Query().Get("workspace_id"))
		asset, revision, err := router.service.Describe(request.Context(), tenantID, workspaceID, chi.URLParam(request, "assetID"), chi.URLParam(request, "revisionID"))
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"asset_id": asset.ID, "revision_id": revision.ID, "category": asset.Category,
			"filename": revision.Filename, "media_type": revision.MediaType, "size_bytes": revision.SizeBytes,
			"sha256": revision.SHA256, "created_by": revision.CreatedBy,
		})
	}
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
		"url": fmt.Sprintf("/api/asset-server/assets/%s/revisions/%s/content", asset.ID, revision.ID),
	}
}

func (router *Router) contentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		tenantID, workspaceID, _, ok := identity(request)
		if !ok {
			writeProblem(w, http.StatusUnauthorized, "missing_identity", "authenticated tenant and workspace are required")
			return
		}
		router.serveContent(w, request, tenantID, workspaceID)
	}
}

func (router *Router) internalContentRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		tenantID := strings.TrimSpace(request.URL.Query().Get("tenant_id"))
		workspaceID := strings.TrimSpace(request.URL.Query().Get("workspace_id"))
		if tenantID == "" {
			writeProblem(w, http.StatusBadRequest, "invalid_request", "tenant_id is required")
			return
		}
		router.serveContent(w, request, tenantID, workspaceID)
	}
}

func (router *Router) serveContent(w http.ResponseWriter, request *http.Request, tenantID, workspaceID string) {
	revision, blob, err := router.service.Open(request.Context(), tenantID, workspaceID, chi.URLParam(request, "assetID"), chi.URLParam(request, "revisionID"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	defer blob.Body.Close()
	w.Header().Set("Content-Type", revision.MediaType)
	w.Header().Set("ETag", `"sha256:`+revision.SHA256+`"`)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%s", strconv.Quote(revision.Filename)))
	http.ServeContent(w, request, revision.Filename, revision.CreatedAt, blob.Body)
}

type prepareClaimRequest struct {
	TenantID    string           `json:"tenant_id"`
	WorkspaceID string           `json:"workspace_id"`
	OwnerType   string           `json:"owner_type"`
	OwnerID     string           `json:"owner_id"`
	Slot        string           `json:"slot"`
	AssetID     string           `json:"asset_id"`
	RevisionID  string           `json:"revision_id"`
	Kind        domain.ClaimKind `json:"kind"`
	Generation  int64            `json:"generation"`
	ExpiresAt   *time.Time       `json:"expires_at"`
}

func (router *Router) prepareClaimRoute() http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		var body prepareClaimRequest
		if err := decodeJSON(request, &body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		claim, err := router.service.PrepareClaim(request.Context(), application.PrepareClaimInput{
			TenantID: body.TenantID, WorkspaceID: body.WorkspaceID, OwnerService: request.Header.Get("X-Caller-Service"),
			OwnerType: body.OwnerType, OwnerID: body.OwnerID, Slot: body.Slot, AssetID: body.AssetID, RevisionID: body.RevisionID,
			Kind: body.Kind, Generation: body.Generation, ExpiresAt: body.ExpiresAt,
		})
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, claimResponse(claim))
	}
}

type mutateClaimRequest struct {
	TenantID    string `json:"tenant_id"`
	WorkspaceID string `json:"workspace_id"`
	OwnerType   string `json:"owner_type"`
	OwnerID     string `json:"owner_id"`
	Slot        string `json:"slot"`
	Generation  int64  `json:"generation"`
}

func (router *Router) mutateClaimRoute(release bool) http.HandlerFunc {
	return func(w http.ResponseWriter, request *http.Request) {
		var body mutateClaimRequest
		if err := decodeJSON(request, &body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		input := application.ClaimMutationInput{TenantID: body.TenantID, WorkspaceID: body.WorkspaceID, OwnerService: request.Header.Get("X-Caller-Service"), OwnerType: body.OwnerType, OwnerID: body.OwnerID, Slot: body.Slot, Generation: body.Generation}
		var claim domain.Claim
		var err error
		if release {
			claim, err = router.service.ReleaseClaim(request.Context(), input)
		} else {
			claim, err = router.service.ActivateClaim(request.Context(), input)
		}
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, claimResponse(claim))
	}
}

func (router *Router) serviceAuthentication(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		caller := strings.TrimSpace(request.Header.Get("X-Caller-Service"))
		token := request.Header.Get("X-Internal-Token")
		expected, found := router.internalToken[caller]
		if !found || token == "" || len(token) != len(expected) || subtle.ConstantTimeCompare([]byte(token), []byte(expected)) != 1 {
			writeProblem(w, http.StatusForbidden, "forbidden", "valid service identity is required")
			return
		}
		next.ServeHTTP(w, request)
	})
}

func identity(request *http.Request) (string, string, string, bool) {
	tenantID := strings.TrimSpace(request.Header.Get("X-Auth-Tenant-ID"))
	workspaceID := strings.TrimSpace(request.Header.Get("X-Auth-Workspace-ID"))
	userID := strings.TrimSpace(request.Header.Get("X-Auth-User-ID"))
	return tenantID, workspaceID, userID, tenantID != "" && workspaceID != "" && userID != ""
}

func decodeJSON(request *http.Request, target any) error {
	const maxJSONBodyBytes = 1 << 20
	body, err := io.ReadAll(io.LimitReader(request.Body, maxJSONBodyBytes+1))
	if err != nil {
		return err
	}
	if len(body) > maxJSONBodyBytes {
		return errors.New("request body exceeds 1 MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err = decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

func claimResponse(claim domain.Claim) map[string]any {
	return map[string]any{"claim_id": claim.ID, "asset_id": claim.AssetID, "revision_id": claim.RevisionID, "kind": claim.Kind, "status": claim.Status, "generation": claim.Generation, "expires_at": claim.ExpiresAt}
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
