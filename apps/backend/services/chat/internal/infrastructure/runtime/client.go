package runtime

import (
	"context"
	"net/http"
	"strings"

	"github.com/example/monorepo/chat/internal/application"
)

var forwardedHeaders = []string{
	"traceparent",
	"tracestate",
	"X-Trace-Id",
}

type Client struct {
	baseURL       string
	internalToken string
	httpClient    *http.Client
}

func New(baseURL, internalToken string) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"), internalToken: internalToken,
		httpClient: &http.Client{Transport: transport},
	}
}

func (client *Client) Do(ctx context.Context, request application.RuntimeRequest) (*http.Response, error) {
	upstream, err := http.NewRequestWithContext(ctx, request.Method, client.baseURL+request.Path, request.Body)
	if err != nil {
		return nil, err
	}
	for _, name := range forwardedHeaders {
		if value := request.Headers.Get(name); value != "" {
			upstream.Header.Set(name, value)
		}
	}
	if contentType := request.Headers.Get("Content-Type"); contentType != "" {
		upstream.Header.Set("Content-Type", contentType)
	}
	upstream.Header.Set("X-Caller-Service", "chat")
	upstream.Header.Set("X-Internal-Token", client.internalToken)
	return client.httpClient.Do(upstream)
}
