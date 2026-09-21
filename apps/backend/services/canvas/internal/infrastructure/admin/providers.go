package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Provider struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Model        string   `json:"model"`
	ProviderKind string   `json:"provider_kind"`
	Pricing      *Pricing `json:"pricing"`
	IsDefault    bool     `json:"is_default"`
	IsEnabled    bool     `json:"is_enabled"`
}

type Pricing struct {
	Currency        string `json:"currency"`
	Unit            string `json:"unit"`
	UnitPriceMicros int64  `json:"unit_price_micros"`
}

type Directory struct {
	URL   string
	Token string
}

func (d *Directory) List(ctx context.Context, tenantID, workspaceID string) ([]Provider, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	endpoint := strings.TrimRight(d.URL, "/") + "/internal/providers?tenant_id=" + url.QueryEscape(tenantID) +
		"&workspace_id=" + url.QueryEscape(workspaceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Internal-Token", d.Token)
	req.Header.Set("X-Caller-Service", "canvas")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("admin provider catalog returned status %d", response.StatusCode)
	}
	var providers []Provider
	if err := json.NewDecoder(response.Body).Decode(&providers); err != nil {
		return nil, err
	}
	return providers, nil
}
