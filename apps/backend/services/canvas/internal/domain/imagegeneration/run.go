package imagegeneration

import (
	"strings"
	"time"

	generationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
)

type Run struct {
	TaskRunID         string
	TenantID          string
	ProjectID         string
	WorkspaceID       *string
	Target            TargetRef
	Config            Config
	Inputs            []ResolvedInput
	InputSnapshots    []generationinput.Input
	OutputOwner       OutputAssetOwner
	BindingOutcome    BindingOutcome
	Stage             string
	ProviderAttempt   int32
	ProviderImageURL  string
	SourceAssetID     string
	SourceRevisionID  string
	ArtifactSizeBytes int64
	OutputAssetID     string
	ErrorCode         string
	ErrorMessage      string
	CreatedBy         string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	CompletedAt       *time.Time
}

type NewRunInput struct {
	TaskRunID   string
	Spec        RunSpec
	TenantID    string
	ProjectID   string
	WorkspaceID *string
	CreatedBy   string
	Now         time.Time
}

func NewRun(input NewRunInput) (Run, error) {
	if strings.TrimSpace(input.TaskRunID) == "" || strings.TrimSpace(input.TenantID) == "" ||
		strings.TrimSpace(input.CreatedBy) == "" || input.Now.IsZero() || !input.Spec.Target.valid() ||
		!input.Spec.Config.Ready() || !input.Spec.OutputOwner.valid() {
		return Run{}, ErrInvalidGeneration
	}
	inputs := append([]ResolvedInput(nil), input.Spec.Inputs...)
	snapshots := append([]generationinput.Input(nil), input.Spec.InputSnapshots...)
	seen := make(map[string]struct{}, len(inputs))
	for index, item := range inputs {
		if item.Position != int32(index) || !item.SourceType.Valid() || strings.TrimSpace(item.AssetID) == "" {
			return Run{}, ErrInvalidGeneration
		}
		if _, duplicate := seen[item.AssetID]; duplicate {
			return Run{}, ErrInvalidGeneration
		}
		seen[item.AssetID] = struct{}{}
	}
	for index, snapshot := range snapshots {
		if snapshot.Ordinal != int32(index) || !snapshot.Valid() {
			return Run{}, ErrInvalidGeneration
		}
	}
	now := input.Now.UTC()
	return Run{
		TaskRunID: input.TaskRunID, TenantID: input.TenantID, ProjectID: input.ProjectID, WorkspaceID: cloneString(input.WorkspaceID),
		Target: input.Spec.Target, Config: input.Spec.Config, Inputs: inputs, InputSnapshots: snapshots,
		OutputOwner: input.Spec.OutputOwner, BindingOutcome: BindingPending,
		Stage: "QUEUED", CreatedBy: input.CreatedBy, CreatedAt: now, UpdatedAt: now,
	}, nil
}
