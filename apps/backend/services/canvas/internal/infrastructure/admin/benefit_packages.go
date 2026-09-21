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
)

type BenefitPackage struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	IsPreset         bool     `json:"is_preset"`
	ModelIDs         []string `json:"model_ids"`
	MaterialUsed     int64    `json:"material_used"`
	MaterialReserved int64    `json:"material_reserved"`
	MaterialLimit    *int64   `json:"material_limit"`
}

type ReviewReservation struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type ReviewedAsset struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	FailureReason string `json:"failure_reason"`
}

type DependencyError struct {
	Status int
	Detail string
}

func (e *DependencyError) Error() string {
	return fmt.Sprintf("admin benefit package returned status %d: %s", e.Status, e.Detail)
}

func (d *Directory) ListBenefitPackages(ctx context.Context, tenantID, workspaceID string) ([]BenefitPackage, error) {
	var packages []BenefitPackage
	err := d.benefitPackageRequest(ctx, http.MethodGet, "", tenantID, workspaceID, nil, &packages)
	return packages, err
}

func (d *Directory) ReserveBenefitPackageReview(ctx context.Context, tenantID, workspaceID, packageID, reservationID, projectID, assetID string) (ReviewReservation, error) {
	payload := map[string]string{"reservation_id": reservationID, "project_id": projectID, "asset_id": assetID}
	var reservation ReviewReservation
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/review-reservations", tenantID, workspaceID, payload, &reservation)
	return reservation, err
}

func (d *Directory) TransitionBenefitPackageReview(ctx context.Context, tenantID, workspaceID, packageID, reservationID, status string) (ReviewReservation, error) {
	var reservation ReviewReservation
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/review-reservations/"+url.PathEscape(reservationID)+"/"+url.PathEscape(status), tenantID, workspaceID, nil, &reservation)
	return reservation, err
}

func (d *Directory) SubmitReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, referenceURL, assetType, name string) (ReviewedAsset, error) {
	payload := map[string]string{"url": referenceURL, "asset_type": assetType, "name": name}
	var asset ReviewedAsset
	err := d.benefitPackageRequest(ctx, http.MethodPost, "/"+url.PathEscape(packageID)+"/reviewed-assets", tenantID, workspaceID, payload, &asset)
	return asset, err
}

func (d *Directory) GetReviewedAsset(ctx context.Context, tenantID, workspaceID, packageID, assetID string) (ReviewedAsset, error) {
	var asset ReviewedAsset
	err := d.benefitPackageRequest(ctx, http.MethodGet, "/"+url.PathEscape(packageID)+"/reviewed-assets/"+url.PathEscape(assetID), tenantID, workspaceID, nil, &asset)
	return asset, err
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
