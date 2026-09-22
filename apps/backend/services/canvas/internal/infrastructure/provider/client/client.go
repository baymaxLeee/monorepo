// Package providerclient resolves Admin-owned custom providers and calls their
// Ark-compatible endpoints directly. Provider IDs remain the application
// contract; model names, endpoints and secrets stay at the outbound edge.
package providerclient

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/example/monorepo/canvas/internal/infrastructure/admin"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime"
	arkmodel "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"
	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/utils"
)

type ResponsesStream interface {
	Recv() (*responses.Event, error)
	Close() error
	Header() http.Header
}

type ContentGenerationTaskResponse struct {
	arkmodel.GetContentGenerationTaskResponse
	SeedanceTaskID string `json:"task_id"`
	Implement      string `json:"implement"`
}

type Client interface {
	CreateResponses(context.Context, *responses.ResponsesRequest) (*responses.ResponseObject, error)
	CreateResponsesStream(context.Context, *responses.ResponsesRequest) (ResponsesStream, error)
	GenerateImages(context.Context, arkmodel.GenerateImagesRequest) (arkmodel.ImagesResponse, error)
	CreateContentGenerationTask(context.Context, arkmodel.CreateContentGenerationTaskRequest) (arkmodel.CreateContentGenerationTaskResponse, error)
	GetContentGenerationTask(context.Context, arkmodel.GetContentGenerationTaskRequest) (ContentGenerationTaskResponse, error)
	DeleteContentGenerationTask(context.Context, arkmodel.DeleteContentGenerationTaskRequest) error
}

type client struct{ providers *admin.Directory }

func New(providers *admin.Directory) Client { return &client{providers: providers} }

type identity struct{ tenantID, workspaceID, userID, projectID, providerID string }
type identityKey struct{}

func updateIdentity(ctx context.Context, update func(*identity)) context.Context {
	value, _ := ctx.Value(identityKey{}).(identity)
	update(&value)
	return context.WithValue(ctx, identityKey{}, value)
}

func WithWorkspaceID(ctx context.Context, value string) context.Context {
	return updateIdentity(ctx, func(item *identity) { item.workspaceID = strings.TrimSpace(value) })
}
func WithProjectID(ctx context.Context, value string) context.Context {
	return updateIdentity(ctx, func(item *identity) { item.projectID = strings.TrimSpace(value) })
}
func WithProviderID(ctx context.Context, value string) context.Context {
	return updateIdentity(ctx, func(item *identity) { item.providerID = strings.TrimSpace(value) })
}
func WithTraceIdentity(ctx context.Context, tenantID, userID string) context.Context {
	return updateIdentity(ctx, func(item *identity) {
		item.tenantID, item.userID = strings.TrimSpace(tenantID), strings.TrimSpace(userID)
	})
}

type resolutionError struct{ message string }

func (err *resolutionError) Error() string { return err.message }
func RequestAttempted(err error) bool {
	var resolution *resolutionError
	return !errors.As(err, &resolution)
}

func (c *client) runtime(ctx context.Context, providerID, expectedKind string, taskCredentials bool) (*arkruntime.Client, string, error) {
	identity, _ := ctx.Value(identityKey{}).(identity)
	if providerID == "" {
		providerID = identity.providerID
	}
	if c == nil || c.providers == nil || identity.tenantID == "" || identity.workspaceID == "" || providerID == "" {
		return nil, "", &resolutionError{message: "generation provider identity is incomplete"}
	}
	var provider admin.Provider
	var err error
	if taskCredentials {
		provider, err = c.providers.GetTaskCredentials(ctx, identity.tenantID, identity.workspaceID, providerID)
	} else {
		provider, err = c.providers.Get(ctx, identity.tenantID, identity.workspaceID, providerID)
	}
	if err != nil {
		return nil, "", &resolutionError{message: "resolve generation provider: " + err.Error()}
	}
	if provider.ProviderKind != expectedKind {
		return nil, "", &resolutionError{message: "generation provider kind " + provider.ProviderKind + " does not match " + expectedKind}
	}
	if (!taskCredentials && !provider.IsEnabled) || provider.BaseURL == "" || provider.APIKey == "" || provider.Model == "" {
		return nil, "", &resolutionError{message: "generation provider is disabled or incomplete"}
	}
	return arkruntime.NewClientWithApiKey(provider.APIKey, arkruntime.WithBaseUrl(arkAPIRoot(provider.BaseURL)), arkruntime.WithRetryTimes(0)), provider.Model, nil
}

// arkAPIRoot mirrors Admin's provider connectivity test and Executor's Ark
// adapter. Admin accepts both an API root and a concrete resource URL; the SDK
// always appends its own resource path, so retaining the suffix would produce
// paths such as /images/generations/images/generations.
func arkAPIRoot(baseURL string) string {
	root := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	for _, suffix := range []string{"/contents/generations/tasks", "/images/generations", "/responses"} {
		if strings.HasSuffix(root, suffix) {
			return strings.TrimRight(strings.TrimSuffix(root, suffix), "/")
		}
	}
	return root
}

func (c *client) CreateResponses(ctx context.Context, request *responses.ResponsesRequest) (*responses.ResponseObject, error) {
	if request == nil {
		return nil, &resolutionError{message: "responses request is nil"}
	}
	runtime, model, err := c.runtime(ctx, request.Model, "chat", false)
	if err != nil {
		return nil, err
	}
	request.Model = model
	return runtime.CreateResponses(ctx, request)
}
func (c *client) CreateResponsesStream(ctx context.Context, request *responses.ResponsesRequest) (ResponsesStream, error) {
	if request == nil {
		return nil, &resolutionError{message: "responses request is nil"}
	}
	runtime, model, err := c.runtime(ctx, request.Model, "chat", false)
	if err != nil {
		return nil, err
	}
	request.Model = model
	return runtime.CreateResponsesStream(ctx, request)
}
func (c *client) GenerateImages(ctx context.Context, request arkmodel.GenerateImagesRequest) (arkmodel.ImagesResponse, error) {
	runtime, model, err := c.runtime(ctx, request.Model, "image", false)
	if err != nil {
		return arkmodel.ImagesResponse{}, err
	}
	request.Model = model
	return runtime.GenerateImages(ctx, request)
}
func (c *client) CreateContentGenerationTask(ctx context.Context, request arkmodel.CreateContentGenerationTaskRequest) (arkmodel.CreateContentGenerationTaskResponse, error) {
	runtime, model, err := c.runtime(ctx, request.Model, "video", false)
	if err != nil {
		return arkmodel.CreateContentGenerationTaskResponse{}, err
	}
	request.Model = model
	return runtime.CreateContentGenerationTask(ctx, request)
}
func (c *client) GetContentGenerationTask(ctx context.Context, request arkmodel.GetContentGenerationTaskRequest) (ContentGenerationTaskResponse, error) {
	runtime, _, err := c.runtime(ctx, "", "video", true)
	if err != nil {
		return ContentGenerationTaskResponse{}, err
	}
	response, err := runtime.GetContentGenerationTask(ctx, request)
	return ContentGenerationTaskResponse{GetContentGenerationTaskResponse: response}, err
}
func (c *client) DeleteContentGenerationTask(ctx context.Context, request arkmodel.DeleteContentGenerationTaskRequest) error {
	runtime, _, err := c.runtime(ctx, "", "video", true)
	if err != nil {
		return err
	}
	return runtime.DeleteContentGenerationTask(ctx, request)
}

var _ ResponsesStream = (*utils.ResponsesStreamReader)(nil)
