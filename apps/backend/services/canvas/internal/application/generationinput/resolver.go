package generationinput

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaingenerationinput "github.com/example/monorepo/canvas/internal/domain/generationinput"
)

var (
	ErrSourceNotFound      = errors.New("generation input source node not found")
	ErrSourceNotConnected  = errors.New("generation input source node is not connected")
	ErrSourceOutputMissing = errors.New("generation input source node has no selected output")
	ErrSourceDeleted       = errors.New("generation input source reference was deleted")
	ErrUnsupportedModality = errors.New("generation input modality is unsupported")
)

type Scope struct{ OrgID, UserID string }
type ResourceAssetReference struct {
	ResourceAssetID string
	Revision        int64
	Asset           domainasset.Asset
}

var ErrResourceNotFound = errors.New("resource not found")

type ResourceResolver interface {
	ResolveCurrentResourceAsset(context.Context, Scope, string, string) (ResourceAssetReference, error)
	ResolvePrimaryResourceAsset(context.Context, Scope, string, string) (ResourceAssetReference, error)
}

type Resolver struct{ resources ResourceResolver }

type Result struct {
	Prompt string
	Inputs []domaingenerationinput.Input
}

type textDefinition struct {
	name    string
	content string
}

type AllowedModalities map[domaingenerationinput.Modality]struct{}

func New(resources ResourceResolver) *Resolver { return &Resolver{resources: resources} }

