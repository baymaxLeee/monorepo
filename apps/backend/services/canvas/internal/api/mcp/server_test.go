package mcpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	applicationprojectaccess "github.com/example/monorepo/canvas/internal/application/projectaccess"
	"github.com/example/monorepo/canvas/internal/application/requestcontext"
	officialmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

var trustedHeaders = map[string]string{
	"X-Caller-Service":        "runtime",
	"X-Internal-Token":        "test-runtime-internal-token",
	"X-Auth-User-ID":          "user",
	"X-Auth-Tenant-ID":        "tenant",
	"X-Auth-Workspace-ID":     "workspace",
	"X-Auth-Workspace-Role":   "member",
	"X-Project-ID":            "project",
	"X-Canvas-ID":             "canvas",
	"X-Runtime-Turn-ID":       "run",
	"X-Runtime-Attempt-Epoch": "1",
}

func init() {
	values := []string{
		"v1", "canvas", trustedHeaders["X-Runtime-Turn-ID"], trustedHeaders["X-Runtime-Attempt-Epoch"],
		trustedHeaders["X-Auth-User-ID"], trustedHeaders["X-Auth-Tenant-ID"],
		trustedHeaders["X-Auth-Workspace-ID"], trustedHeaders["X-Auth-Workspace-Role"],
		trustedHeaders["X-Project-ID"], trustedHeaders["X-Canvas-ID"],
	}
	mac := hmac.New(sha256.New, []byte(trustedHeaders["X-Internal-Token"]))
	_, _ = mac.Write([]byte(strings.Join(values, "\n")))
	trustedHeaders["X-Runtime-Scope-Credential"] = "v1." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

type headerTransport struct {
	headers map[string]string
}

func (transport headerTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	for key, value := range transport.headers {
		request.Header.Set(key, value)
	}
	return http.DefaultTransport.RoundTrip(request)
}

type fakeAccess struct {
	err      error
	metadata requestcontext.Metadata
	args     []any
}

func (checker *fakeAccess) Check(
	ctx context.Context,
	tenantID string,
	workspaceID *string,
	userID string,
	projectID string,
	access applicationprojectaccess.Access,
) error {
	checker.metadata, _ = requestcontext.MetadataFromContext(ctx)
	checker.args = []any{tenantID, *workspaceID, userID, projectID, access}
	return checker.err
}

type fakeGraph struct {
	mu       sync.Mutex
	request  *contractcanvasnode.GetCanvasGraphRequest
	started  chan struct{}
	canceled chan struct{}
}

func (graph *fakeGraph) GetCanvasGraph(
	ctx context.Context,
	request *contractcanvasnode.GetCanvasGraphRequest,
) (*contractcanvasnode.GetCanvasGraphResponse, error) {
	graph.mu.Lock()
	graph.request = request
	graph.mu.Unlock()
	if graph.started != nil {
		close(graph.started)
		<-ctx.Done()
		close(graph.canceled)
		return nil, ctx.Err()
	}
	return &contractcanvasnode.GetCanvasGraphResponse{Cursor: 7, ProtectedNodeIDs: []string{"node"}}, nil
}

func connect(t *testing.T, endpoint string) *officialmcp.ClientSession {
	t.Helper()
	client := officialmcp.NewClient(&officialmcp.Implementation{Name: "canvas-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &officialmcp.StreamableClientTransport{
		Endpoint:             endpoint,
		HTTPClient:           &http.Client{Transport: headerTransport{headers: trustedHeaders}},
		MaxRetries:           -1,
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func TestCanvasMCPInitializeListAndCall(t *testing.T) {
	access := &fakeAccess{}
	graph := &fakeGraph{}
	httpServer := httptest.NewServer(NewHandler(graph, access, trustedHeaders["X-Internal-Token"]))
	t.Cleanup(httpServer.Close)
	session := connect(t, httpServer.URL)

	inventory, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Tools) != 1 || inventory.Tools[0].Name != "get_canvas" || inventory.Tools[0].Description != getCanvasDescription {
		t.Fatalf("inventory = %#v", inventory.Tools)
	}
	inputSchema, err := json.Marshal(inventory.Tools[0].InputSchema)
	if err != nil {
		t.Fatal(err)
	}
	if string(inputSchema) != `{"additionalProperties":false,"type":"object"}` {
		t.Fatalf("input schema = %s", inputSchema)
	}
	result, err := session.CallTool(t.Context(), &officialmcp.CallToolParams{Name: "get_canvas", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("call result = %#v", result)
	}
	structured, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if string(structured) != `{"graph":{"Archives":null,"Canvas":null,"Cursor":7,"Nodes":null,"ProtectedNodeIDs":["node"],"Tasks":null,"Texts":null},"untrusted":true}` {
		t.Fatalf("structured content = %s", structured)
	}
	if !reflect.DeepEqual(access.args, []any{"tenant", "workspace", "user", "project", applicationprojectaccess.AccessRead}) {
		t.Fatalf("access args = %#v", access.args)
	}
	if access.metadata.WorkspaceRole != "member" || access.metadata.Action != "GetCanvasGraph" || access.metadata.IdentityType != "service" {
		t.Fatalf("request metadata = %#v", access.metadata)
	}
	graph.mu.Lock()
	request := graph.request
	graph.mu.Unlock()
	if request == nil || request.GetWorkspaceID() != "workspace" || request.ProjectID != "project" || request.CanvasID != "canvas" {
		t.Fatalf("graph request = %#v", request)
	}
}

func TestCanvasMCPRejectsUntrustedRequestsBeforeDispatch(t *testing.T) {
	httpServer := httptest.NewServer(NewHandler(&fakeGraph{}, &fakeAccess{}, trustedHeaders["X-Internal-Token"]))
	t.Cleanup(httpServer.Close)
	request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, httpServer.URL, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range trustedHeaders {
		if key != "X-Canvas-ID" {
			request.Header.Set(key, value)
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d", response.StatusCode)
	}
}

func TestCanvasMCPRejectsForgedRuntimeIdentityWithoutWorkloadCredential(t *testing.T) {
	httpServer := httptest.NewServer(NewHandler(&fakeGraph{}, &fakeAccess{}, trustedHeaders["X-Internal-Token"]))
	t.Cleanup(httpServer.Close)
	for _, token := range []string{"", "forged-token"} {
		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, httpServer.URL, http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		for key, value := range trustedHeaders {
			request.Header.Set(key, value)
		}
		request.Header.Set("X-Internal-Token", token)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Fatalf("token %q status = %d", token, response.StatusCode)
		}
	}
	for header, substituted := range map[string]string{
		"X-Auth-User-ID":          "victim",
		"X-Runtime-Attempt-Epoch": "2",
	} {
		request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, httpServer.URL, http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		for key, value := range trustedHeaders {
			request.Header.Set(key, value)
		}
		request.Header.Set(header, substituted)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Fatalf("%s substitution status = %d", header, response.StatusCode)
		}
	}
}

func TestCanvasMCPPropagatesRequestCancellation(t *testing.T) {
	graph := &fakeGraph{started: make(chan struct{}), canceled: make(chan struct{})}
	httpServer := httptest.NewServer(NewHandler(graph, &fakeAccess{}, trustedHeaders["X-Internal-Token"]))
	t.Cleanup(httpServer.Close)
	session := connect(t, httpServer.URL)
	ctx, cancel := context.WithCancel(t.Context())
	finished := make(chan error, 1)
	go func() {
		_, err := session.CallTool(ctx, &officialmcp.CallToolParams{Name: "get_canvas", Arguments: map[string]any{}})
		finished <- err
	}()
	select {
	case <-graph.started:
	case <-time.After(3 * time.Second):
		t.Fatal("tool did not start")
	}
	cancel()
	select {
	case <-graph.canceled:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP request cancellation did not reach the Canvas graph reader")
	}
	select {
	case err := <-finished:
		if !errors.Is(err, context.Canceled) {
			t.Logf("client cancellation returned %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("client call did not finish after cancellation")
	}
}
