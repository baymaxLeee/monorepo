package executor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct{ URL, Token string }
type TextInput struct {
	TenantID    string `json:"tenantId"`
	WorkspaceID string `json:"workspaceId"`
	ProviderID  string `json:"providerId"`
	Prompt      string `json:"prompt"`
}
type Task struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Result struct {
		Text      string `json:"text"`
		ObjectKey string `json:"objectKey"`
		MimeType  string `json:"mimeType"`
	} `json:"result"`
}

func (c *Client) request(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.URL, "/")+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", c.Token)
	req.Header.Set("X-Caller-Service", "canvas")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		res.Body.Close()
		return nil, fmt.Errorf("executor returned status %d", res.StatusCode)
	}
	return res, nil
}
func (c *Client) Start(ctx context.Context, owner, taskType string, input any) (Task, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	res, err := c.request(ctx, "POST", "/tasks", map[string]any{"type": taskType, "owner_service": "canvas", "owner_ref": owner, "payload": input})
	if err != nil {
		return Task{}, err
	}
	defer res.Body.Close()
	var task Task
	err = json.NewDecoder(res.Body).Decode(&task)
	return task, err
}
func taskPath(id, owner string) string {
	return "/tasks/" + url.PathEscape(id) + "?owner_service=canvas&owner_ref=" + url.QueryEscape(owner)
}
func (c *Client) Cancel(ctx context.Context, id, owner string) (Task, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	path := strings.Replace(taskPath(id, owner), "?", "/cancel?", 1)
	res, err := c.request(ctx, "POST", path, nil)
	if err != nil {
		return Task{}, err
	}
	defer res.Body.Close()
	var task Task
	err = json.NewDecoder(res.Body).Decode(&task)
	return task, err
}
func Terminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}
func (c *Client) Watch(ctx context.Context, id, owner string) (Task, error) {
	path := strings.Replace(taskPath(id, owner), "?", "/stream?", 1)
	res, err := c.request(ctx, "GET", path, nil)
	if err != nil {
		return Task{}, err
	}
	defer res.Body.Close()
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 4096), 8<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var frame struct {
			Task Task `json:"task"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &frame); err != nil {
			return Task{}, err
		}
		if Terminal(frame.Task.Status) {
			return frame.Task, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return Task{}, err
	}
	return Task{}, io.ErrUnexpectedEOF
}

func (c *Client) CancelByOwner(ctx context.Context, owner, taskType string) (Task, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	res, err := c.request(ctx, "POST", "/tasks/cancel-by-owner", map[string]string{"owner_service": "canvas", "owner_ref": owner, "type": taskType})
	if err != nil {
		return Task{}, err
	}
	defer res.Body.Close()
	var task Task
	err = json.NewDecoder(res.Body).Decode(&task)
	return task, err
}
