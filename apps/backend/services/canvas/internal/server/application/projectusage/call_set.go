package projectusage

import (
	"sort"
	"strings"

	domain "github.com/example/monorepo/canvas/internal/server/domain/projectusage"
)

const (
	TaskTypeImageGeneration      = "IMAGE_GENERATION"
	TaskTypeVideoGeneration      = "CANVAS_NODE_VIDEO_GENERATION"
	TaskTypeStoryboardGeneration = "CANVAS_STORYBOARD_GENERATION"
	TaskTypeCanvasTextGeneration = "CANVAS_NODE_TEXT_GENERATION"

	CallTypeImageGeneration      = "IMAGE_GENERATION"
	CallTypeVideoGeneration      = "VIDEO_GENERATION"
	CallTypeStoryboardRound      = "STORYBOARD_ROUND"
	CallTypeCanvasTextGeneration = "TEXT_GENERATION"

	ResourceTypeImage = "IMAGE"
	ResourceTypeVideo = "VIDEO"
	ResourceTypeText  = "TEXT"
)

// FrozenUsageSnapshot is the immutable task-level attribution copied into a
// project usage projection. Reconciliation must compare it with the call
// ledger instead of trusting either side independently.
type FrozenUsageSnapshot struct {
	TaskRunID   string
	TaskType    string
	ProjectID   string
	ModelID     string
	ModelName   string
	ModelSource string
	CallCount   int32
}

// ExpectedUsageShape is the explicit accounting contract for every TaskRun
// type currently included in project usage. Keeping the mapping here prevents
// an unrelated call or model from being silently charged to a projection.
func ExpectedUsageShape(taskType string) (callType, resourceType string, minCalls, maxCalls int32, ok bool) {
	switch strings.TrimSpace(taskType) {
	case TaskTypeImageGeneration:
		return CallTypeImageGeneration, ResourceTypeImage, 1, 1, true
	case TaskTypeVideoGeneration:
		return CallTypeVideoGeneration, ResourceTypeVideo, 1, 1, true
	case TaskTypeStoryboardGeneration:
		// One compact planning call plus bounded detail and correction batches can
		// exceed the legacy three-round repair budget. The plot hard limit and
		// three-node batch size keep 320 above valid work while still fencing
		// runaway orchestration and corrupted call ledgers.
		return CallTypeStoryboardRound, ResourceTypeText, 1, 320, true
	case TaskTypeCanvasTextGeneration:
		return CallTypeCanvasTextGeneration, ResourceTypeText, 1, 1, true
	default:
		return "", "", 0, 0, false
	}
}

// FrozenCallSetProblem returns a stable review reason when the calls frozen by
// a terminal TaskRun cannot be proved to belong to that usage projection.
func FrozenCallSetProblem(
	snapshot FrozenUsageSnapshot,
	calls []domain.AIGWCall,
) string {
	if len(calls) != int(snapshot.CallCount) {
		return "frozen call count does not match persisted AIGW calls"
	}
	expectedCallType, _, minCalls, maxCalls, ok := ExpectedUsageShape(snapshot.TaskType)
	if !ok {
		return "project usage TaskRun type is not supported"
	}
	if snapshot.CallCount < minCalls || snapshot.CallCount > maxCalls {
		return "frozen AIGW call count is outside the TaskRun type limit"
	}
	ordered := append([]domain.AIGWCall(nil), calls...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].CallOrdinal < ordered[j].CallOrdinal })
	first := ordered[0]
	for index := range ordered {
		call := ordered[index]
		if call.TaskRunID != snapshot.TaskRunID {
			return "an AIGW call belongs to a different TaskRun"
		}
		if call.CallOrdinal != int32(index+1) {
			return "AIGW call ordinals are not contiguous"
		}
		if call.CallType != expectedCallType {
			return "an AIGW call type does not match the TaskRun type"
		}
		if call.ProjectID != first.ProjectID || call.ModelID != first.ModelID ||
			call.ModelName != first.ModelName || call.ModelSource != first.ModelSource {
			return "AIGW calls do not share one attribution snapshot"
		}
		if call.ProjectID != snapshot.ProjectID || call.ModelID != snapshot.ModelID ||
			call.ModelName != snapshot.ModelName || call.ModelSource != snapshot.ModelSource {
			return "frozen project usage attribution does not match AIGW calls"
		}
	}
	return ""
}
