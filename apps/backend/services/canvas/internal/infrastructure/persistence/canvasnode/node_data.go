package canvasnode

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"

	"github.com/santhosh-tekuri/jsonschema/v6"

	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
)

//go:embed schemas/node_data.schema.json
var canvasNodeDataSchemaBytes []byte

const canvasNodeDataSchemaVersion = 1

var canvasNodeDataSchema, canvasNodePayloadCurrentVersions = mustCompileCanvasNodeDataSchema("canvas-node-data.json", canvasNodeDataSchemaBytes)

type canvasNodeDataHeader struct {
	SchemaVersion *int            `json:"schema_version"`
	Payload       json.RawMessage `json:"payload"`
}

type canvasNodePayloadHeader struct {
	Version *int `json:"version"`
}

type canvasNodeData struct {
	SchemaVersion int                   `json:"schema_version"`
	Name          *string               `json:"name,omitempty"`
	Position      canvasNodePosition    `json:"position"`
	IncomingEdges []domain.IncomingEdge `json:"incoming_edges"`
	Payload       json.RawMessage       `json:"payload"`
}

type canvasNodePosition struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type canvasNodeGenerationConfig struct {
	ModelServiceID  string `json:"model_service_id"`
	Resolution      int16  `json:"resolution"`
	AspectRatio     int16  `json:"aspect_ratio"`
	DurationSeconds int32  `json:"duration_seconds"`
	GenerateAudio   bool   `json:"generate_audio"`
	Watermark       bool   `json:"watermark"`
}

type canvasNodePayloadVersion struct {
	Version int `json:"version"`
}

type canvasNodeAssetPayload struct {
	canvasNodePayloadVersion
	ReferenceType int16 `json:"reference_type"`
}

type canvasNodeTextPayload struct {
	canvasNodePayloadVersion
	Text string `json:"text"`
}

type canvasNodeImageGenerationPayload struct {
	canvasNodePayloadVersion
	Prompt           string                     `json:"prompt"`
	GenerationConfig canvasNodeGenerationConfig `json:"generation_config"`
}

type canvasNodeVideoGenerationPayload struct {
	canvasNodePayloadVersion
	Prompt           string                     `json:"prompt"`
	VideoInputMode   int16                      `json:"video_input_mode"`
	GenerationConfig canvasNodeGenerationConfig `json:"generation_config"`
}

type canvasNodeTextGenerationPayload struct {
	canvasNodePayloadVersion
	Prompt             string                     `json:"prompt"`
	GenerationConfig   canvasNodeGenerationConfig `json:"generation_config"`
	SelectedOutputText string                     `json:"selected_output_text"`
}

type canvasNodeStoryboardDraftPayload struct {
	canvasNodePayloadVersion
	Plot       string          `json:"plot"`
	Session    json.RawMessage `json:"session,omitempty"`
	Generation json.RawMessage `json:"generation,omitempty"`
}

