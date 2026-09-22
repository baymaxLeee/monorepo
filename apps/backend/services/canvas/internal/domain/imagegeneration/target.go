package imagegeneration

import (
	"strings"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
)

type TargetType string

const (
	TargetResourceAsset TargetType = "RESOURCE_ASSET"
	TargetCanvasNode    TargetType = "CANVAS_NODE"
)

func (target TargetType) Valid() bool {
	value := strings.TrimSpace(string(target))
	return value != "" && len(value) <= 64
}

type TargetRef struct {
	Type     TargetType
	ID       string
	Revision int64
}

func (target TargetRef) valid() bool {
	return target.Type.Valid() && strings.TrimSpace(target.ID) != "" && target.Revision > 0
}

type InputSourceType string

const (
	InputSourceUploaded      InputSourceType = "UPLOADED"
	InputSourceResourceAsset InputSourceType = "RESOURCE_ASSET"
	InputSourceCanvasNode    InputSourceType = "CANVAS_NODE"
)

func (source InputSourceType) Valid() bool {
	return source == InputSourceUploaded || source == InputSourceResourceAsset || source == InputSourceCanvasNode
}

type ResolvedInput struct {
	Position   int32
	SourceType InputSourceType
	AssetID    string
}

type OutputAssetOwner struct {
	Type domainasset.OwnerType
	ID   string
}

func (owner OutputAssetOwner) valid() bool {
	return owner.Type.Valid() && strings.TrimSpace(owner.ID) != ""
}

type RunSpec struct {
	Target         TargetRef
	Config         Config
	Inputs         []ResolvedInput
	InputSnapshots []domaingenerationinput.Input
	OutputOwner    OutputAssetOwner
}

type BindingOutcome string

const (
	BindingPending           BindingOutcome = "PENDING"
	BindingBound             BindingOutcome = "BOUND"
	BindingTargetInvalidated BindingOutcome = "TARGET_INVALIDATED"
)

func (outcome BindingOutcome) Valid() bool {
	return outcome == BindingPending || outcome == BindingBound || outcome == BindingTargetInvalidated
}
