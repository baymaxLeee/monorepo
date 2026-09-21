package canvas

import (
	"errors"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	domainvideo "github.com/example/monorepo/canvas/internal/server/domain/videogeneration"
)

var (
	ErrInvalidCanvasNode = errors.New("invalid canvas node")
	ErrInvalidEdge       = errors.New("invalid canvas edge")
	ErrCycleDetected     = errors.New("canvas edge creates a cycle")
	ErrPortCapacity      = errors.New("canvas target port capacity exceeded")
	ErrInputModeConflict = errors.New("canvas video input mode conflict")
)

type NodeType int16

const (
	NodeTypeImageAsset NodeType = iota + 1
	NodeTypeVideoAsset
	NodeTypeAudioAsset
	NodeTypeText
	NodeTypeImageGeneration
	NodeTypeVideoGeneration
	NodeTypeTextGeneration
)

func (m VideoInputMode) Valid() bool {
	return m == VideoInputModeReference || m == VideoInputModeFirstLastFrame
}

func (t NodeType) Valid() bool { return t >= NodeTypeImageAsset && t <= NodeTypeTextGeneration }

func DefaultCanvasNodeName(nodeType NodeType) string {
	switch nodeType {
	case NodeTypeImageAsset:
		return "图片"
	case NodeTypeVideoAsset:
		return "视频"
	case NodeTypeAudioAsset:
		return "音频"
	case NodeTypeText:
		return "文本"
	case NodeTypeImageGeneration:
		return "图片生成"
	case NodeTypeVideoGeneration:
		return "视频生成"
	case NodeTypeTextGeneration:
		return "文本生成"
	default:
		return ""
	}
}

func ValidCanvasNodeName(name string) bool {
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 50 {
		return false
	}
	first, _ := utf8.DecodeRuneInString(name)
	last, _ := utf8.DecodeLastRuneInString(name)
	invalidBoundary := func(value rune) bool {
		return value == '-' || value == '_' || unicode.IsSpace(value)
	}
	return !invalidBoundary(first) && !invalidBoundary(last)
}

type MediaType int16

const (
	MediaTypeImage MediaType = iota + 1
	MediaTypeVideo
	MediaTypeAudio
	MediaTypeText
)

type ReferenceType int16

const (
	ReferenceTypeUnspecified ReferenceType = iota
	ReferenceTypeAsset
	ReferenceTypeResource
	ReferenceTypeResourceAsset
)

func (t ReferenceType) Valid() bool {
	return t >= ReferenceTypeAsset && t <= ReferenceTypeResourceAsset
}

type ReferenceStatus int16

const (
	ReferenceStatusUnspecified ReferenceStatus = iota
	ReferenceStatusActive
	ReferenceStatusDeleted
)

type VideoInputMode int16

const (
	VideoInputModeReference VideoInputMode = iota + 1
	VideoInputModeFirstLastFrame
)

type Port string

const (
	PortOutput         Port = "OUTPUT"
	PortReferenceImage Port = "REFERENCE_IMAGE"
	PortReferenceVideo Port = "REFERENCE_VIDEO"
	PortReferenceAudio Port = "REFERENCE_AUDIO"
	PortReferenceText  Port = "REFERENCE_TEXT"
	PortFirstFrame     Port = "FIRST_FRAME"
	PortLastFrame      Port = "LAST_FRAME"
)

type IncomingEdge struct {
	ID           string `json:"id"`
	SourceNodeID string `json:"source_node_id"`
	SourcePort   Port   `json:"source_port"`
	TargetPort   Port   `json:"target_port"`
	TargetOrder  int32  `json:"target_order"`
}

type Position struct {
	PositionX float64
	PositionY float64
}

func (p Position) Valid() bool {
	return !math.IsNaN(p.PositionX) && !math.IsInf(p.PositionX, 0) &&
		!math.IsNaN(p.PositionY) && !math.IsInf(p.PositionY, 0)
}

type UpdatePatch struct {
	ExpectedRevision int64
	Name             *string
	Prompt           *string
	Text             *string
	Position         *Position
	IncomingEdges    *[]IncomingEdge
	VideoInputMode   *VideoInputMode
	GenerationConfig domainvideo.ConfigPatch
}

func (p UpdatePatch) Empty() bool {
	return p.Name == nil && p.Prompt == nil && p.Text == nil && p.Position == nil &&
		p.IncomingEdges == nil && p.VideoInputMode == nil && p.GenerationConfig.Empty()
}

