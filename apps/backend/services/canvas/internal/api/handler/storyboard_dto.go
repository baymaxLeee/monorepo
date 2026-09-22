package http

import (
	contractasset "github.com/example/monorepo/canvas/internal/api/contracts/asset"
	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
)

func draftDTO(draft applicationcanvasnode.Draft) *contractcanvasnode.CanvasNodeDraft {
	references := make([]*contractcanvasnode.CanvasNodeDraftAssetReference, 0, len(draft.AssetReferences))
	for _, reference := range draft.AssetReferences {
		item := &contractcanvasnode.CanvasNodeDraftAssetReference{
			ResourceAssetID: reference.ResourceAssetID,
			AssetID:         optionalString(reference.AssetID),
			Label:           optionalString(reference.Label),
			TargetField:     reference.TargetField,
			AnchorText:      reference.AnchorText,
		}
		if reference.MediaType.Valid() {
			mediaType := contractasset.AssetMediaType(reference.MediaType)
			item.MediaType = &mediaType
		}
		references = append(references, item)
	}
	return &contractcanvasnode.CanvasNodeDraft{
		DraftID: draft.ID, CanvasNodeNo: int32(draft.CanvasNodeNo), Prompt: draft.Prompt,
		DurationSeconds: draft.DurationSeconds, AssetReferences: references,
	}
}

func draftSessionDTO(state applicationcanvasnode.StoryboardSession, includeCanvasNodes bool) *contractcanvasnode.CanvasNodeDraftSession {
	status := contractcanvasnode.CanvasNodeDraftStatus_RUNNING
	switch state.Status {
	case applicationcanvasnode.StoryboardStatusCompleted:
		status = contractcanvasnode.CanvasNodeDraftStatus_COMPLETED
	case applicationcanvasnode.StoryboardStatusFailed:
		status = contractcanvasnode.CanvasNodeDraftStatus_FAILED
	}
	dto := &contractcanvasnode.CanvasNodeDraftSession{
		TaskRunID: state.ID, Plot: state.Plot, Status: status,
		ModelConfig: storyboardModelConfigDTO(state.ModelConfig), PlanningConfig: storyboardPlanningConfigDTO(state.PlanningConfig),
	}
	if includeCanvasNodes {
		dto.CanvasNodes = make([]*contractcanvasnode.CanvasNodeDraft, 0, len(state.Drafts))
		for _, draft := range state.Drafts {
			dto.CanvasNodes = append(dto.CanvasNodes, draftDTO(draft))
		}
	}
	return dto
}

func storyboardPlanningConfigFromRequest(request *contractcanvasnode.CreateCanvasNodesRequest) applicationcanvasnode.StoryboardPlanningConfig {
	if request.PlanningConfig == nil {
		return applicationcanvasnode.StoryboardPlanningConfig{}
	}
	return applicationcanvasnode.StoryboardPlanningConfig{
		CanvasNodeDurationMinSeconds: request.PlanningConfig.GetCanvasNodeDurationMinSeconds(),
		CanvasNodeDurationMaxSeconds: request.PlanningConfig.GetCanvasNodeDurationMaxSeconds(),
		TotalDurationMinSeconds:      request.PlanningConfig.GetTotalDurationMinSeconds(),
		TotalDurationMaxSeconds:      request.PlanningConfig.GetTotalDurationMaxSeconds(),
	}
}

func storyboardPlanningConfigDTO(value applicationcanvasnode.StoryboardPlanningConfig) *contractcanvasnode.StoryboardPlanningConfig {
	if value == (applicationcanvasnode.StoryboardPlanningConfig{}) {
		return nil
	}
	return &contractcanvasnode.StoryboardPlanningConfig{
		CanvasNodeDurationMinSeconds: optionalInt32(value.CanvasNodeDurationMinSeconds),
		CanvasNodeDurationMaxSeconds: optionalInt32(value.CanvasNodeDurationMaxSeconds),
		TotalDurationMinSeconds:      optionalInt32(value.TotalDurationMinSeconds),
		TotalDurationMaxSeconds:      optionalInt32(value.TotalDurationMaxSeconds),
	}
}

func optionalInt32(value int32) *int32 {
	if value == 0 {
		return nil
	}
	return &value
}

func storyboardModelConfigFromRequest(request *contractcanvasnode.CreateCanvasNodesRequest) applicationcanvasnode.StoryboardModelConfig {
	value := applicationcanvasnode.StoryboardModelConfig{}
	if request.ModelConfig != nil {
		value.InferenceModelServiceID = request.ModelConfig.GetInferenceModelServiceID()
		value.VideoModelServiceID = request.ModelConfig.GetVideoModelServiceID()
		if parameters := request.ModelConfig.VideoParameters; parameters != nil {
			value.VideoParameters = applicationcanvasnode.StoryboardVideoParameters{
				Resolution: domainvideo.Resolution(parameters.Resolution), AspectRatio: domainvideo.AspectRatio(parameters.AspectRatio),
				GenerateAudio: parameters.GenerateAudio, Watermark: parameters.Watermark,
			}
		}
	}
	return value
}

func storyboardModelConfigDTO(value applicationcanvasnode.StoryboardModelConfig) *contractcanvasnode.StoryboardModelConfig {
	if value.InferenceModelServiceID == "" && value.VideoModelServiceID == "" && !value.VideoParameters.Valid() {
		return nil
	}
	return &contractcanvasnode.StoryboardModelConfig{
		InferenceModelServiceID: storyboardOptionalString(value.InferenceModelServiceID),
		VideoModelServiceID:     storyboardOptionalString(value.VideoModelServiceID),
		VideoParameters: &contractcanvasnode.StoryboardVideoParameters{
			Resolution: contractcanvasnode.CanvasNodeResolution(value.VideoParameters.Resolution), AspectRatio: contractcanvasnode.CanvasNodeAspectRatio(value.VideoParameters.AspectRatio),
			GenerateAudio: value.VideoParameters.GenerateAudio, Watermark: value.VideoParameters.Watermark,
		},
	}
}

func storyboardOptionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
