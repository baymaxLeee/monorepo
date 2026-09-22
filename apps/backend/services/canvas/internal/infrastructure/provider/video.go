package aigw

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"

	arkmodel "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"

	applicationvideogeneration "github.com/example/monorepo/canvas/internal/application/videogeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
	platformaigwproxy "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
)

// CanvasNodeVideoProvider translates the canvasnode application's video task contract to
// AIGW's Ark-compatible content generation API. Task submission deliberately
// lives in agentframe-server for this release; no worker is needed to start a task.
type CanvasNodeVideoProvider struct {
	client platformaigwproxy.Client
}

func NewCanvasNodeVideoProvider(client platformaigwproxy.Client) *CanvasNodeVideoProvider {
	return &CanvasNodeVideoProvider{client: client}
}

func (c *CanvasNodeVideoProvider) Submit(ctx context.Context, input applicationvideogeneration.SubmitCanvasNodeVideoInput) (applicationvideogeneration.SubmitCanvasNodeVideoResult, error) {
	result := applicationvideogeneration.SubmitCanvasNodeVideoResult{Call: applicationvideogeneration.CanvasNodeVideoCall{
		TaskRunID: input.TaskRunID, Ordinal: input.CallOrdinal, ModelID: strings.TrimSpace(input.Model),
	}}
	ctx = withCanvasNodeVideoProviderIdentity(ctx, input.Identity)
	content := []map[string]any{{"type": "text", "text": input.Prompt}}
	for _, reference := range input.References {
		referenceURL, err := seedanceReference(reference.URL)
		if err != nil {
			return result, err
		}
		var item map[string]any
		switch reference.MediaType {
		case domainasset.MediaImage:
			role := reference.Role
			if role == "" {
				role = "reference_image"
			}
			item = map[string]any{"type": "image_url", "image_url": map[string]any{"url": referenceURL}, "role": role}
		case domainasset.MediaVideo:
			item = map[string]any{"type": "video_url", "video_url": map[string]any{"url": referenceURL}, "role": "reference_video"}
		case domainasset.MediaAudio:
			item = map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": referenceURL}, "role": "reference_audio"}
		default:
			continue
		}
		content = append(content, item)
	}
	ratio := optional(input.Ratio)
	if firstLastFrameReferences(input.References) {
		// Seedance derives first/last-frame output geometry from the first image.
		// Some providers tolerate a redundant ratio while others reject it.
		ratio = nil
	}
	response, err := c.client.CreateContentGenerationTask(ctx, arkmodel.CreateContentGenerationTaskRequest{
		Model:         input.Model,
		GenerateAudio: &input.GenerateAudio,
		Watermark:     &input.Watermark,
		Resolution:    optional(input.Resolution),
		Ratio:         ratio,
		Duration:      &input.DurationSeconds,
		ExtraBody:     arkmodel.ExtraBody{"content": content},
	})
	result.Call.RequestAttempted = platformaigwproxy.RequestAttempted(err)
	result.Call.RequestID = platformaigwproxy.AIGWRequestID(response.Header())
	if err != nil {
		return result, err
	}
	if strings.TrimSpace(response.ID) == "" {
		return result, errors.New("video generation service returned an empty task ID")
	}
	result.TaskID = response.ID
	return result, nil
}

func firstLastFrameReferences(references []applicationvideogeneration.CanvasNodeVideoReference) bool {
	for _, reference := range references {
		if reference.Role == "first_frame" || reference.Role == "last_frame" {
			return true
		}
	}
	return false
}

func seedanceReference(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(value, "asset://") {
		reference, err := domainasset.ProviderAssetReference(strings.TrimPrefix(value, "asset://"))
		if err != nil || reference != value {
			return "", invalidReference("reviewed video reference must be asset://asset-*")
		}
		return reference, nil
	}
	return publicReferenceURL(value)
}

