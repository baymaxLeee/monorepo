package assetclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	applicationassetclaim "github.com/example/monorepo/canvas/internal/application/assetclaim"
)

const callerService = "canvas"

type RevisionRef struct {
	AssetID    string `json:"asset_id"`
	RevisionID string `json:"revision_id"`
}

func (ref RevisionRef) Valid() bool {
	return strings.TrimSpace(ref.AssetID) != "" && strings.TrimSpace(ref.RevisionID) != ""
}

type Revision struct {
	RevisionRef
	Category  string `json:"category"`
	Filename  string `json:"filename"`
	MediaType string `json:"media_type"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
	CreatedBy string `json:"created_by"`
}

type UploadInput struct {
	TenantID, WorkspaceID, UserID string
	Filename, MediaType, Category string
	IdempotencyKey                string
	Body                          io.Reader
}

type DeliveryCapabilityInput struct {
	TenantID    string `json:"tenant_id"`
	WorkspaceID string `json:"workspace_id"`
	RevisionRef
}

type DeliveryCapability struct {
	RevisionRef
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ClaimInput struct {
	TenantID, WorkspaceID string
	OwnerType, OwnerID    string
	Slot                  string
	RevisionRef
	Kind       string
	Generation int64
	ExpiresAt  *time.Time
}

type ClaimMutation struct {
	TenantID, WorkspaceID string
	OwnerType, OwnerID    string
	Slot                  string
	Generation            int64
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func New(baseURL, token string, client *http.Client) *Client {
	if client == nil {
		client = http.DefaultClient
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), token: token, http: client}
}

func (client *Client) Upload(ctx context.Context, input UploadInput) (Revision, error) {
	if strings.TrimSpace(input.TenantID) == "" ||
		strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.Filename) == "" ||
		strings.TrimSpace(input.Category) == "" || strings.TrimSpace(input.IdempotencyKey) == "" || input.Body == nil {
		return Revision{}, errors.New("asset upload requires scope, user, filename, category, idempotency key, and body")
	}
	query := url.Values{
		"tenant_id": {input.TenantID}, "workspace_id": {input.WorkspaceID}, "user_id": {input.UserID},
		"filename": {input.Filename}, "category": {input.Category}, "idempotency_key": {input.IdempotencyKey},
	}
	request, err := client.request(ctx, http.MethodPost, "/internal/assets?"+query.Encode(), input.Body)
	if err != nil {
		return Revision{}, err
	}
	request.Header.Set("Content-Type", contentTypeOrDefault(input.MediaType))
	var result Revision
	if err = client.doJSON(request, http.StatusCreated, &result); err != nil {
		return Revision{}, err
	}
	if !result.Valid() || result.SizeBytes < 0 || strings.TrimSpace(result.SHA256) == "" {
		return Revision{}, errors.New("asset upload returned invalid revision metadata")
	}
	return result, nil
}

func (client *Client) Describe(ctx context.Context, tenantID, workspaceID string, ref RevisionRef) (Revision, error) {
	if strings.TrimSpace(tenantID) == "" || !ref.Valid() {
		return Revision{}, errors.New("asset describe requires scope and revision reference")
	}
	query := url.Values{"tenant_id": {tenantID}, "workspace_id": {workspaceID}}
	request, err := client.request(ctx, http.MethodGet, revisionPath("/internal/assets", ref)+"?"+query.Encode(), nil)
	if err != nil {
		return Revision{}, err
	}
	var result Revision
	if err = client.doJSON(request, http.StatusOK, &result); err != nil {
		return Revision{}, err
	}
	if !result.Valid() || result.RevisionRef != ref {
		return Revision{}, errors.New("asset describe returned mismatched revision identity")
	}
	return result, nil
}

func (client *Client) Open(ctx context.Context, tenantID, workspaceID string, ref RevisionRef) (io.ReadCloser, error) {
	if strings.TrimSpace(tenantID) == "" || !ref.Valid() {
		return nil, errors.New("asset content read requires scope and revision reference")
	}
	query := url.Values{"tenant_id": {tenantID}, "workspace_id": {workspaceID}}
	request, err := client.request(ctx, http.MethodGet, revisionPath("/internal/assets", ref)+"/content?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	response, err := client.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("asset content request: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, responseError(response)
	}
	return response.Body, nil
}

func (client *Client) MintDeliveryCapabilities(ctx context.Context, inputs []DeliveryCapabilityInput) ([]DeliveryCapability, error) {
	if len(inputs) == 0 || len(inputs) > 200 {
		return nil, errors.New("asset delivery capability batch must contain 1 to 200 items")
	}
	for _, input := range inputs {
		if strings.TrimSpace(input.TenantID) == "" || !input.Valid() {
			return nil, errors.New("asset delivery capability requires scope and revision reference")
		}
	}
	body, err := json.Marshal(map[string]any{"items": inputs})
	if err != nil {
		return nil, err
	}
	request, err := client.request(ctx, http.MethodPost, "/internal/delivery-capabilities:mint", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	var result struct {
		Items []DeliveryCapability `json:"items"`
	}
	if err = client.doJSON(request, http.StatusOK, &result); err != nil {
		return nil, err
	}
	if len(result.Items) != len(inputs) {
		return nil, errors.New("asset delivery capability response length mismatch")
	}
	return result.Items, nil
}

func (client *Client) PrepareClaim(ctx context.Context, input ClaimInput) error {
	payload := map[string]any{
		"tenant_id": input.TenantID, "workspace_id": input.WorkspaceID, "owner_type": input.OwnerType,
		"owner_id": input.OwnerID, "slot": input.Slot, "asset_id": input.AssetID,
		"revision_id": input.RevisionID, "kind": input.Kind, "generation": input.Generation,
		"expires_at": input.ExpiresAt,
	}
	return client.postMutation(ctx, "/internal/claims:prepare", payload)
}

func (client *Client) ActivateClaim(ctx context.Context, input ClaimMutation) error {
	return client.mutateClaim(ctx, "/internal/claims:activate", input)
}

func (client *Client) ReleaseClaim(ctx context.Context, input ClaimMutation) error {
	return client.mutateClaim(ctx, "/internal/claims:release", input)
}

func (client *Client) PrepareAssetClaim(ctx context.Context, intent applicationassetclaim.Intent) error {
	return client.PrepareClaim(ctx, ClaimInput{
		TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID, OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot,
		RevisionRef: RevisionRef{AssetID: intent.AssetID, RevisionID: intent.RevisionID}, Kind: intent.Kind, Generation: intent.Generation, ExpiresAt: intent.ExpiresAt,
	})
}

func (client *Client) ActivateAssetClaim(ctx context.Context, intent applicationassetclaim.Intent) error {
	return client.ActivateClaim(ctx, ClaimMutation{TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID, OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot, Generation: intent.Generation})
}

func (client *Client) ReleaseAssetClaimIntent(ctx context.Context, intent applicationassetclaim.Intent) error {
	return client.ReleaseClaim(ctx, ClaimMutation{TenantID: intent.TenantID, WorkspaceID: intent.WorkspaceID, OwnerType: intent.OwnerType, OwnerID: intent.OwnerID, Slot: intent.Slot, Generation: intent.Generation})
}

func (client *Client) mutateClaim(ctx context.Context, endpoint string, input ClaimMutation) error {
	return client.postMutation(ctx, endpoint, map[string]any{
		"tenant_id": input.TenantID, "workspace_id": input.WorkspaceID, "owner_type": input.OwnerType,
		"owner_id": input.OwnerID, "slot": input.Slot, "generation": input.Generation,
	})
}

func (client *Client) postMutation(ctx context.Context, endpoint string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := client.request(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	return client.doJSON(request, http.StatusOK, nil)
}

func (client *Client) request(ctx context.Context, method, target string, body io.Reader) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+target, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Caller-Service", callerService)
	request.Header.Set("X-Internal-Token", client.token)
	return request, nil
}

func (client *Client) doJSON(request *http.Request, expected int, target any) error {
	response, err := client.http.Do(request)
	if err != nil {
		return fmt.Errorf("asset request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != expected {
		return responseError(response)
	}
	if target == nil {
		_, err = io.Copy(io.Discard, response.Body)
		return err
	}
	if err = json.NewDecoder(response.Body).Decode(target); err != nil {
		return fmt.Errorf("decode asset response: %w", err)
	}
	return nil
}

func responseError(response *http.Response) error {
	defer response.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	return fmt.Errorf("asset service returned %d: %s", response.StatusCode, strings.TrimSpace(string(payload)))
}

func revisionPath(prefix string, ref RevisionRef) string {
	return prefix + "/" + url.PathEscape(ref.AssetID) + "/revisions/" + url.PathEscape(ref.RevisionID)
}

func contentTypeOrDefault(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "application/octet-stream"
}
