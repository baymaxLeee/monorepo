package aigw

import (
	"context"
	"errors"
	"fmt"
	"strings"

	arkmodel "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"

	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	platformaigwproxy "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
)

type imageClient interface {
	GenerateImages(context.Context, arkmodel.GenerateImagesRequest) (arkmodel.ImagesResponse, error)
}

type ImageProvider struct{ client imageClient }

func NewImageProvider(client platformaigwproxy.Client) *ImageProvider {
	return &ImageProvider{client: client}
}

func newImageProvider(client imageClient) *ImageProvider { return &ImageProvider{client: client} }

func (p *ImageProvider) Generate(ctx context.Context, input applicationimagegeneration.ProviderInput) (applicationimagegeneration.ProviderResult, error) {
	result := applicationimagegeneration.ProviderResult{Call: applicationimagegeneration.ProviderCall{
		TaskRunID: input.TaskRunID, Ordinal: input.CallOrdinal, ModelID: strings.TrimSpace(input.ModelID),
	}}
	if p == nil || p.client == nil {
		return result, errors.New("image provider is not configured")
	}
	size, err := imageSize(input.Resolution, input.AspectRatio)
	if err != nil {
		return result, err
	}
	references := make([]string, 0, len(input.ReferenceURLs))
	for _, raw := range input.ReferenceURLs {
		reference, referenceErr := publicReferenceURL(raw)
		if referenceErr != nil {
			return result, referenceErr
		}
		references = append(references, reference)
	}
	responseFormat := arkmodel.GenerateImagesResponseFormatURL
	outputFormat := arkmodel.OutputFormatPNG
	ctx = platformaigwproxy.WithTraceIdentity(ctx, input.TenantID, input.CallerID)
	ctx = platformaigwproxy.WithProjectID(ctx, input.ProjectID)
	if input.WorkspaceID != nil {
		ctx = platformaigwproxy.WithWorkspaceID(ctx, *input.WorkspaceID)
	}
	request := arkmodel.GenerateImagesRequest{
		Model: strings.TrimSpace(input.ModelID), Prompt: input.Prompt, ResponseFormat: &responseFormat,
		Size: &size, Watermark: &input.Watermark, OutputFormat: &outputFormat,
	}
	if len(references) > 0 {
		request.Image = references
	}
	response, err := p.client.GenerateImages(ctx, request)
	result.Call.RequestAttempted = platformaigwproxy.RequestAttempted(err)
	result.Call.RequestID = platformaigwproxy.AIGWRequestID(response.Header())
	if err != nil {
		var apiErr *arkmodel.APIError
		if errors.As(err, &apiErr) {
			return result, &applicationimagegeneration.ProviderFailure{
				Code:    apiErr.Code,
				Message: apiErr.Message,
				Cause:   err,
			}
		}
		return result, err
	}
	if response.Error != nil {
		return result, &applicationimagegeneration.ProviderFailure{
			Code:    response.Error.Code,
			Message: response.Error.Message,
		}
	}
	if len(response.Data) != 1 || response.Data[0] == nil || response.Data[0].Url == nil || strings.TrimSpace(*response.Data[0].Url) == "" {
		return result, errors.New("image generation service did not return exactly one URL")
	}
	result.SourceURL = strings.TrimSpace(*response.Data[0].Url)
	return result, nil
}

func imageSize(resolution domainimagegeneration.Resolution, ratio domainimagegeneration.AspectRatio) (string, error) {
	width, height, err := domainimagegeneration.Dimensions(resolution, ratio)
	if err != nil {
		return "", errors.New("unsupported image size")
	}
	return fmt.Sprintf("%dx%d", width, height), nil
}

var _ applicationimagegeneration.Provider = (*ImageProvider)(nil)
