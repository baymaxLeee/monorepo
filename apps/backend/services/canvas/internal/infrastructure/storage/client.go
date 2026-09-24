package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Client struct{ URL, Token string }

type Artifact struct {
	Namespace   string `json:"namespace"`
	ID          string `json:"artifact_id"`
	ContentType string `json:"content_type"`
}

type PresignedArtifact struct {
	Namespace  string `json:"namespace"`
	ArtifactID string `json:"artifact_id"`
	URL        string `json:"url"`
	ExpiresAt  string `json:"expires_at"`
}

type StoredObject struct {
	ArtifactID string `json:"artifact_id"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
}

func Scope(tenant, workspace, project string) string {
	v := sha256.Sum256([]byte(tenant + "\x00" + workspace + "\x00" + project))
	return hex.EncodeToString(v[:])
}
func (c *Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.URL, "/")+"/internal/objects/"+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Internal-Token", c.Token)
	req.Header.Set("X-Caller-Service", "canvas")
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		if method == http.MethodDelete && res.StatusCode == http.StatusNotFound {
			return res, nil
		}
		res.Body.Close()
		return nil, fmt.Errorf("storage returned status %d", res.StatusCode)
	}
	return res, nil
}
func (c *Client) Put(ctx context.Context, scope string, body io.Reader) (string, error) {
	stored, err := c.PutObject(ctx, scope, body)
	return stored.ArtifactID, err
}

func (c *Client) PutObject(ctx context.Context, scope string, body io.Reader) (StoredObject, error) {
	res, err := c.request(ctx, "POST", scope, body)
	if err != nil {
		return StoredObject{}, err
	}
	defer res.Body.Close()
	var out StoredObject
	err = json.NewDecoder(res.Body).Decode(&out)
	return out, err
}
func (c *Client) Get(ctx context.Context, namespace, artifactID string) (io.ReadCloser, error) {
	res, err := c.request(ctx, "GET", namespace+"/"+artifactID, nil)
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

func (c *Client) Delete(ctx context.Context, namespace, artifactID string) error {
	res, err := c.request(ctx, http.MethodDelete, namespace+"/"+artifactID, nil)
	if err != nil {
		return err
	}
	return res.Body.Close()
}

func (c *Client) BatchPublicURLs(ctx context.Context, artifacts []Artifact) (map[string]PresignedArtifact, error) {
	if len(artifacts) == 0 {
		return map[string]PresignedArtifact{}, nil
	}
	payload, err := json.Marshal(map[string]any{"items": artifacts})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.URL, "/")+"/internal/artifacts/presign", strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Internal-Token", c.Token)
	req.Header.Set("X-Caller-Service", "canvas")
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("artifact presign returned status %d", res.StatusCode)
	}
	var response struct {
		Items []PresignedArtifact `json:"items"`
	}
	if err = json.NewDecoder(res.Body).Decode(&response); err != nil {
		return nil, err
	}
	result := make(map[string]PresignedArtifact, len(response.Items))
	for _, item := range response.Items {
		result[item.Namespace+"\x00"+item.ArtifactID] = item
	}
	return result, nil
}

func ArtifactLookupKey(namespace, artifactID string) string {
	return namespace + "\x00" + artifactID
}