func mustCompileCanvasNodeDataSchema(name string, encoded []byte) (*jsonschema.Schema, map[domain.NodeType]int) {
	var document map[string]any
	if err := json.Unmarshal(encoded, &document); err != nil {
		panic(fmt.Sprintf("decode embedded canvas node data schema: %v", err))
	}
	versionsDocument, ok := document["x-node-type-payload-versions"].(map[string]any)
	if !ok {
		panic("canvas node data schema is missing x-node-type-payload-versions")
	}
	versions := make(map[domain.NodeType]int, len(versionsDocument))
	for nodeType, name := range map[domain.NodeType]string{
		domain.NodeTypeImageAsset: "IMAGE_ASSET", domain.NodeTypeVideoAsset: "VIDEO_ASSET", domain.NodeTypeAudioAsset: "AUDIO_ASSET",
		domain.NodeTypeText: "TEXT", domain.NodeTypeImageGeneration: "IMAGE_GENERATION", domain.NodeTypeVideoGeneration: "VIDEO_GENERATION",
		domain.NodeTypeTextGeneration: "TEXT_GENERATION", domain.NodeTypeStoryboardDraft: "STORYBOARD_DRAFT",
	} {
		value, exists := versionsDocument[name].(float64)
		if !exists || value < 1 || value != float64(int(value)) {
			panic(fmt.Sprintf("canvas node data schema has invalid %s version", name))
		}
		versions[nodeType] = int(value)
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	if err := compiler.AddResource(name, document); err != nil {
		panic(fmt.Sprintf("register embedded canvas node data schema: %v", err))
	}
	schema, err := compiler.Compile(name)
	if err != nil {
		panic(fmt.Sprintf("compile embedded canvas node data schema: %v", err))
	}
	return schema, versions
}

func canvasNodePayloadCurrentVersion(nodeType domain.NodeType) (int, bool) {
	version, ok := canvasNodePayloadCurrentVersions[nodeType]
	return version, ok
}

func canvasNodeDataPersistedPayloadVersion(encoded []byte) (int, bool, error) {
	var header canvasNodeDataHeader
	if err := json.Unmarshal(encoded, &header); err != nil {
		return 0, false, fmt.Errorf("decode canvas node data version headers: %w", err)
	}
	if header.SchemaVersion == nil {
		return 0, false, fmt.Errorf("canvas node data schema_version is required")
	}
	if *header.SchemaVersion != canvasNodeDataSchemaVersion {
		return 0, false, fmt.Errorf("unsupported canvas node data schema version %d", *header.SchemaVersion)
	}
	if len(header.Payload) == 0 {
		return 0, false, fmt.Errorf("canvas node data payload is required")
	}
	var payloadHeader canvasNodePayloadHeader
	if err := json.Unmarshal(header.Payload, &payloadHeader); err != nil {
		return 0, false, fmt.Errorf("decode canvas node payload version: %w", err)
	}
	if payloadHeader.Version == nil {
		return 0, false, fmt.Errorf("canvas node payload version is required")
	}
	return *payloadHeader.Version, true, nil
}

func encodeCanvasNodeData(node domain.CanvasNode) ([]byte, error) {
	_, ok := canvasNodePayloadCurrentVersion(node.Type)
	if !ok {
		return nil, fmt.Errorf("unsupported canvas node type %d", node.Type)
	}
	payload, err := encodeCanvasNodePayload(node)
	if err != nil {
		return nil, err
	}
	edges := node.IncomingEdges
	if edges == nil {
		edges = make([]domain.IncomingEdge, 0)
	}
	document := canvasNodeData{
		SchemaVersion: canvasNodeDataSchemaVersion,
		Position:      canvasNodePosition{X: node.Position.PositionX, Y: node.Position.PositionY},
		IncomingEdges: edges,
		Payload:       payload,
	}
	if node.HasPersistedName || (node.ResourceID == "" && node.ResourceAssetID == "") {
		document.Name = &node.Name
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("encode canvas node data: %w", err)
	}
	if err = validateCanvasNodeData(encoded); err != nil {
		return nil, err
	}
	return encoded, nil
}

func decodeCanvasNodeData(nodeType domain.NodeType, encoded []byte) (canvasNodeData, any, error) {
	persistedVersion, _, err := canvasNodeDataPersistedPayloadVersion(encoded)
	if err != nil {
		return canvasNodeData{}, nil, err
	}
	currentVersion, ok := canvasNodePayloadCurrentVersion(nodeType)
	if !ok || persistedVersion != currentVersion {
		return canvasNodeData{}, nil, fmt.Errorf("unsupported canvas node payload version %d", persistedVersion)
	}
	if err = validateCanvasNodeData(encoded); err != nil {
		return canvasNodeData{}, nil, err
	}
	var document canvasNodeData
	if err = decodeStrict(encoded, &document); err != nil {
		return canvasNodeData{}, nil, fmt.Errorf("decode canvas node data: %w", err)
	}
	payload, err := decodeCanvasNodePayload(nodeType, document.Payload)
	if err != nil {
		return canvasNodeData{}, nil, err
	}
	return document, payload, nil
}

func canvasNodeDataName(document canvasNodeData, nodeType domain.NodeType) string {
	if document.Name != nil {
		return *document.Name
	}
	return domain.DefaultCanvasNodeName(nodeType)
}

func validateCanvasNodeData(encoded []byte) error {
	var document any
	if err := json.Unmarshal(encoded, &document); err != nil {
		return fmt.Errorf("decode canvas node data for schema validation: %w", err)
	}
	if err := canvasNodeDataSchema.Validate(document); err != nil {
		return fmt.Errorf("validate canvas node data schema: %w", err)
	}
	return nil
}

func encodeCanvasNodePayload(node domain.CanvasNode) (json.RawMessage, error) {
	config := generationConfigToData(node.GenerationConfig)
	writeVersion, ok := canvasNodePayloadWriteVersion(node)
	if !ok {
		return nil, fmt.Errorf("unsupported canvas node type %d", node.Type)
	}
	version := canvasNodePayloadVersion{Version: writeVersion}
	var payload any
	switch node.Type {
	case domain.NodeTypeImageAsset, domain.NodeTypeVideoAsset, domain.NodeTypeAudioAsset:
		if !node.ReferenceType.Valid() {
			return nil, fmt.Errorf("material canvas node reference type %d is invalid", node.ReferenceType)
		}
		payload = canvasNodeAssetPayload{canvasNodePayloadVersion: version, ReferenceType: int16(node.ReferenceType)}
	case domain.NodeTypeText:
		payload = canvasNodeTextPayload{canvasNodePayloadVersion: version, Text: node.Text}
	case domain.NodeTypeImageGeneration:
		payload = canvasNodeImageGenerationPayload{canvasNodePayloadVersion: version, Prompt: node.Prompt, GenerationConfig: config}
	case domain.NodeTypeVideoGeneration:
		payload = canvasNodeVideoGenerationPayload{canvasNodePayloadVersion: version, Prompt: node.Prompt, VideoInputMode: int16(node.VideoInputMode), GenerationConfig: config}
	case domain.NodeTypeTextGeneration:
		payload = canvasNodeTextGenerationPayload{canvasNodePayloadVersion: version, Prompt: node.Prompt, GenerationConfig: config, SelectedOutputText: node.SelectedOutputText}
	case domain.NodeTypeStoryboardDraft:
		payload = canvasNodeStoryboardDraftPayload{canvasNodePayloadVersion: version, Plot: node.Prompt}
	default:
		return nil, fmt.Errorf("unsupported canvas node type %d", node.Type)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode canvas node payload for type %d: %w", node.Type, err)
	}
	return encoded, nil
}

func canvasNodePayloadWriteVersion(node domain.CanvasNode) (int, bool) {
	return canvasNodePayloadCurrentVersion(node.Type)
}

func decodeCanvasNodePayload(nodeType domain.NodeType, encoded []byte) (any, error) {
	var payload any
	switch nodeType {
	case domain.NodeTypeImageAsset, domain.NodeTypeVideoAsset, domain.NodeTypeAudioAsset:
		payload = &canvasNodeAssetPayload{}
	case domain.NodeTypeText:
		payload = &canvasNodeTextPayload{}
	case domain.NodeTypeImageGeneration:
		payload = &canvasNodeImageGenerationPayload{}
	case domain.NodeTypeVideoGeneration:
		payload = &canvasNodeVideoGenerationPayload{}
	case domain.NodeTypeTextGeneration:
		payload = &canvasNodeTextGenerationPayload{}
	case domain.NodeTypeStoryboardDraft:
		payload = &canvasNodeStoryboardDraftPayload{}
	default:
		return nil, fmt.Errorf("unsupported canvas node type %d", nodeType)
	}
	if err := decodeStrict(encoded, payload); err != nil {
		return nil, fmt.Errorf("decode canvas node payload for type %d: %w", nodeType, err)
	}
	if material, ok := payload.(*canvasNodeAssetPayload); ok && !domain.ReferenceType(material.ReferenceType).Valid() {
		return nil, fmt.Errorf("decode canvas node payload for type %d: invalid reference type %d", nodeType, material.ReferenceType)
	}
	return payload, nil
}

func decodeStrict(encoded []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func generationConfigToData(config domainvideo.Config) canvasNodeGenerationConfig {
	return canvasNodeGenerationConfig{
		ModelServiceID: config.ModelServiceID, Resolution: int16(config.Resolution), AspectRatio: int16(config.AspectRatio),
		DurationSeconds: config.DurationSeconds, GenerateAudio: config.GenerateAudio, Watermark: config.Watermark,
	}
}

func generationConfigFromData(config canvasNodeGenerationConfig) domainvideo.Config {
	return domainvideo.Config{
		ModelServiceID: config.ModelServiceID, Resolution: domainvideo.Resolution(config.Resolution), AspectRatio: domainvideo.AspectRatio(config.AspectRatio),
		DurationSeconds: config.DurationSeconds, GenerateAudio: config.GenerateAudio, Watermark: config.Watermark,
	}
}

func applyCanvasNodePayload(node *domain.CanvasNode, payload any) error {
	switch value := payload.(type) {
	case *canvasNodeAssetPayload:
		node.ReferenceType = domain.ReferenceType(value.ReferenceType)
	case *canvasNodeTextPayload:
		node.Text = value.Text
	case *canvasNodeImageGenerationPayload:
		node.Prompt = value.Prompt
		node.GenerationConfig = generationConfigFromData(value.GenerationConfig)
	case *canvasNodeVideoGenerationPayload:
		node.Prompt = value.Prompt
		node.VideoInputMode = domain.VideoInputMode(value.VideoInputMode)
		node.GenerationConfig = generationConfigFromData(value.GenerationConfig)
	case *canvasNodeTextGenerationPayload:
		node.Prompt = value.Prompt
		node.GenerationConfig = generationConfigFromData(value.GenerationConfig)
		node.SelectedOutputText = value.SelectedOutputText
	case *canvasNodeStoryboardDraftPayload:
		node.Prompt = value.Plot
	default:
		return fmt.Errorf("unsupported decoded payload %T", payload)
	}
	return nil
}
