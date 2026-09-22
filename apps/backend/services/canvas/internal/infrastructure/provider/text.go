package aigw

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/volcengine/volcengine-go-sdk/service/arkruntime/model/responses"

	app "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	platformaigwproxy "github.com/example/monorepo/canvas/internal/infrastructure/provider/client"
)

type textClient interface {
	CreateResponsesStream(context.Context, *responses.ResponsesRequest) (platformaigwproxy.ResponsesStream, error)
}

type TextProvider struct{ client textClient }

func NewTextProvider(client platformaigwproxy.Client) *TextProvider {
	return &TextProvider{client: client}
}

func newTextProvider(client textClient) *TextProvider { return &TextProvider{client: client} }
func (p *TextProvider) Generate(ctx context.Context, input app.ProviderInput) (app.ProviderResult, error) {
	result := app.ProviderResult{Call: app.ProviderCall{
		TaskRunID: input.TaskRunID,
		Ordinal:   input.CallOrdinal,
		ModelID:   strings.TrimSpace(input.Selection.ModelID),
	}}
	if p == nil || p.client == nil {
		return result, errors.New("text provider is not configured")
	}
	store := true
	content := []*responses.ContentItem{{Union: &responses.ContentItem_Text{Text: &responses.ContentItemText{Type: responses.ContentItemType_input_text, Text: input.Prompt}}}}
	for _, reference := range input.References {
		item, referenceErr := textReferenceContent(reference)
		if referenceErr != nil {
			return result, referenceErr
		}
		content = append(content, item)
	}
	request := &responses.ResponsesRequest{Model: input.Selection.ModelID, Store: &store, Input: &responses.ResponsesInput{Union: &responses.ResponsesInput_ListValue{ListValue: &responses.InputItemList{ListValue: []*responses.InputItem{{Union: &responses.InputItem_InputMessage{InputMessage: &responses.ItemInputMessage{Role: responses.MessageRole_user, Content: content}}}}}}}}
	request.Temperature = input.Selection.ModelConfig.Temperature
	request.TopP = input.Selection.ModelConfig.TopP
	request.MaxOutputTokens = input.Selection.ModelConfig.MaxTokens
	ctx = platformaigwproxy.WithTraceIdentity(ctx, input.TenantID, input.CallerID)
	if input.WorkspaceID != nil {
		ctx = platformaigwproxy.WithWorkspaceID(ctx, *input.WorkspaceID)
	}
	stream, err := p.client.CreateResponsesStream(ctx, request)
	result.Call.RequestAttempted = platformaigwproxy.RequestAttempted(err)
	if err != nil {
		return result, err
	}
	result.Call.RequestID = platformaigwproxy.AIGWRequestID(stream.Header())
	defer closeResponseStream(stream)
	for {
		event, e := stream.Recv()
		if e != nil {
			if errors.Is(e, io.EOF) {
				return result, errors.New("text generation stream ended before completion")
			}
			return result, e
		}
		if event == nil {
			continue
		}
		if delta := event.GetText(); delta != nil && delta.GetDelta() != "" {
			if e = input.Emit(delta.GetDelta()); e != nil {
				return result, e
			}
		}
		if failure := event.GetError(); failure != nil {
			return result, fmt.Errorf("text generation failed: %s", failure.GetMessage())
		}
		if completed := event.GetResponseCompleted(); completed != nil {
			return result, nil
		}
		if failed := event.GetResponseFailed(); failed != nil {
			return result, errors.New("text generation failed")
		}
		if incomplete := event.GetResponseIncomplete(); incomplete != nil {
			return result, errors.New("text generation incomplete")
		}
	}
}

func textReferenceContent(reference app.Reference) (*responses.ContentItem, error) {
	url := strings.TrimSpace(reference.URL)
	if url == "" {
		return nil, errors.New("text generation reference URL is empty")
	}
	switch reference.Modality {
	case domaingenerationinput.ModalityImage:
		return &responses.ContentItem{Union: &responses.ContentItem_Image{Image: &responses.ContentItemImage{Type: responses.ContentItemType_input_image, ImageUrl: &url}}}, nil
	case domaingenerationinput.ModalityVideo:
		return &responses.ContentItem{Union: &responses.ContentItem_Video{Video: &responses.ContentItemVideo{Type: responses.ContentItemType_input_video, VideoUrl: url}}}, nil
	case domaingenerationinput.ModalityAudio:
		return &responses.ContentItem{Union: &responses.ContentItem_Audio{Audio: &responses.ContentItemAudio{Type: responses.ContentItemType_input_audio, AudioUrl: url}}}, nil
	default:
		return nil, errors.New("text generation reference modality is unsupported")
	}
}

var _ app.Provider = (*TextProvider)(nil)
