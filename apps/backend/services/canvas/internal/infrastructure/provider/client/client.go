// Package aigwproxy binds the mature generation adapters to the monorepo
// Admin-owned provider catalog. Provider IDs remain the application contract;
// the real model, endpoint and secret are resolved only at the outbound edge.
package aigwproxy

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
	CreateChatCompletion(context.Context, arkmodel.ChatRequest) (arkmodel.ChatCompletionResponse, error)
	CreateResponses(context.Context, *responses.ResponsesRequest) (*responses.ResponseObject, error)
	CreateResponsesStream(context.Context, *responses.ResponsesRequest) (ResponsesStream, error)
	GenerateImages(context.Context, arkmodel.GenerateImagesRequest) (arkmodel.ImagesResponse, error)
	CreateContentGenerationTask(context.Context, arkmodel.CreateContentGenerationTaskRequest) (arkmodel.CreateContentGenerationTaskResponse, error)
	GetContentGenerationTask(context.Context, arkmodel.GetContentGenerationTaskRequest) (ContentGenerationTaskResponse, error)
	DeleteContentGenerationTask(context.Context, arkmodel.DeleteContentGenerationTaskRequest) error
	ListContentGenerationTasks(context.Context, arkmodel.ListContentGenerationTasksRequest) (arkmodel.ListContentGenerationTasksResponse, error)
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

func (c *client) runtime(ctx context.Context, providerID string) (*arkruntime.Client, string, error) {
	identity, _ := ctx.Value(identityKey{}).(identity)
	if providerID == "" {
		providerID = identity.providerID
	}
	if c == nil || c.providers == nil || identity.tenantID == "" || identity.workspaceID == "" || providerID == "" {
		return nil, "", &resolutionError{message: "generation provider identity is incomplete"}
	}
	provider, err := c.providers.Get(ctx, identity.tenantID, identity.workspaceID, providerID)
	if err != nil {
		return nil, "", &resolutionError{message: "resolve generation provider: " + err.Error()}
	}
	if !provider.IsEnabled || provider.BaseURL == "" || provider.APIKey == "" || provider.Model == "" {
		return nil, "", &resolutionError{message: "generation provider is disabled or incomplete"}
	}
	return arkruntime.NewClientWithApiKey(provider.APIKey, arkruntime.WithBaseUrl(provider.BaseURL), arkruntime.WithRetryTimes(0)), provider.Model, nil
}

func (c *client) CreateChatCompletion(ctx context.Context, request arkmodel.ChatRequest) (arkmodel.ChatCompletionResponse, error) {
	runtime, model, err := c.runtime(ctx, request.GetModel())
	if err != nil {
		return arkmodel.ChatCompletionResponse{}, err
	}
	switch typed := request.(type) {
	case arkmodel.ChatCompletionRequest:
		typed.Model, request = model, typed
	case *arkmodel.ChatCompletionRequest:
		typed.Model = model
	case arkmodel.CreateChatCompletionRequest:
		typed.Model, request = model, typed
	case *arkmodel.CreateChatCompletionRequest:
		typed.Model = model
	default:
		return arkmodel.ChatCompletionResponse{}, &resolutionError{message: "unsupported chat request type"}
	}
	return runtime.CreateChatCompletion(ctx, request)
}
func (c *client) CreateResponses(ctx context.Context, request *responses.ResponsesRequest) (*responses.ResponseObject, error) {
	if request == nil {
		return nil, &resolutionError{message: "responses request is nil"}
	}
	runtime, model, err := c.runtime(ctx, request.Model)
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
	runtime, model, err := c.runtime(ctx, request.Model)
	if err != nil {
		return nil, err
	}
	request.Model = model
	return runtime.CreateResponsesStream(ctx, request)
}
func (c *client) GenerateImages(ctx context.Context, request arkmodel.GenerateImagesRequest) (arkmodel.ImagesResponse, error) {
	runtime, model, err := c.runtime(ctx, request.Model)
	if err != nil {
		return arkmodel.ImagesResponse{}, err
	}
	request.Model = model
	return runtime.GenerateImages(ctx, request)
}
func (c *client) CreateContentGenerationTask(ctx context.Context, request arkmodel.CreateContentGenerationTaskRequest) (arkmodel.CreateContentGenerationTaskResponse, error) {
	runtime, model, err := c.runtime(ctx, request.Model)
	if err != nil {
		return arkmodel.CreateContentGenerationTaskResponse{}, err
	}
	request.Model = model
	return runtime.CreateContentGenerationTask(ctx, request)
}
func (c *client) GetContentGenerationTask(ctx context.Context, request arkmodel.GetContentGenerationTaskRequest) (ContentGenerationTaskResponse, error) {
	runtime, _, err := c.runtime(ctx, "")
	if err != nil {
		return ContentGenerationTaskResponse{}, err
	}
	response, err := runtime.GetContentGenerationTask(ctx, request)
	return ContentGenerationTaskResponse{GetContentGenerationTaskResponse: response}, err
}
func (c *client) DeleteContentGenerationTask(ctx context.Context, request arkmodel.DeleteContentGenerationTaskRequest) error {
	runtime, _, err := c.runtime(ctx, "")
	if err != nil {
		return err
	}
	return runtime.DeleteContentGenerationTask(ctx, request)
}
func (c *client) ListContentGenerationTasks(ctx context.Context, request arkmodel.ListContentGenerationTasksRequest) (arkmodel.ListContentGenerationTasksResponse, error) {
	providerID := ""
	if request.Filter != nil && request.Filter.Model != nil {
		providerID = *request.Filter.Model
	}
	runtime, model, err := c.runtime(ctx, providerID)
	if err != nil {
		return arkmodel.ListContentGenerationTasksResponse{}, err
	}
	if request.Filter != nil && request.Filter.Model != nil {
		request.Filter.Model = &model
	}
	return runtime.ListContentGenerationTasks(ctx, request)
}

var _ ResponsesStream = (*utils.ResponsesStreamReader)(nil)
