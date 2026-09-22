package resourceassetgeneration

import (
	"errors"
	"slices"
	"strings"
	"time"

	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
)

var (
	ErrInvalidDraft     = errors.New("invalid resource asset image generation draft")
	ErrRevisionConflict = errors.New("resource asset image generation draft revision conflict")
	ErrRunActive        = errors.New("resource asset image generation run is active")
)

type UploadedReference struct {
	AssetID string
}

type ResourceReference struct {
	ResourceID string
	SequenceNo int64
}

type DraftPatch struct {
	Config             domainimagegeneration.ConfigPatch
	UploadedReferences *[]UploadedReference
	ResourceReferences *[]ResourceReference
}

type Draft struct {
	ID                 string
	TenantID           string
	WorkspaceID        *string
	ResourceID         string
	ResourceAssetID    string
	Config             domainimagegeneration.Config
	UploadedReferences []UploadedReference
	ResourceReferences []ResourceReference
	Revision           int64
	ActiveTaskRunID    string
	CreatedBy          string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	DeletedAt          *time.Time
}

type NewDraftInput struct {
	ID              string
	TenantID        string
	WorkspaceID     *string
	ResourceID      string
	ResourceAssetID string
	CreatedBy       string
	Now             time.Time
}

func NewDraft(input NewDraftInput) (Draft, error) {
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.TenantID) == "" ||
		strings.TrimSpace(input.ResourceID) == "" || strings.TrimSpace(input.ResourceAssetID) == "" ||
		strings.TrimSpace(input.CreatedBy) == "" || input.Now.IsZero() {
		return Draft{}, ErrInvalidDraft
	}
	now := input.Now.UTC()
	return Draft{
		ID: input.ID, TenantID: input.TenantID, WorkspaceID: cloneString(input.WorkspaceID),
		ResourceID: input.ResourceID, ResourceAssetID: input.ResourceAssetID,
		Revision: 1, CreatedBy: input.CreatedBy, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (draft Draft) Ready() bool {
	return draft.Config.Ready() && validUploadedReferences(draft.UploadedReferences) &&
		validResourceReferences(draft.ResourceID, draft.ResourceReferences)
}

func (draft *Draft) Update(patch DraftPatch, expectedRevision int64, now time.Time) (bool, error) {
	if draft.Revision != expectedRevision {
		return false, ErrRevisionConflict
	}
	if now.IsZero() {
		return false, ErrInvalidDraft
	}
	config, configChanged, err := draft.Config.Apply(patch.Config)
	if err != nil {
		return false, ErrInvalidDraft
	}
	uploaded := cloneUploadedReferences(draft.UploadedReferences)
	resources := cloneResourceReferences(draft.ResourceReferences)
	if patch.UploadedReferences != nil {
		uploaded = cloneUploadedReferences(*patch.UploadedReferences)
	}
	if patch.ResourceReferences != nil {
		resources = cloneResourceReferences(*patch.ResourceReferences)
	}
	if !validUploadedReferences(uploaded) || !validResourceReferences(draft.ResourceID, resources) {
		return false, ErrInvalidDraft
	}
	changed := configChanged || !slices.Equal(draft.UploadedReferences, uploaded) ||
		!slices.Equal(draft.ResourceReferences, resources)
	if !changed {
		return false, nil
	}
	draft.Config = config
	draft.UploadedReferences = uploaded
	draft.ResourceReferences = resources
	draft.Revision++
	draft.UpdatedAt = now.UTC()
	return true, nil
}

func (draft *Draft) BeginRun(taskRunID string) error {
	if strings.TrimSpace(taskRunID) == "" {
		return ErrInvalidDraft
	}
	if draft.ActiveTaskRunID == taskRunID {
		return nil
	}
	if draft.ActiveTaskRunID != "" {
		return ErrRunActive
	}
	draft.ActiveTaskRunID = taskRunID
	return nil
}

func (draft *Draft) FinishRun(taskRunID string) bool {
	if draft.ActiveTaskRunID == "" || draft.ActiveTaskRunID != taskRunID {
		return false
	}
	draft.ActiveTaskRunID = ""
	return true
}

func validUploadedReferences(references []UploadedReference) bool {
	seen := make(map[string]struct{}, len(references))
	for _, reference := range references {
		if strings.TrimSpace(reference.AssetID) == "" {
			return false
		}
		if _, exists := seen[reference.AssetID]; exists {
			return false
		}
		seen[reference.AssetID] = struct{}{}
	}
	return true
}

func validResourceReferences(resourceID string, references []ResourceReference) bool {
	seen := make(map[ResourceReference]struct{}, len(references))
	for _, reference := range references {
		if reference.ResourceID != resourceID || reference.SequenceNo < 1 {
			return false
		}
		if _, exists := seen[reference]; exists {
			return false
		}
		seen[reference] = struct{}{}
	}
	return true
}

func cloneUploadedReferences(references []UploadedReference) []UploadedReference {
	return append([]UploadedReference(nil), references...)
}

func cloneResourceReferences(references []ResourceReference) []ResourceReference {
	return append([]ResourceReference(nil), references...)
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
