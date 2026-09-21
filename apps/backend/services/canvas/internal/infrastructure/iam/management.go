package iam

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Directory struct{ URL string }

func (d *Directory) ActiveMemberIDs(ctx context.Context, workspaceID, authorization string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(d.URL, "/")+"/workspaces/"+url.PathEscape(workspaceID)+"/members?status=active", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", authorization)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("IAM member lookup returned status %d", response.StatusCode)
	}
	var members []struct {
		UserID string `json:"userId"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(response.Body).Decode(&members); err != nil {
		return nil, err
	}
	result := []string{}
	for _, member := range members {
		if member.Status == "active" {
			result = append(result, member.UserID)
		}
	}
	return result, nil
}