func Modalities(values ...domaingenerationinput.Modality) AllowedModalities {
	result := make(AllowedModalities, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func AllModalities() AllowedModalities {
	return Modalities(domaingenerationinput.ModalityImage, domaingenerationinput.ModalityVideo, domaingenerationinput.ModalityAudio, domaingenerationinput.ModalityText)
}

// HasReferenceInputEdges reports whether provider inputs must be resolved even
// when the prompt contains no explicit mentions.
func HasReferenceInputEdges(target domaincanvas.CanvasNode) bool {
	if HasMediaInputEdges(target) {
		return true
	}
	for _, edge := range target.IncomingEdges {
		if edge.TargetPort == domaincanvas.PortReferenceText {
			return true
		}
	}
	return false
}

// HasMediaInputEdges reports whether provider media must be resolved even when
// the prompt contains no explicit mentions.
func HasMediaInputEdges(target domaincanvas.CanvasNode) bool {
	for _, edge := range target.IncomingEdges {
		if edge.TargetPort == domaincanvas.PortReferenceImage ||
			edge.TargetPort == domaincanvas.PortReferenceVideo ||
			edge.TargetPort == domaincanvas.PortReferenceAudio {
			return true
		}
	}
	return false
}

// ResolveImageGeneration treats image edges as authoritative provider inputs.
// Legacy media mentions only render aliases and never select or reorder images.
func (resolver *Resolver) ResolveImageGeneration(ctx context.Context, scope Scope, projectID string, target domaincanvas.CanvasNode, nodes []domaincanvas.CanvasNode) (Result, error) {
	mentionIDs, err := domaincanvas.AssetMentionIDs(target.Prompt)
	if err != nil {
		return Result{}, err
	}
	byID := make(map[string]domaincanvas.CanvasNode, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
	}
	imageEdges := make([]domaincanvas.IncomingEdge, 0, len(target.IncomingEdges))
	textEdges := make([]domaincanvas.IncomingEdge, 0, len(target.IncomingEdges))
	connectedText := make(map[string]struct{}, len(target.IncomingEdges))
	for _, edge := range target.IncomingEdges {
		if source, exists := byID[edge.SourceNodeID]; exists && source.ReferenceStatus == domaincanvas.ReferenceStatusDeleted {
			continue
		}
		switch edge.TargetPort {
		case domaincanvas.PortReferenceImage:
			imageEdges = append(imageEdges, edge)
		case domaincanvas.PortReferenceText:
			connectedText[edge.SourceNodeID] = struct{}{}
			textEdges = append(textEdges, edge)
		}
	}
	sort.SliceStable(imageEdges, func(i, j int) bool {
		return imageEdges[i].TargetOrder < imageEdges[j].TargetOrder
	})
	sort.SliceStable(textEdges, func(i, j int) bool {
		return textEdges[i].TargetOrder < textEdges[j].TargetOrder
	})

	inputs := make([]domaingenerationinput.Input, 0, len(imageEdges)+len(textEdges))
	aliases := make(map[string]string, len(imageEdges)+len(mentionIDs))
	bySource := make(map[string]domaingenerationinput.Input, len(textEdges))
	for _, edge := range imageEdges {
		source, exists := byID[edge.SourceNodeID]
		if !exists {
			return Result{}, ErrSourceNotFound
		}
		input, resolveErr := resolver.resolveNode(ctx, scope, projectID, source, domaingenerationinput.RoleReference)
		if errors.Is(resolveErr, ErrSourceDeleted) {
			aliases[source.ID] = ""
			continue
		}
		if resolveErr != nil {
			return Result{}, resolveErr
		}
		if input.Modality != domaingenerationinput.ModalityImage {
			return Result{}, ErrUnsupportedModality
		}
		input.Ordinal = int32(len(inputs))
		inputs = append(inputs, input)
		if _, exists = aliases[source.ID]; !exists {
			aliases[source.ID] = "图片" + strconv.Itoa(len(inputs))
		}
	}
	for _, sourceID := range mentionIDs {
		if _, exists := aliases[sourceID]; exists {
			continue
		}
		source, exists := byID[sourceID]
		if !exists {
			return Result{}, ErrSourceNotFound
		}
		if source.ReferenceStatus == domaincanvas.ReferenceStatusDeleted {
			aliases[sourceID] = ""
			continue
		}
		modality, supported := nodeModality(source)
		if !supported {
			return Result{}, ErrSourceOutputMissing
		}
		if modality != domaingenerationinput.ModalityText {
			aliases[sourceID] = ""
			continue
		}
		if _, exists = connectedText[sourceID]; !exists {
			return Result{}, ErrSourceNotConnected
		}
	}
	consumedText := make(map[string]struct{}, len(textEdges))
	textNames := make(map[string]string, len(textEdges))
	for _, edge := range textEdges {
		if _, exists := consumedText[edge.SourceNodeID]; exists {
			continue
		}
		source, exists := byID[edge.SourceNodeID]
		if !exists {
			return Result{}, ErrSourceNotFound
		}
		input, resolveErr := resolver.resolveNode(ctx, scope, projectID, source, domaingenerationinput.RoleReference)
		if errors.Is(resolveErr, ErrSourceDeleted) {
			aliases[edge.SourceNodeID] = ""
			consumedText[edge.SourceNodeID] = struct{}{}
			continue
		}
		if resolveErr != nil {
			return Result{}, resolveErr
		}
		if input.Modality != domaingenerationinput.ModalityText {
			return Result{}, ErrUnsupportedModality
		}
		input.Ordinal = int32(len(inputs))
		inputs = append(inputs, input)
		bySource[edge.SourceNodeID] = input
		textNames[edge.SourceNodeID] = textDefinitionName(source)
		consumedText[edge.SourceNodeID] = struct{}{}
	}
	prompt, err := domaincanvas.RewriteAssetMentionsWithLabel(target.Prompt, func(sourceID, label string) (string, error) {
		alias, exists := aliases[sourceID]
		if exists {
			return alias, nil
		}
		input, exists := bySource[sourceID]
		if !exists || input.Modality != domaingenerationinput.ModalityText {
			return "", ErrSourceNotFound
		}
		name := textNames[sourceID]
		if name == sourceID && label != "" {
			name = label
			textNames[sourceID] = name
		}
		return textPlaceholder(name), nil
	})
	if err != nil {
		return Result{}, err
	}
	return Result{Prompt: appendTextDefinitions(prompt, definitionsForEdges(textEdges, bySource, textNames)), Inputs: inputs}, nil
}

func (resolver *Resolver) ResolveMentions(ctx context.Context, scope Scope, projectID string, target domaincanvas.CanvasNode, nodes []domaincanvas.CanvasNode, allowed AllowedModalities) (Result, error) {
	mentionIDs, err := domaincanvas.AssetMentionIDs(target.Prompt)
	if err != nil {
		return Result{}, err
	}
	byID := make(map[string]domaincanvas.CanvasNode, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
	}
	connected := make(map[string]struct{}, len(target.IncomingEdges))
	mediaEdges := make([]domaincanvas.IncomingEdge, 0, len(target.IncomingEdges))
	textEdges := make([]domaincanvas.IncomingEdge, 0, len(target.IncomingEdges))
	for _, edge := range target.IncomingEdges {
		if source, exists := byID[edge.SourceNodeID]; exists && source.ReferenceStatus == domaincanvas.ReferenceStatusDeleted {
			continue
		}
		switch edge.TargetPort {
		case domaincanvas.PortReferenceImage, domaincanvas.PortReferenceVideo, domaincanvas.PortReferenceAudio:
			connected[edge.SourceNodeID] = struct{}{}
			mediaEdges = append(mediaEdges, edge)
		case domaincanvas.PortReferenceText:
			connected[edge.SourceNodeID] = struct{}{}
			textEdges = append(textEdges, edge)
		}
	}
	// Explicit mentions retain their established input ordering. Edge-only
	// references are appended deterministically by modality and target order.
	sort.SliceStable(mediaEdges, func(i, j int) bool {
		left, right := referencePortOrder(mediaEdges[i].TargetPort), referencePortOrder(mediaEdges[j].TargetPort)
		if left != right {
			return left < right
		}
		return mediaEdges[i].TargetOrder < mediaEdges[j].TargetOrder
	})
	sort.SliceStable(textEdges, func(i, j int) bool {
		return textEdges[i].TargetOrder < textEdges[j].TargetOrder
	})
	inputs := make([]domaingenerationinput.Input, 0, len(mentionIDs)+len(mediaEdges)+len(textEdges))
	bySource := make(map[string]domaingenerationinput.Input, len(mentionIDs))
	textNames := make(map[string]string, len(textEdges))
	consumed := make(map[string]struct{}, len(mentionIDs)+len(mediaEdges))
	mediaCounts := make(map[domaingenerationinput.Modality]int)
	aliases := make(map[string]string, len(mentionIDs)+len(mediaEdges))
	for _, sourceID := range mentionIDs {
		source, exists := byID[sourceID]
		if !exists {
			return Result{}, ErrSourceNotFound
		}
		if source.ReferenceStatus == domaincanvas.ReferenceStatusDeleted {
			aliases[sourceID] = ""
			consumed[sourceID] = struct{}{}
			continue
		}
		if _, exists = connected[sourceID]; !exists {
			return Result{}, ErrSourceNotConnected
		}
		input, resolveErr := resolver.resolveNode(ctx, scope, projectID, source, domaingenerationinput.RoleReference)
		if errors.Is(resolveErr, ErrSourceDeleted) {
			aliases[sourceID] = ""
			consumed[sourceID] = struct{}{}
			continue
		}
		if resolveErr != nil {
			return Result{}, resolveErr
		}
		if _, exists = allowed[input.Modality]; !exists {
			return Result{}, ErrUnsupportedModality
		}
		input.Ordinal = int32(len(inputs))
		inputs = append(inputs, input)
		bySource[sourceID] = input
		if input.Modality == domaingenerationinput.ModalityText {
			textNames[sourceID] = textDefinitionName(source)
		}
		consumed[sourceID] = struct{}{}
	}
	for _, edge := range mediaEdges {
		if _, exists := consumed[edge.SourceNodeID]; exists {
			continue
		}
		source, exists := byID[edge.SourceNodeID]
		if !exists {
			return Result{}, ErrSourceNotFound
		}
		input, resolveErr := resolver.resolveNode(ctx, scope, projectID, source, domaingenerationinput.RoleReference)
		if errors.Is(resolveErr, ErrSourceDeleted) {
			consumed[edge.SourceNodeID] = struct{}{}
			continue
		}
		if resolveErr != nil {
			return Result{}, resolveErr
		}
		edgeModality, supported := referencePortModality(edge.TargetPort)
		if !supported || input.Modality != edgeModality {
			return Result{}, ErrUnsupportedModality
		}
		if _, exists = allowed[input.Modality]; !exists {
			return Result{}, ErrUnsupportedModality
		}
		input.Ordinal = int32(len(inputs))
		inputs = append(inputs, input)
		consumed[edge.SourceNodeID] = struct{}{}
	}
	for _, edge := range textEdges {
		if _, exists := consumed[edge.SourceNodeID]; exists {
			continue
		}
		source, exists := byID[edge.SourceNodeID]
		if !exists {
			return Result{}, ErrSourceNotFound
		}
		input, resolveErr := resolver.resolveNode(ctx, scope, projectID, source, domaingenerationinput.RoleReference)
		if errors.Is(resolveErr, ErrSourceDeleted) {
			aliases[edge.SourceNodeID] = ""
			consumed[edge.SourceNodeID] = struct{}{}
			continue
		}
		if resolveErr != nil {
			return Result{}, resolveErr
		}
		if input.Modality != domaingenerationinput.ModalityText {
			return Result{}, ErrUnsupportedModality
		}
		if _, exists = allowed[input.Modality]; !exists {
			return Result{}, ErrUnsupportedModality
		}
		input.Ordinal = int32(len(inputs))
		inputs = append(inputs, input)
		bySource[edge.SourceNodeID] = input
		textNames[edge.SourceNodeID] = textDefinitionName(source)
		consumed[edge.SourceNodeID] = struct{}{}
	}
	prompt, err := domaincanvas.RewriteAssetMentionsWithLabel(target.Prompt, func(sourceID, label string) (string, error) {
		if alias, exists := aliases[sourceID]; exists {
			return alias, nil
		}
		input, exists := bySource[sourceID]
		if !exists {
			return "", ErrSourceNotFound
		}
		if input.Modality == domaingenerationinput.ModalityText {
			name := textNames[sourceID]
			if name == sourceID && label != "" {
				name = label
				textNames[sourceID] = name
			}
			return textPlaceholder(name), nil
		}
		mediaCounts[input.Modality]++
		alias := modalityLabel(input.Modality) + strconv.Itoa(mediaCounts[input.Modality])
		aliases[sourceID] = alias
		return alias, nil
	})
	if err != nil {
		return Result{}, err
	}
	return Result{Prompt: appendTextDefinitions(prompt, definitionsForEdges(textEdges, bySource, textNames)), Inputs: inputs}, nil
}

func textDefinitionName(source domaincanvas.CanvasNode) string {
	if source.Name != "" {
		return source.Name
	}
	return source.ID
}

func textPlaceholder(name string) string { return "{{" + name + "}}" }

func definitionsForEdges(edges []domaincanvas.IncomingEdge, inputs map[string]domaingenerationinput.Input, names map[string]string) []textDefinition {
	definitions := make([]textDefinition, 0, len(edges))
	appended := make(map[string]struct{}, len(edges))
	for _, edge := range edges {
		if _, exists := appended[edge.SourceNodeID]; exists {
			continue
		}
		input, exists := inputs[edge.SourceNodeID]
		if !exists || input.Modality != domaingenerationinput.ModalityText {
			continue
		}
		definitions = append(definitions, textDefinition{name: names[edge.SourceNodeID], content: input.Text})
		appended[edge.SourceNodeID] = struct{}{}
	}
	return definitions
}

func appendTextDefinitions(prompt string, definitions []textDefinition) string {
	if len(definitions) == 0 {
		return prompt
	}
	formatted := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		formatted = append(formatted, "{"+definition.name+":"+strconv.Quote(definition.content)+"}")
	}
	if prompt == "" {
		return strings.Join(formatted, "\n")
	}
	separator := "\n"
	if strings.HasSuffix(prompt, "\n") {
		separator = ""
	}
	return prompt + separator + strings.Join(formatted, "\n")
}

func referencePortOrder(port domaincanvas.Port) int {
	switch port {
	case domaincanvas.PortReferenceImage:
		return 0
	case domaincanvas.PortReferenceVideo:
		return 1
	case domaincanvas.PortReferenceAudio:
		return 2
	default:
		return 3
	}
}

func referencePortModality(port domaincanvas.Port) (domaingenerationinput.Modality, bool) {
	switch port {
	case domaincanvas.PortReferenceImage:
		return domaingenerationinput.ModalityImage, true
	case domaincanvas.PortReferenceVideo:
		return domaingenerationinput.ModalityVideo, true
	case domaincanvas.PortReferenceAudio:
		return domaingenerationinput.ModalityAudio, true
	default:
		return "", false
	}
}

func (resolver *Resolver) ResolveFrames(ctx context.Context, scope Scope, projectID string, target domaincanvas.CanvasNode, nodes []domaincanvas.CanvasNode) (Result, error) {
	byID := make(map[string]domaincanvas.CanvasNode, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
	}
	inputs := make([]domaingenerationinput.Input, 0, 2)
	for _, port := range []domaincanvas.Port{domaincanvas.PortFirstFrame, domaincanvas.PortLastFrame} {
		for _, edge := range target.IncomingEdges {
			if edge.TargetPort != port {
				continue
			}
			source, exists := byID[edge.SourceNodeID]
			if !exists {
				return Result{}, ErrSourceNotFound
			}
			if source.ReferenceStatus == domaincanvas.ReferenceStatusDeleted {
				continue
			}
			role := domaingenerationinput.RoleFirstFrame
			if port == domaincanvas.PortLastFrame {
				role = domaingenerationinput.RoleLastFrame
			}
			input, err := resolver.resolveNode(ctx, scope, projectID, source, role)
			if errors.Is(err, ErrSourceDeleted) {
				continue
			}
			if err != nil {
				return Result{}, err
			}
			if input.Modality != domaingenerationinput.ModalityImage {
				return Result{}, ErrUnsupportedModality
			}
			input.Ordinal = int32(len(inputs))
			inputs = append(inputs, input)
		}
	}
	if len(inputs) == 0 {
		return Result{}, ErrSourceOutputMissing
	}
	prompt, err := domaincanvas.ReplaceAssetMentionsWithLabels(target.Prompt)
	if err != nil {
		return Result{}, err
	}
	return Result{Prompt: prompt, Inputs: inputs}, nil
}

func (resolver *Resolver) resolveNode(ctx context.Context, scope Scope, projectID string, source domaincanvas.CanvasNode, role domaingenerationinput.Role) (domaingenerationinput.Input, error) {
	if source.ReferenceStatus == domaincanvas.ReferenceStatusDeleted {
		return domaingenerationinput.Input{}, ErrSourceOutputMissing
	}
	modality, ok := nodeModality(source)
	if !ok || source.Revision < 1 {
		return domaingenerationinput.Input{}, ErrSourceOutputMissing
	}
	input := domaingenerationinput.Input{SourceNodeID: source.ID, SourceNodeRevision: source.Revision, SourceNodeType: domaingenerationinput.SourceNodeType(source.Type), Modality: modality, Role: role}
	switch source.Type {
	case domaincanvas.NodeTypeText:
		input.Text = strings.TrimSpace(source.Text)
	case domaincanvas.NodeTypeTextGeneration:
		input.SelectedOutputID, input.Text = source.SelectedOutputID, strings.TrimSpace(source.SelectedOutputText)
		if input.Text == "" {
			return domaingenerationinput.Input{}, ErrSourceOutputMissing
		}
	case domaincanvas.NodeTypeImageGeneration, domaincanvas.NodeTypeVideoGeneration:
		if source.ResourceAssetID != "" {
			if resolver == nil || resolver.resources == nil {
				return domaingenerationinput.Input{}, ErrSourceOutputMissing
			}
			resolved, err := resolver.resources.ResolveCurrentResourceAsset(ctx, scope, projectID, source.ResourceAssetID)
			if err != nil {
				if errors.Is(err, ErrResourceNotFound) {
					return domaingenerationinput.Input{}, ErrSourceDeleted
				}
				return domaingenerationinput.Input{}, err
			}
			input.ResourceAssetID, input.ResourceAssetRevision, input.AssetID = resolved.ResourceAssetID, resolved.Revision, resolved.Asset.ID
		} else {
			input.SelectedOutputID, input.AssetID = source.SelectedOutputID, source.SelectedAssetID
			if input.AssetID == "" {
				return domaingenerationinput.Input{}, ErrSourceOutputMissing
			}
		}
	case domaincanvas.NodeTypeImageAsset, domaincanvas.NodeTypeVideoAsset, domaincanvas.NodeTypeAudioAsset:
		if source.ResourceID != "" {
			if resolver == nil || resolver.resources == nil {
				return domaingenerationinput.Input{}, ErrSourceOutputMissing
			}
			resolved, err := resolver.resources.ResolvePrimaryResourceAsset(ctx, scope, projectID, source.ResourceID)
			if err != nil {
				if errors.Is(err, ErrResourceNotFound) {
					return domaingenerationinput.Input{}, ErrSourceDeleted
				}
				return domaingenerationinput.Input{}, err
			}
			expectedMediaType, validModality := AssetMediaType(input)
			if !validModality || resolved.Asset.MediaType != expectedMediaType {
				return domaingenerationinput.Input{}, ErrUnsupportedModality
			}
			input.ResourceAssetID, input.ResourceAssetRevision, input.AssetID = resolved.ResourceAssetID, resolved.Revision, resolved.Asset.ID
		} else if source.ResourceAssetID != "" {
			if resolver == nil || resolver.resources == nil {
				return domaingenerationinput.Input{}, ErrSourceOutputMissing
			}
			resolved, err := resolver.resources.ResolveCurrentResourceAsset(ctx, scope, projectID, source.ResourceAssetID)
			if err != nil {
				if errors.Is(err, ErrResourceNotFound) {
					return domaingenerationinput.Input{}, ErrSourceDeleted
				}
				return domaingenerationinput.Input{}, err
			}
			expectedMediaType, validModality := AssetMediaType(input)
			if !validModality || resolved.Asset.MediaType != expectedMediaType {
				return domaingenerationinput.Input{}, ErrUnsupportedModality
			}
			input.ResourceAssetID, input.ResourceAssetRevision, input.AssetID = resolved.ResourceAssetID, resolved.Revision, resolved.Asset.ID
		} else {
			input.AssetID = source.AssetID
		}
	default:
		return domaingenerationinput.Input{}, ErrSourceOutputMissing
	}
	if !input.Valid() {
		return domaingenerationinput.Input{}, ErrSourceOutputMissing
	}
	return input, nil
}

func nodeModality(node domaincanvas.CanvasNode) (domaingenerationinput.Modality, bool) {
	switch node.Type {
	case domaincanvas.NodeTypeImageAsset, domaincanvas.NodeTypeImageGeneration:
		return domaingenerationinput.ModalityImage, true
	case domaincanvas.NodeTypeVideoAsset, domaincanvas.NodeTypeVideoGeneration:
		return domaingenerationinput.ModalityVideo, true
	case domaincanvas.NodeTypeAudioAsset:
		return domaingenerationinput.ModalityAudio, true
	case domaincanvas.NodeTypeText, domaincanvas.NodeTypeTextGeneration:
		return domaingenerationinput.ModalityText, true
	default:
		return "", false
	}
}

func modalityLabel(modality domaingenerationinput.Modality) string {
	switch modality {
	case domaingenerationinput.ModalityImage:
		return "图片"
	case domaingenerationinput.ModalityVideo:
		return "视频"
	case domaingenerationinput.ModalityAudio:
		return "音频"
	default:
		return "引用"
	}
}

func AssetMediaType(input domaingenerationinput.Input) (domainasset.MediaType, bool) {
	switch input.Modality {
	case domaingenerationinput.ModalityImage:
		return domainasset.MediaImage, true
	case domaingenerationinput.ModalityVideo:
		return domainasset.MediaVideo, true
	case domaingenerationinput.ModalityAudio:
		return domainasset.MediaAudio, true
	default:
		return 0, false
	}
}
