package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	applicationpackage "github.com/example/monorepo/canvas/internal/application/benefitpackage"
)

type benefitPackageResponse struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	IsPreset         bool     `json:"is_preset"`
	ModelIDs         []string `json:"model_ids"`
	MaterialUsed     int64    `json:"material_used"`
	MaterialReserved int64    `json:"material_reserved"`
	MaterialLimit    *int64   `json:"material_limit"`
}

type reviewReservationResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type reviewedAssetResponse struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	FailureReason string `json:"failure_reason"`
}

type reviewCleanupResponse struct {
	CleanupID     string `json:"cleanup_id"`
	ReservationID string `json:"reservation_id"`
	Status        string `json:"status"`
}

type DependencyError struct {
	Status int
	Detail string
}

func (e *DependencyError) Error() string {
	return fmt.Sprintf("admin benefit package returned status %d: %s", e.Status, e.Detail)
}

func (d *Directory) ListBenefitPackages(ctx context.Context, tenantID, workspaceID string) ([]applicationpackage.BenefitPackage, error) {
	var response []benefitPackageResponse
	if err := d.benefitPackageRequest(ctx, http.MethodGet, "", tenantID, workspaceID, nil, &response); err != nil {
		return nil, err
	}
	items := make([]applicationpackage.BenefitPackage, 0, len(response))
	for _, item := range response {
		items = append(items, applicationpackage.BenefitPackage{ID: item.ID, Name: item.Name, IsPreset: item.IsPreset, ModelIDs: item.ModelIDs})
	}
	return items, nil
}

func (d *Directory) ReserveBenefitPackageReview(ctx context.Context, tenantID, workspaceID, packageID, reservationID, projectID, assetID string) (applicationpackage.ReviewReservation, error) {
	payload := map[string]string{"reservation_id": reservationID, "project_id": projectID, "asset_id": assetID}
	var response reviewReservationResponse
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/review-reservations", tenantID, workspaceID, payload, &response)
	return applicationpackage.ReviewReservation{ID: response.ID, Status: response.Status}, err
}

func (d *Directory) TransitionBenefitPackageReview(ctx context.Context, tenantID, workspaceID, packageID, reservationID, status string) (applicationpackage.ReviewReservation, error) {
	var response reviewReservationResponse
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/review-reservations/"+url.PathEscape(reservationID)+"/"+url.PathEscape(status), tenantID, workspaceID, nil, &response)
	return applicationpackage.ReviewReservation{ID: response.ID, Status: response.Status}, err
}

func (d *Directory) SubmitReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, referenceURL, assetType, name string) (applicationpackage.ReviewedAsset, error) {
	payload := map[string]string{"url": referenceURL, "asset_type": assetType, "name": name}
	var response reviewedAssetResponse
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/reviewed-assets", tenantID, workspaceID, payload, &response)
	return applicationpackage.ReviewedAsset{ID: response.ID, Status: applicationpackage.ProviderAssetStatus(response.Status), FailureReason: response.FailureReason}, err
}

func (d *Directory) GetReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, assetID string) (applicationpackage.ReviewedAsset, error) {
	var response reviewedAssetResponse
	err := d.benefitPackageRequest(ctx, http.MethodGet, "/"+url.PathEscape(packageID)+"/reviewed-assets/"+url.PathEscape(assetID), tenantID, workspaceID, nil, &response)
	return applicationpackage.ReviewedAsset{ID: response.ID, Status: applicationpackage.ProviderAssetStatus(response.Status), FailureReason: response.FailureReason}, err
}

func (d *Directory) BeginBenefitPackageReviewCleanup(ctx context.Context, tenantID, workspaceID, packageID, reservationID, cleanupID string) (applicationpackage.ReviewCleanup, error) {
	payload := map[string]string{"cleanup_id": cleanupID}
	var response reviewCleanupResponse
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/review-cleanups/"+url.PathEscape(reservationID), tenantID, workspaceID, payload, &response)
	return applicationpackage.ReviewCleanup{CleanupID: response.CleanupID, ReservationID: response.ReservationID, Status: response.Status}, err
}

func (d *Directory) CompleteBenefitPackageReviewCleanup(ctx context.Context, tenantID, workspaceID, packageID, reservationID, cleanupID string) (applicationpackage.ReviewCleanup, error) {
	var response reviewCleanupResponse
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/review-cleanups/"+url.PathEscape(reservationID)+"/"+url.PathEscape(cleanupID)+"/complete", tenantID, workspaceID, nil, &response)
	return applicationpackage.ReviewCleanup{CleanupID: response.CleanupID, ReservationID: response.ReservationID, Status: response.Status}, err
}

func (d *Directory) DeleteReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, assetID string) error {
	return d.benefitPackageRequest(ctx, http.MethodDelete, "/"+url.PathEscape(packageID)+"/reviewed-assets/"+url.PathEscape(assetID), tenantID, workspaceID, nil, nil)
}

func (d *Directory) benefitPackageRequest(ctx context.Context, method, path, tenantID, workspaceID string, payload any, output any) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var body bytes.Buffer
	if payload != nil {
		if err := json.NewEncoder(&body).Encode(payload); err != nil {
			return err
		}
	}
	endpoint := strings.TrimRight(d.URL, "/") + "/internal/canvas/benefit-packages" + path +
		"?tenant_id=" + url.QueryEscape(tenantID) + "&workspace_id=" + url.QueryEscape(workspaceID)
	req, err := http.NewRequestWithContext(ctx, method, endpoint, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", d.Token)
	req.Header.Set("X-Caller-Service", "canvas")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var problem struct {
			Detail string `json:"detail"`
		}
		_ = json.NewDecoder(res.Body).Decode(&problem)
		if problem.Detail == "" {
			problem.Detail = http.StatusText(res.StatusCode)
		}
		return &DependencyError{Status: res.StatusCode, Detail: problem.Detail}
	}
	if output == nil || res.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(output)
}