type CanvasNode struct {
	ID                            string
	TenantID                      string
	WorkspaceID                   *string
	ProjectID                     string
	CanvasID                      string
	Type                          NodeType
	ReferenceType                 ReferenceType
	Name                          string
	HasPersistedName              bool
	Position                      Position
	StoryboardRank                int64
	Prompt                        string
	Text                          string
	AssetID                       string
	ResourceID                    string
	ResourceAssetID               string
	CurrentAssetID                string
	ResourceAssetRevision         int64
	ResourceAssetIsPrimary        bool
	ReferenceStatus               ReferenceStatus
	VideoInputMode                VideoInputMode
	IncomingEdges                 []IncomingEdge
	GenerationConfig              domainvideo.Config
	Revision                      int64
	ActiveTaskRunID               string
	SelectedOutputID              string
	SelectedAssetID               string
	SelectedOutputText            string
	FirstFrameAssetID             string
	LastFrameAssetID              string
	FirstFrameURL                 string
	SelectedOutputURL             string
	SelectedOutputDurationSeconds *int32
	CreatedBy                     string
	UpdatedBy                     string
	CreatedAt                     time.Time
	UpdatedAt                     time.Time
	DeletedAt                     *time.Time
}

type CanvasNodeInput struct {
	ID, TenantID, ProjectID, CanvasID, CreatedBy string
	WorkspaceID                                  *string
	Type                                         NodeType
	ReferenceType                                ReferenceType
	Name                                         string
	HasPersistedName                             bool
	Position                                     Position
	StoryboardRank                               int64
	Prompt                                       string
	Text                                         string
	AssetID                                      string
	ResourceID                                   string
	ResourceAssetID                              string
	VideoInputMode                               VideoInputMode
	GenerationConfig                             domainvideo.Config
	Now                                          time.Time
}

func NewCanvasNode(input CanvasNodeInput) (CanvasNode, error) {
	if strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.TenantID) == "" ||
		strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.CanvasID) == "" || !ValidCanvasNodeName(input.Name) ||
		strings.TrimSpace(input.CreatedBy) == "" || !input.Type.Valid() || !input.Position.Valid() || input.Now.IsZero() {
		return CanvasNode{}, ErrInvalidCanvasNode
	}
	if !utf8.ValidString(input.Prompt) || utf8.RuneCountInString(input.Prompt) > 50000 ||
		(input.Type == NodeTypeVideoGeneration && (input.StoryboardRank == 0 || !input.GenerationConfig.Valid())) {
		return CanvasNode{}, ErrInvalidCanvasNode
	}
	if input.Type != NodeTypeVideoGeneration && input.StoryboardRank != 0 {
		return CanvasNode{}, ErrInvalidCanvasNode
	}
	referenceType, referenceOK := materialReferenceType(input.Type, input.ReferenceType, input.AssetID, input.ResourceID, input.ResourceAssetID)
	if !referenceOK {
		return CanvasNode{}, ErrInvalidCanvasNode
	}
	if input.VideoInputMode == 0 {
		input.VideoInputMode = VideoInputModeReference
	}
	return CanvasNode{
		ID: input.ID, TenantID: input.TenantID, WorkspaceID: cloneString(input.WorkspaceID),
		ProjectID: input.ProjectID, CanvasID: input.CanvasID, Type: input.Type, ReferenceType: referenceType, Name: input.Name, HasPersistedName: input.HasPersistedName,
		Position: input.Position, StoryboardRank: input.StoryboardRank, Prompt: input.Prompt, Text: input.Text, AssetID: input.AssetID,
		ResourceID: input.ResourceID, ResourceAssetID: input.ResourceAssetID,
		VideoInputMode: input.VideoInputMode, IncomingEdges: make([]IncomingEdge, 0),
		GenerationConfig: input.GenerationConfig, Revision: 1,
		CreatedBy: input.CreatedBy, UpdatedBy: input.CreatedBy, CreatedAt: input.Now.UTC(), UpdatedAt: input.Now.UTC(),
	}, nil
}

