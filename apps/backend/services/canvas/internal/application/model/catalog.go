package model

import (
	"context"
	"errors"
	"fmt"
	"strings"

	domainvideo "github.com/example/monorepo/canvas/internal/domain/videogeneration"
)

type Capability string

const (
	CapabilityStoryboardInference Capability = "storyboard-inference"
	// CapabilityCanvasTextGeneration validates the chat model stored on text nodes.
	// Text execution itself is owned by Chat and is not a Canvas task.
	CapabilityCanvasTextGeneration Capability = "canvas-text-generation"
	CapabilityCanvasNodeVideo      Capability = "canvasnode-video"
	CapabilityResourceTextToImage  Capability = "resource-text-to-image"
	CapabilityResourceImageToImage Capability = "resource-image-to-image"
)

var (
	ErrUnavailable               = errors.New("model unavailable")
	ErrDefaultModelNotConfigured = errors.New("default model not configured")
)

// Config contains the model tuning parameters that Canvas can apply directly
// to an inference request. Pointer fields preserve explicit zero values.
type Config struct {
	Temperature         *float64 `json:"Temperature,omitempty"`
	TopP                *float64 `json:"TopP,omitempty"`
	MaxTokens           *int64   `json:"MaxTokens,omitempty"`
	ReasoningEffortType string   `json:"ReasoningEffortType,omitempty"`
}

// Selection is the configured model identity and its request parameters.
type Selection struct {
	ModelID     string `json:"ModelID"`
	ModelConfig Config `json:"ModelConfig"`
}

type Actor struct {
	TenantID    string
	WorkspaceID *string
	UserID      string
}

type Requirement struct {
	Capability Capability
	ModelID    string
}

// Source is the stable product-facing model origin used by usage snapshots.
// provider exposes several publication fields, but Canvas currently presents the
// two origins supported by model management: built-in and distributed.
type Source string

const (
	SourceSystemPreset      Source = "SYSTEM_PRESET"
	SourceSystemDistributed Source = "SYSTEM_DISTRIBUTED"
)

type Resolution struct {
	Selection         Selection
	IsPreset          bool
	IsPublic          bool
	ModelName         string
	ModelSource       Source
	VideoCapabilities *VideoCapabilities
	ImageCapabilities *ImageCapabilities
}

type VideoCapabilities struct {
	DurationMinSeconds       int32
	DurationMaxSeconds       int32
	DurationDefaultSeconds   *int32
	DurationRecommends       []int32
	DurationRecommendDefault *int32
	Resolutions              []string
	AspectRatios             []string
	AspectRatioAdaptive      bool
	AspectRatioDefault       *string
	GenerateAudio            []bool
	WatermarkSupported       *bool
	MaxImageReferences       *int
	MaxVideoReferences       *int
	MaxAudioReferences       *int
}

type VideoParameters struct {
	Resolution      string
	AspectRatio     string
	DurationSeconds int32
	GenerateAudio   bool
	Watermark       bool
	ImageReferences int
	VideoReferences int
	AudioReferences int
}

type IntRange struct {
	Min int64
	Max int64
}

type FloatRange struct {
	Min float64
	Max float64
}

type ImageCapabilities struct {
	Width              IntRange
	Height             IntRange
	AspectRatio        FloatRange
	TotalPixels        IntRange
	WatermarkSupported *bool
	MaxInputReferences *int
}

type ImageParameters struct {
	Width           int64
	Height          int64
	Watermark       bool
	InputReferences int
}

func (c ImageCapabilities) MismatchedConfigs(parameters ImageParameters) []string {
	if !c.sizeConfigured() {
		return []string{"图片尺寸能力未配置"}
	}
	var mismatches []string
	if outsideIntRange(parameters.Width, c.Width) || outsideIntRange(parameters.Height, c.Height) ||
		(parameters.Height > 0 && outsideFloatRange(float64(parameters.Width)/float64(parameters.Height), c.AspectRatio)) {
		mismatches = append(mismatches, fmt.Sprintf("图片尺寸 %dx%d", parameters.Width, parameters.Height))
	}
	total := parameters.Width * parameters.Height
	if outsideIntRange(total, c.TotalPixels) {
		mismatches = append(mismatches, fmt.Sprintf("总像素 %d", total))
	}
	if parameters.Watermark && (c.WatermarkSupported == nil || !*c.WatermarkSupported) {
		mismatches = append(mismatches, "水印")
	}
	if exceeds(parameters.InputReferences, c.MaxInputReferences) {
		mismatches = append(mismatches, "图片参考数量")
	}
	return mismatches
}

