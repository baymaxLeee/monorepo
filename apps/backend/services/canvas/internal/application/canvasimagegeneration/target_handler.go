package canvasimagegeneration

import (
	"context"
	"errors"
	"strings"
	"time"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	applicationgenerationinput "github.com/example/monorepo/canvas/internal/application/canvasgenerationinput"
	applicationimagegeneration "github.com/example/monorepo/canvas/internal/application/imagegeneration"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
	domainimagegeneration "github.com/example/monorepo/canvas/internal/domain/imagegeneration"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
)

var (
	ErrNodeNotReady     = errors.New("canvas image generation node is not ready")
	ErrModelUnavailable = errors.New("canvas image generation model is unavailable")
	ErrRunConflict      = errors.New("canvas image generation run conflict")
)

type Store interface {
	List(context.Context, applicationcanvas.Scope, string, string) ([]domaincanvas.CanvasNode, error)
	GetByID(context.Context, applicationcanvas.Scope, string) (domaincanvas.CanvasNode, error)
	ClaimTaskRun(context.Context, domaincanvas.CanvasNode) (bool, error)
	ReleaseTaskRun(context.Context, domaincanvas.CanvasNode, string) (bool, error)
	BindGeneratedAsset(context.Context, applicationcanvas.Scope, string, string, string, string, string, domaincanvas.NodeType, time.Time) (bool, error)
	applicationcanvas.CanvasResourceResolver
}

type TargetHandler struct{ store Store }

func NewTargetHandler(store Store) *TargetHandler { return &TargetHandler{store: store} }
func (*TargetHandler) TargetType() domainimagegeneration.TargetType {
	return domainimagegeneration.TargetCanvasNode
}

func (h *TargetHandler) PrepareStart(ctx context.Context, target applicationimagegeneration.StartTarget, taskRunID string) (domainimagegeneration.RunSpec, error) {
	if h == nil || h.store == nil || target.TargetType != h.TargetType() {
		return domainimagegeneration.RunSpec{}, domainimagegeneration.ErrInvalidGeneration
	}
	scope := applicationcanvas.Scope{TenantID: target.TenantID, WorkspaceID: target.WorkspaceID, CallerID: target.CallerID}
	node, err := h.store.GetByID(ctx, scope, target.TargetID)
	if err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	if node.Type != domaincanvas.NodeTypeImageGeneration || node.Revision != target.ExpectedRevision || strings.TrimSpace(node.Prompt) == "" || node.ActiveTaskRunID != "" {
		return domainimagegeneration.RunSpec{}, ErrNodeNotReady
	}
	if strings.TrimSpace(node.GenerationConfig.ModelServiceID) == "" {
		return domainimagegeneration.RunSpec{}, ErrModelUnavailable
	}
	if err := node.BeginGeneration(taskRunID); err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	claimed, err := h.store.ClaimTaskRun(ctx, node)
	if err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	if !claimed {
		return domainimagegeneration.RunSpec{}, ErrRunConflict
	}
	resolved, err := h.resolveInputs(ctx, scope, node)
	if err != nil {
		return domainimagegeneration.RunSpec{}, err
	}
	return domainimagegeneration.RunSpec{
		Target: domainimagegeneration.TargetRef{Type: h.TargetType(), ID: node.ID, Revision: node.Revision},
		Config: domainimagegeneration.Config{Prompt: resolved.Prompt, ModelID: node.GenerationConfig.ModelServiceID, Resolution: imageResolution(node.GenerationConfig.Resolution), AspectRatio: domainimagegeneration.AspectRatio(node.GenerationConfig.AspectRatio.ProviderValue()), Watermark: node.GenerationConfig.Watermark},
		Inputs: resolved.AssetInputs, InputSnapshots: resolved.Snapshots,
		OutputOwner: domainimagegeneration.OutputAssetOwner{Type: domainasset.OwnerProject, ID: node.ProjectID},
	}, nil
}

func (h *TargetHandler) BindResult(ctx context.Context, run domainimagegeneration.Run, outputAssetID string) (domainimagegeneration.BindingOutcome, error) {
	scope := applicationcanvas.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	node, err := h.store.GetByID(ctx, scope, run.Target.ID)
	if err != nil {
		if errors.Is(err, applicationcanvas.ErrNotFound) {
			return domainimagegeneration.BindingTargetInvalidated, nil
		}
		return "", err
	}
	bound, err := h.store.BindGeneratedAsset(ctx, scope, node.ProjectID, node.CanvasID, node.ID, run.TaskRunID, outputAssetID, domaincanvas.NodeTypeImageGeneration, run.UpdatedAt)
	if err != nil {
		return "", err
	}
	if !bound {
		return domainimagegeneration.BindingTargetInvalidated, nil
	}
	return domainimagegeneration.BindingBound, nil
}

func (h *TargetHandler) ReleaseRun(ctx context.Context, run domainimagegeneration.Run) error {
	scope := applicationcanvas.Scope{TenantID: run.TenantID, WorkspaceID: run.WorkspaceID, CallerID: run.CreatedBy}
	node, err := h.store.GetByID(ctx, scope, run.Target.ID)
	if err != nil {
		if errors.Is(err, applicationcanvas.ErrNotFound) {
			return nil
		}
		return err
	}
	if node.ActiveTaskRunID == "" {
		return nil
	}
	if node.ActiveTaskRunID != run.TaskRunID {
		return ErrRunConflict
	}
	_, err = h.store.ReleaseTaskRun(ctx, node, run.TaskRunID)
	return err
}

func (h *TargetHandler) FailRun(ctx context.Context, run domainimagegeneration.Run) error {
	return h.ReleaseRun(ctx, run)
}

type resolvedInputs struct {
	Prompt      string
	AssetInputs []domainimagegeneration.ResolvedInput
	Snapshots   []domaingenerationinput.Input
}

func (h *TargetHandler) resolveInputs(ctx context.Context, scope applicationcanvas.Scope, target domaincanvas.CanvasNode) (resolvedInputs, error) {
	nodes, err := h.store.List(ctx, scope, target.ProjectID, target.CanvasID)
	if err != nil {
		return resolvedInputs{}, err
	}
	resolved, err := applicationgenerationinput.New(h.store).ResolveImageGeneration(
		ctx, scope, target.ProjectID, target, nodes,
	)
	if err != nil {
		return resolvedInputs{}, err
	}
	inputs := make([]domainimagegeneration.ResolvedInput, 0, len(resolved.Inputs))
	for index := range resolved.Inputs {
		snapshot := &resolved.Inputs[index]
		if snapshot.AssetID == "" {
			continue
		}
		providerIndex := int32(len(inputs))
		snapshot.ProviderContentIndex = &providerIndex
		inputs = append(inputs, domainimagegeneration.ResolvedInput{Position: providerIndex, SourceType: domainimagegeneration.InputSourceCanvasNode, AssetID: snapshot.AssetID})
	}
	return resolvedInputs{Prompt: resolved.Prompt, AssetInputs: inputs, Snapshots: resolved.Inputs}, nil
}

func imageResolution(value domainvideo.Resolution) domainimagegeneration.Resolution {
	switch value {
	case domainvideo.Resolution480:
		return domainimagegeneration.Resolution480P
	case domainvideo.Resolution1080:
		return domainimagegeneration.Resolution1080P
	case domainvideo.Resolution4K:
		return domainimagegeneration.Resolution4K
	default:
		return domainimagegeneration.Resolution720P
	}
}

var _ applicationimagegeneration.TargetHandler = (*TargetHandler)(nil)