func materialReferenceType(nodeType NodeType, explicit ReferenceType, assetID, resourceID, resourceAssetID string) (ReferenceType, bool) {
	isMaterial := nodeType == NodeTypeImageAsset || nodeType == NodeTypeVideoAsset || nodeType == NodeTypeAudioAsset
	if !isMaterial {
		return ReferenceTypeUnspecified, explicit == ReferenceTypeUnspecified
	}
	inferred := ReferenceTypeUnspecified
	count := 0
	if strings.TrimSpace(assetID) != "" {
		inferred, count = ReferenceTypeAsset, count+1
	}
	if strings.TrimSpace(resourceID) != "" {
		inferred, count = ReferenceTypeResource, count+1
	}
	if strings.TrimSpace(resourceAssetID) != "" {
		inferred, count = ReferenceTypeResourceAsset, count+1
	}
	if count != 1 {
		return ReferenceTypeUnspecified, false
	}
	if explicit == ReferenceTypeUnspecified {
		return inferred, true
	}
	return explicit, explicit.Valid() && explicit == inferred
}

func InferMaterialReferenceType(node CanvasNode) (ReferenceType, bool) {
	return materialReferenceType(node.Type, ReferenceTypeUnspecified, node.AssetID, node.ResourceID, node.ResourceAssetID)
}

func (n *CanvasNode) Update(patch UpdatePatch, updatedBy string, now time.Time) error {
	if patch.Empty() || strings.TrimSpace(updatedBy) == "" || now.IsZero() {
		return ErrInvalidCanvasNode
	}
	prompt := n.Prompt
	if patch.Prompt != nil {
		prompt = *patch.Prompt
	}
	config := patch.GenerationConfig.Apply(n.GenerationConfig)
	if !utf8.ValidString(prompt) || utf8.RuneCountInString(prompt) > 50000 ||
		(n.Type == NodeTypeVideoGeneration && !config.Valid()) {
		return ErrInvalidCanvasNode
	}
	if patch.Name != nil && !ValidCanvasNodeName(*patch.Name) {
		return ErrInvalidCanvasNode
	}
	if patch.Name != nil {
		n.Name = *patch.Name
		n.HasPersistedName = true
	}
	if patch.Text != nil {
		if !utf8.ValidString(*patch.Text) || utf8.RuneCountInString(*patch.Text) > 50000 {
			return ErrInvalidCanvasNode
		}
		n.Text = *patch.Text
	}
	if patch.Position != nil {
		if !patch.Position.Valid() {
			return ErrInvalidCanvasNode
		}
		n.Position = *patch.Position
	}
	if patch.VideoInputMode != nil {
		if n.Type != NodeTypeVideoGeneration || !patch.VideoInputMode.Valid() {
			return ErrInvalidCanvasNode
		}
		n.VideoInputMode = *patch.VideoInputMode
	}
	if patch.IncomingEdges != nil {
		n.IncomingEdges = append([]IncomingEdge(nil), (*patch.IncomingEdges)...)
	}
	n.Prompt, n.GenerationConfig, n.Revision, n.UpdatedBy, n.UpdatedAt = prompt, config, n.Revision+1, updatedBy, now.UTC()
	return nil
}

func (n *CanvasNode) Delete(updatedBy string, now time.Time) error {
	if strings.TrimSpace(updatedBy) == "" || now.IsZero() {
		return ErrInvalidCanvasNode
	}
	n.DeletedAt = &now
	n.UpdatedBy = updatedBy
	n.UpdatedAt = now.UTC()
	n.ActiveTaskRunID = ""
	return nil
}

func (n *CanvasNode) BeginGeneration(taskRunID string) error {
	if strings.TrimSpace(taskRunID) == "" {
		return ErrInvalidCanvasNode
	}
	n.ActiveTaskRunID = taskRunID
	return nil
}

func (n *CanvasNode) FinishGeneration() { n.ActiveTaskRunID = "" }

func (n CanvasNode) OutputMediaType() (MediaType, bool) {
	switch n.Type {
	case NodeTypeImageAsset, NodeTypeImageGeneration:
		return MediaTypeImage, true
	case NodeTypeVideoAsset, NodeTypeVideoGeneration:
		return MediaTypeVideo, true
	case NodeTypeAudioAsset:
		return MediaTypeAudio, true
	case NodeTypeText, NodeTypeTextGeneration:
		return MediaTypeText, true
	default:
		return 0, false
	}
}