func (c ImageCapabilities) sizeConfigured() bool {
	return c.Width != (IntRange{}) || c.Height != (IntRange{}) ||
		c.AspectRatio != (FloatRange{}) || c.TotalPixels != (IntRange{})
}

func outsideIntRange(value int64, allowed IntRange) bool {
	return allowed.Min > 0 && value < allowed.Min || allowed.Max > 0 && value > allowed.Max
}

func outsideFloatRange(value float64, allowed FloatRange) bool {
	return allowed.Min > 0 && value < allowed.Min || allowed.Max > 0 && value > allowed.Max
}

func (c VideoCapabilities) Supports(parameters VideoParameters) bool {
	return len(c.MismatchedConfigs(parameters)) == 0
}

// MismatchedConfigs lists the submitted settings that the model cannot serve.
func (c VideoCapabilities) MismatchedConfigs(parameters VideoParameters) []string {
	var mismatches []string
	switch {
	case parameters.DurationSeconds == domainvideo.AutomaticDurationSeconds:
		if !containsInt32(c.DurationRecommends, domainvideo.AutomaticDurationSeconds) {
			mismatches = append(mismatches, "自动时长")
		}
	case parameters.DurationSeconds < 1:
		mismatches = append(mismatches, "时长")
	case c.DurationMinSeconds > 0 && parameters.DurationSeconds < c.DurationMinSeconds,
		c.DurationMaxSeconds > 0 && parameters.DurationSeconds > c.DurationMaxSeconds:
		mismatches = append(mismatches, fmt.Sprintf("时长 %d 秒", parameters.DurationSeconds))
	}
	if !containsFold(c.Resolutions, parameters.Resolution) {
		mismatches = append(mismatches, fmt.Sprintf("分辨率 %s", parameters.Resolution))
	}
	if parameters.AspectRatio != "" {
		if strings.EqualFold(parameters.AspectRatio, domainvideo.AspectAdaptive.ProviderValue()) {
			if !c.AspectRatioAdaptive {
				mismatches = append(mismatches, "自动画幅")
			}
		} else if !containsFold(c.AspectRatios, parameters.AspectRatio) {
			mismatches = append(mismatches, fmt.Sprintf("画幅 %s", parameters.AspectRatio))
		}
	}
	if !containsBool(c.GenerateAudio, parameters.GenerateAudio) {
		if parameters.GenerateAudio {
			mismatches = append(mismatches, "有声")
		} else {
			mismatches = append(mismatches, "无声")
		}
	}
	if parameters.Watermark && c.WatermarkSupported != nil && !*c.WatermarkSupported {
		mismatches = append(mismatches, "水印")
	}
	if exceeds(parameters.ImageReferences, c.MaxImageReferences) {
		mismatches = append(mismatches, "图片参考数量")
	}
	if exceeds(parameters.VideoReferences, c.MaxVideoReferences) {
		mismatches = append(mismatches, "视频参考数量")
	}
	if exceeds(parameters.AudioReferences, c.MaxAudioReferences) {
		mismatches = append(mismatches, "音频参考数量")
	}
	return mismatches
}

func containsInt32(values []int32, target int32) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func exceeds(value int, maximum *int) bool {
	return value < 0 || maximum != nil && value > *maximum
}

func containsFold(allowed []string, value string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if strings.EqualFold(strings.TrimSpace(candidate), strings.TrimSpace(value)) {
			return true
		}
	}
	return false
}

func containsBool(allowed []bool, value bool) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if candidate == value {
			return true
		}
	}
	return false
}

// Catalog resolves current-user-visible provider models and their capabilities.
// LoadSelection rehydrates saved tuning for a model already resolved before a
// durable task was queued; the provider remains the final execution authority.
type Catalog interface {
	Resolve(context.Context, Actor, []Requirement) ([]Resolution, error)
	LoadSelection(context.Context, string, *string, Capability, string) (Selection, error)
}
