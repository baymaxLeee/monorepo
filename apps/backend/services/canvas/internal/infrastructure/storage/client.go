package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct{ URL, Token string }

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
		res.Body.Close()
		return nil, fmt.Errorf("storage returned status %d", res.StatusCode)
	}
	return res, nil
}
func (c *Client) Put(ctx context.Context, scope string, body io.Reader) (string, error) {
	res, err := c.request(ctx, "POST", scope, body)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		Key string `json:"key"`
	}
	err = json.NewDecoder(res.Body).Decode(&out)
	return out.Key, err
}
func (c *Client) Get(ctx context.Context, scope, key string) (io.ReadCloser, error) {
	res, err := c.request(ctx, "GET", scope+"/"+key, nil)
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

func (c *Client) Delete(ctx context.Context, scope, key string) error {
	res, err := c.request(ctx, http.MethodDelete, scope+"/"+key, nil)
	if err != nil {
		return err
	}
	return res.Body.Close()
}

func (c *Client) PublicURL(baseURL, scope, key string, expires time.Time) string {
	expiresAt := strconv.FormatInt(expires.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(c.Token))
	_, _ = mac.Write([]byte(scope + "\n" + key + "\n" + expiresAt))
	query := url.Values{"expires": {expiresAt}, "signature": {hex.EncodeToString(mac.Sum(nil))}}
	return strings.TrimRight(baseURL, "/") + "/api/knowledge-server/media/canvas/" + url.PathEscape(scope) + "/" + url.PathEscape(key) + "?" + query.Encode()
}
