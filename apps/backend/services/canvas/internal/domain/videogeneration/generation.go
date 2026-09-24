package videogeneration

import (
	"strings"
	"time"

	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
)

type Resolution int16

const (
	Resolution480 Resolution = iota + 1
	Resolution720
	Resolution1080
	Resolution2K
	Resolution4K
)

func (v Resolution) Valid() bool { return v >= Resolution480 && v <= Resolution4K }

func (v Resolution) ProviderValue() string {
	return map[Resolution]string{
		Resolution480: "480p", Resolution720: "720p", Resolution1080: "1080p", Resolution2K: "2k", Resolution4K: "4k",
	}[v]
}

type AspectRatio int16

const (
	Aspect21x9 AspectRatio = iota + 1
	Aspect16x9
	Aspect4x3
	Aspect1x1
	Aspect3x4
	Aspect9x16
	Aspect3x2
	AspectAdaptive
	Aspect2x3
)

func (v AspectRatio) Valid() bool { return v >= Aspect21x9 && v <= Aspect2x3 }

func (v AspectRatio) ProviderValue() string {
	return map[AspectRatio]string{
		Aspect21x9: "21:9", Aspect16x9: "16:9", Aspect4x3: "4:3", Aspect1x1: "1:1",
		Aspect3x4: "3:4", Aspect9x16: "9:16", Aspect3x2: "3:2", AspectAdaptive: "adaptive",
		Aspect2x3: "2:3",
	}[v]
}

// AutomaticDurationSeconds is the provider contract value for provider-selected
// video duration. It must only be accepted after the selected model advertises
// the value in its duration recommendations.
const AutomaticDurationSeconds int32 = -1

type Config struct {
	ModelServiceID  string
	Resolution      Resolution
	AspectRatio     AspectRatio
	DurationSeconds int32
	GenerateAudio   bool
	Watermark       bool
}

func DefaultConfig(modelServiceID string) Config {
	return Config{
		ModelServiceID: strings.TrimSpace(modelServiceID),
		Resolution:     Resolution720, AspectRatio: Aspect9x16,
		DurationSeconds: 5, GenerateAudio: true,
	}
}

func (v Config) Valid() bool {
	return strings.TrimSpace(v.ModelServiceID) != "" && v.Resolution.Valid() &&
		v.AspectRatio.Valid() && (v.DurationSeconds > 0 || v.DurationSeconds == AutomaticDurationSeconds)
}

type ConfigPatch struct {
	ModelServiceID  *string
	Resolution      *Resolution
	AspectRatio     *AspectRatio
	DurationSeconds *int32
	GenerateAudio   *bool
	Watermark       *bool
}

func (p ConfigPatch) Empty() bool {
	return p.ModelServiceID == nil && p.Resolution == nil && p.AspectRatio == nil &&
		p.DurationSeconds == nil && p.GenerateAudio == nil && p.Watermark == nil
}

func (p ConfigPatch) Apply(current Config) Config {
	if p.ModelServiceID != nil {
		current.ModelServiceID = strings.TrimSpace(*p.ModelServiceID)
	}
	if p.Resolution != nil {
		current.Resolution = *p.Resolution
	}
	if p.AspectRatio != nil {
		current.AspectRatio = *p.AspectRatio
	}
	if p.DurationSeconds != nil {
		current.DurationSeconds = *p.DurationSeconds
	}
	if p.GenerateAudio != nil {
		current.GenerateAudio = *p.GenerateAudio
	}
	if p.Watermark != nil {
		current.Watermark = *p.Watermark
	}
	return current
}

type ProviderStatus string

const (
	ProviderStatusPending   ProviderStatus = "pending"
	ProviderStatusQueued    ProviderStatus = "queued"
	ProviderStatusRunning   ProviderStatus = "running"
	ProviderStatusSucceeded ProviderStatus = "succeeded"
	ProviderStatusFailed    ProviderStatus = "failed"
	ProviderStatusCancelled ProviderStatus = "cancelled"
	ProviderStatusUnknown   ProviderStatus = "unknown"
)

// Generation is the task-specific video generation fact. TaskRunID is its
// identity; CanvasID and NodeID record the current entry point's business
// association without making the CanvasNode aggregate own the generation lifecycle.
type Generation struct {
	TaskRunID, TenantID, ProjectID, CanvasID, NodeID            string
	WorkspaceID                                                 *string
	ModelServiceID, Prompt                                      string
	Resolution                                                  Resolution
	AspectRatio                                                 AspectRatio
	DurationSeconds                                             int32
	OutputDurationSeconds                                       *int32
	GenerateAudio, Watermark                                    bool
	ProviderWorkspaceID                                         string
	ProviderTaskID, SeedanceTaskID, ProviderVideoURL            string
	ProviderStatus                                              ProviderStatus
	ProviderErrorCode, ProviderErrorMessage                     string
	Status                                                      string
	AssetID, ErrorMessage, CreatedBy                            string
	FirstLastFrameTaskRunID                                     string
	FirstFrameCheckpointAssetID, FirstFrameCheckpointRevisionID string
	LastFrameCheckpointAssetID, LastFrameCheckpointRevisionID   string
	FirstFrameCheckpointSizeBytes, LastFrameCheckpointSizeBytes int64
	FirstFrameAssetID, LastFrameAssetID                         string
	Inputs                                                      []domaingenerationinput.Input
	CompletedAt                                                 *time.Time
	CreatedAt, UpdatedAt                                        time.Time
}
