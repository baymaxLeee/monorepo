package canvasnode

import (
	"fmt"

	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
)

type canvasNodePayloadUpdater func(domain.ReferenceType, map[string]any) error

type canvasNodePayloadUpdaterKey struct {
	NodeType    domain.NodeType
	FromVersion int
}

// Every entry upgrades exactly one NodeType payload across one adjacent version boundary.
var canvasNodePayloadUpdaters = map[canvasNodePayloadUpdaterKey]canvasNodePayloadUpdater{
	{NodeType: domain.NodeTypeImageAsset, FromVersion: 1}:      updateMaterialCanvasNodePayloadV1ToV2,
	{NodeType: domain.NodeTypeVideoAsset, FromVersion: 1}:      updateMaterialCanvasNodePayloadV1ToV2,
	{NodeType: domain.NodeTypeAudioAsset, FromVersion: 1}:      updateMaterialCanvasNodePayloadV1ToV2,
	{NodeType: domain.NodeTypeImageGeneration, FromVersion: 1}: updateImageGenerationCanvasNodePayloadV1ToV2,
	{NodeType: domain.NodeTypeVideoGeneration, FromVersion: 1}: updateVideoGenerationCanvasNodePayloadV1ToV2,
	{NodeType: domain.NodeTypeVideoGeneration, FromVersion: 2}: updateVideoGenerationCanvasNodePayloadV2ToV3,
}

func updateImageGenerationCanvasNodePayloadV1ToV2(_ domain.ReferenceType, payload map[string]any) error {
	// V1 predates the 2:3 aspect-ratio enum. Reject value 9 at the historical
	// boundary before V2 makes it legal.
	config, ok := payload["generation_config"].(map[string]any)
	if !ok {
		return nil
	}
	ratio, ok := config["aspect_ratio"].(float64)
	if ok && (ratio < 1 || ratio > 7) {
		return fmt.Errorf("image generation payload V1 aspect_ratio must be a legacy fixed ratio")
	}
	return nil
}

func updateVideoGenerationCanvasNodePayloadV2ToV3(_ domain.ReferenceType, payload map[string]any) error {
	// V2 predates the adaptive aspect-ratio enum. Validate the historical
	// boundary before V3 makes value 8 legal, so malformed V2 rows stay rejected.
	config, ok := payload["generation_config"].(map[string]any)
	if !ok {
		return nil
	}
	ratio, ok := config["aspect_ratio"].(float64)
	if ok && (ratio < 1 || ratio > 7) {
		return fmt.Errorf("video generation payload V2 aspect_ratio must be fixed")
	}
	return nil
}

func updateMaterialCanvasNodePayloadV1ToV2(legacyReferenceType domain.ReferenceType, payload map[string]any) error {
	if !legacyReferenceType.Valid() {
		return fmt.Errorf("material reference type %d is invalid", legacyReferenceType)
	}
	payload["reference_type"] = int16(legacyReferenceType)
	return nil
}

func updateVideoGenerationCanvasNodePayloadV1ToV2(_ domain.ReferenceType, payload map[string]any) error {
	// V1 accepted only fixed positive durations. Preserve that historical
	// contract while V2 adds the AIGW -1 automatic-duration sentinel.
	config, ok := payload["generation_config"].(map[string]any)
	if !ok {
		return nil
	}
	duration, ok := config["duration_seconds"].(float64)
	if ok && duration < 1 {
		return fmt.Errorf("video generation payload V1 duration_seconds must be positive")
	}
	return nil
}
