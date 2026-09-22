package videogeneration

import domainasset "github.com/example/monorepo/canvas/internal/domain/asset"

func videoReferences(inputs []resolvedNodeReference) ([]CanvasNodeVideoReference, error) {
	references := make([]CanvasNodeVideoReference, 0, len(inputs))
	for _, input := range inputs {
		if input.Text != "" {
			continue
		}
		if input.Asset.MediaType != domainasset.MediaImage && input.Asset.MediaType != domainasset.MediaVideo && input.Asset.MediaType != domainasset.MediaAudio {
			return nil, ErrReferenceUnavailable
		}
		references = append(references, CanvasNodeVideoReference{
			MediaType: input.Asset.MediaType,
			URL:       input.ReferenceURL,
			Role:      input.Role,
		})
	}
	return references, nil
}
