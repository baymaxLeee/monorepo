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

type InferenceParameters struct {
	Temperature     *float64 `json:"temperature"`
	TopP            *float64 `json:"top_p"`
	MaxOutputTokens *int64   `json:"max_tokens"`
	ReasoningEffort *string  `json:"reasoning_effort"`
}
type InferenceSelection struct {
	ProviderID string              `json:"provider_id"`
	Parameters InferenceParameters `json:"parameters"`
}

type CanvasDefaults struct {
	Inference *InferenceSelection `json:"inference"`
	Image     *InferenceSelection `json:"image"`
	Video     *InferenceSelection `json:"video"`
}

func (d *Directory) CanvasDefaults(ctx context.Context, tenantID, workspaceID string) (CanvasDefaults, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(d.URL, "/") + "/internal/canvas/settings?tenant_id=" + url.QueryEscape(tenantID) + "&workspace_id=" + url.QueryEscape(workspaceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return CanvasDefaults{}, err
	}
	req.Header.Set("X-Internal-Token", d.Token)
	req.Header.Set("X-Caller-Service", "canvas")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return CanvasDefaults{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return CanvasDefaults{}, fmt.Errorf("canvas settings returned status %d", res.StatusCode)
	}
	var settings struct {
		Defaults CanvasDefaults `json:"defaults"`
	}
	if err := json.NewDecoder(res.Body).Decode(&settings); err != nil {
		return CanvasDefaults{}, err
	}
	return settings.Defaults, nil
}

func (d *Directory) InferenceDefaults(ctx context.Context, tenantID, workspaceID string) (InferenceSelection, error) {
	defaults, err := d.CanvasDefaults(ctx, tenantID, workspaceID)
	if err != nil {
		return InferenceSelection{}, err
	}
	if defaults.Inference == nil {
		return InferenceSelection{}, nil
	}
	return *defaults.Inference, nil
}