func (c *CanvasNodeVideoProvider) Get(ctx context.Context, identity applicationvideogeneration.CanvasNodeVideoProviderIdentity, taskID string) (applicationvideogeneration.CanvasNodeVideoProviderTask, error) {
	ctx = withCanvasNodeVideoProviderIdentity(ctx, identity)
	response, err := c.client.GetContentGenerationTask(ctx, arkmodel.GetContentGenerationTaskRequest{ID: taskID})
	if err != nil {
		if videoTaskNotFound(err) {
			return applicationvideogeneration.CanvasNodeVideoProviderTask{}, fmt.Errorf("%w: %v", applicationvideogeneration.ErrCanvasNodeVideoProviderTaskNotFound, err)
		}
		return applicationvideogeneration.CanvasNodeVideoProviderTask{}, err
	}
	task := applicationvideogeneration.CanvasNodeVideoProviderTask{
		ID:                    response.ID,
		Status:                providerStatus(response.Status),
		VideoURL:              response.Content.VideoURL,
		OutputDurationSeconds: outputDurationSeconds(response.Duration),
	}
	upstreamTaskID := strings.TrimSpace(response.SeedanceTaskID)
	if response.Implement == "volcengine" && upstreamTaskID != "" && upstreamTaskID != strings.TrimSpace(response.ID) && strings.HasPrefix(upstreamTaskID, "cgt-") {
		task.SeedanceTaskID = upstreamTaskID
	}
	if response.Error != nil {
		task.ErrorCode = response.Error.Code
		task.ErrorMessage = response.Error.Message
	}
	return task, nil
}

func outputDurationSeconds(duration *int64) *int32 {
	if duration == nil || *duration <= 0 || *duration > 1<<31-1 {
		return nil
	}
	value := int32(*duration)
	return &value
}

func providerStatus(raw string) domainvideo.ProviderStatus {
	switch raw {
	case arkmodel.StatusQueued:
		return domainvideo.ProviderStatusQueued
	case arkmodel.StatusRunning:
		return domainvideo.ProviderStatusRunning
	case arkmodel.StatusSucceeded:
		return domainvideo.ProviderStatusSucceeded
	case arkmodel.StatusFailed:
		return domainvideo.ProviderStatusFailed
	case arkmodel.StatusCancelled:
		return domainvideo.ProviderStatusCancelled
	default:
		return domainvideo.ProviderStatusUnknown
	}
}

func videoTaskNotFound(err error) bool {
	var apiError *arkmodel.APIError
	if errors.As(err, &apiError) {
		return apiError.HTTPStatusCode == http.StatusNotFound
	}
	var requestError *arkmodel.RequestError
	return errors.As(err, &requestError) && requestError.HTTPStatusCode == http.StatusNotFound
}

func (c *CanvasNodeVideoProvider) Cancel(ctx context.Context, identity applicationvideogeneration.CanvasNodeVideoProviderIdentity, taskID string) error {
	ctx = withCanvasNodeVideoProviderIdentity(ctx, identity)
	err := c.client.DeleteContentGenerationTask(ctx, arkmodel.DeleteContentGenerationTaskRequest{ID: taskID})
	if videoTaskNotFound(err) {
		return fmt.Errorf("%w: %v", applicationvideogeneration.ErrCanvasNodeVideoProviderTaskNotFound, err)
	}
	return err
}

func withCanvasNodeVideoProviderIdentity(ctx context.Context, identity applicationvideogeneration.CanvasNodeVideoProviderIdentity) context.Context {
	ctx = platformaigwproxy.WithTraceIdentity(ctx, identity.TenantID, identity.CallerID)
	ctx = platformaigwproxy.WithWorkspaceID(ctx, identity.WorkspaceID)
	ctx = platformaigwproxy.WithProjectID(ctx, identity.ProjectID)
	return platformaigwproxy.WithProviderID(ctx, identity.ModelID)
}

// publicReferenceURL is the final guard before Seedance fetches a reference
// outside the cluster. Both HTTP and HTTPS are accepted for offline
// deployments, but private addresses and cluster-local names are not.
func publicReferenceURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	reference, err := url.Parse(value)
	if err != nil || (reference.Scheme != "http" && reference.Scheme != "https") || reference.User != nil {
		return "", invalidReference("video reference must be an absolute public HTTP(S) URL")
	}
	host := strings.ToLower(strings.TrimSuffix(reference.Hostname(), "."))
	if host == "" {
		return "", invalidReference("video reference must be an absolute public HTTP(S) URL")
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return "", invalidReference("video reference URL cannot use a private network address")
		}
		return value, nil
	}
	if !strings.Contains(host, ".") || host == "localhost" ||
		strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") ||
		strings.HasSuffix(host, ".cluster.local") ||
		strings.HasSuffix(host, ".vke-system") {
		return "", invalidReference("video reference URL cannot use an internal service address")
	}
	return value, nil
}

func invalidReference(message string) error {
	return fmt.Errorf("%w: %s", applicationvideogeneration.ErrReferenceUnavailable, message)
}

func optional(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

var _ applicationvideogeneration.CanvasNodeVideoProvider = (*CanvasNodeVideoProvider)(nil)
