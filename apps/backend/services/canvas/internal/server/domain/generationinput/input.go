package generationinput

import (
	"errors"
	"strings"
)

var ErrInvalidInput = errors.New("invalid generation input")

type Role string
type Modality string
type SourceNodeType int16

const (
	RoleReference  Role = "REFERENCE"
	RoleFirstFrame Role = "FIRST_FRAME"
	RoleLastFrame  Role = "LAST_FRAME"
)

const (
	ModalityImage Modality = "IMAGE"
	ModalityVideo Modality = "VIDEO"
	ModalityAudio Modality = "AUDIO"
	ModalityText  Modality = "TEXT"
)

// Input is the immutable result selected from one source node when a generation starts.
// Node references stay mutable on the canvas; this snapshot is the execution fact.
type Input struct {
	Ordinal               int32          `json:"ordinal"`
	SourceNodeID          string         `json:"source_node_id"`
	SourceNodeRevision    int64          `json:"source_node_revision"`
	SourceNodeType        SourceNodeType `json:"source_node_type"`
	Modality              Modality       `json:"modality"`
	Role                  Role           `json:"role"`
	SelectedOutputID      string         `json:"selected_output_id,omitempty"`
	ResourceAssetID       string         `json:"resource_asset_id,omitempty"`
	ResourceAssetRevision int64          `json:"resource_asset_revision,omitempty"`
	AssetID               string         `json:"asset_id,omitempty"`
	Text                  string         `json:"text,omitempty"`
	ProviderContentIndex  *int32         `json:"provider_content_index,omitempty"`
}

func (input Input) Valid() bool {
	if input.Ordinal < 0 || strings.TrimSpace(input.SourceNodeID) == "" || input.SourceNodeRevision < 1 ||
		input.SourceNodeType < 1 || !input.Modality.Valid() || !input.Role.Valid() {
		return false
	}
	if input.ResourceAssetID == "" && input.ResourceAssetRevision != 0 ||
		input.ResourceAssetID != "" && input.ResourceAssetRevision < 1 {
		return false
	}
	if input.Modality == ModalityText {
		return strings.TrimSpace(input.Text) != "" && input.AssetID == "" && input.ResourceAssetID == ""
	}
	return strings.TrimSpace(input.AssetID) != "" && input.Text == ""
}

func (modality Modality) Valid() bool {
	return modality == ModalityImage || modality == ModalityVideo || modality == ModalityAudio || modality == ModalityText
}

func (role Role) Valid() bool {
	return role == RoleReference || role == RoleFirstFrame || role == RoleLastFrame
}