func ValidateIncomingEdges(nodes []CanvasNode, targetID string, edges []IncomingEdge, mode VideoInputMode) error {
	byID := make(map[string]CanvasNode, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
	}
	target, ok := byID[targetID]
	if !ok || len(edges) > 64 {
		return ErrInvalidEdge
	}
	seenIDs := make(map[string]struct{}, len(edges))
	portCounts := make(map[Port]int)
	for _, edge := range edges {
		source, sourceOK := byID[edge.SourceNodeID]
		if !sourceOK || edge.SourceNodeID == targetID || strings.TrimSpace(edge.ID) == "" || edge.SourcePort != PortOutput || edge.TargetOrder < 0 {
			return ErrInvalidEdge
		}
		if _, exists := seenIDs[edge.ID]; exists {
			return ErrInvalidEdge
		}
		seenIDs[edge.ID] = struct{}{}
		media, mediaOK := source.OutputMediaType()
		if !mediaOK || !accepts(target.Type, edge.TargetPort, media) {
			return ErrInvalidEdge
		}
		portCounts[edge.TargetPort]++
	}
	if portCounts[PortFirstFrame] > 1 || portCounts[PortLastFrame] > 1 {
		return ErrPortCapacity
	}
	if target.Type == NodeTypeVideoGeneration {
		structured := portCounts[PortFirstFrame]+portCounts[PortLastFrame] > 0
		references := portCounts[PortReferenceImage]+portCounts[PortReferenceVideo]+portCounts[PortReferenceAudio]+portCounts[PortReferenceText] > 0
		if mode == VideoInputModeFirstLastFrame && references || mode == VideoInputModeReference && structured {
			return ErrInputModeConflict
		}
	}
	graph := make(map[string][]string, len(nodes))
	for _, node := range nodes {
		incoming := node.IncomingEdges
		if node.ID == targetID {
			incoming = edges
		}
		for _, edge := range incoming {
			graph[edge.SourceNodeID] = append(graph[edge.SourceNodeID], node.ID)
		}
	}
	if reaches(graph, targetID, targetID, make(map[string]bool), true) {
		return ErrCycleDetected
	}
	return nil
}

// TransitionVideoInputModeEdges atomically changes the image-input protocol.
// Entering first/last-frame mode keeps at most two image references in their
// existing order and detaches all all-in-one references; switching back maps
// the frame inputs to ordered reference images.
func TransitionVideoInputModeEdges(edges []IncomingEdge, mode VideoInputMode) ([]IncomingEdge, error) {
	result := make([]IncomingEdge, 0, len(edges))
	imageEdges := make([]IncomingEdge, 0, 2)
	for _, edge := range edges {
		switch edge.TargetPort {
		case PortReferenceImage, PortFirstFrame, PortLastFrame:
			imageEdges = append(imageEdges, edge)
		default:
			if mode == VideoInputModeReference {
				result = append(result, edge)
			}
		}
	}
	if mode == VideoInputModeFirstLastFrame {
		if len(imageEdges) > 2 {
			return nil, ErrPortCapacity
		}
		for index := range imageEdges {
			imageEdges[index].TargetPort = PortFirstFrame
			if index == 1 {
				imageEdges[index].TargetPort = PortLastFrame
			}
			imageEdges[index].TargetOrder = 0
		}
		return imageEdges, nil
	}
	if mode != VideoInputModeReference {
		return nil, ErrInvalidEdge
	}
	for index := range imageEdges {
		imageEdges[index].TargetPort = PortReferenceImage
		imageEdges[index].TargetOrder = int32(index)
		result = append(result, imageEdges[index])
	}
	return result, nil
}

func accepts(target NodeType, port Port, media MediaType) bool {
	if target != NodeTypeText && target != NodeTypeImageGeneration && target != NodeTypeVideoGeneration && target != NodeTypeTextGeneration {
		return false
	}
	switch port {
	case PortReferenceImage:
		return media == MediaTypeImage
	case PortReferenceVideo:
		return media == MediaTypeVideo && target != NodeTypeImageGeneration
	case PortReferenceAudio:
		return media == MediaTypeAudio && target != NodeTypeImageGeneration && target != NodeTypeTextGeneration
	case PortReferenceText:
		return media == MediaTypeText
	case PortFirstFrame, PortLastFrame:
		return target == NodeTypeVideoGeneration && media == MediaTypeImage
	default:
		return false
	}
}

func reaches(graph map[string][]string, current, target string, seen map[string]bool, skipInitial bool) bool {
	if !skipInitial && current == target {
		return true
	}
	if seen[current] {
		return false
	}
	seen[current] = true
	for _, next := range graph[current] {
		if reaches(graph, next, target, seen, false) {
			return true
		}
	}
	return false
}
