package imagegeneration

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const maxPromptRunes = 50_000

var ErrInvalidGeneration = errors.New("invalid image generation")

type Resolution string

const (
	Resolution480P  Resolution = "480P"
	Resolution720P  Resolution = "720P"
	Resolution1080P Resolution = "1080P"
	Resolution2K    Resolution = "2K"
	Resolution4K    Resolution = "4K"
)

func (resolution Resolution) Valid() bool {
	return resolution == Resolution480P || resolution == Resolution720P || resolution == Resolution1080P || resolution == Resolution2K || resolution == Resolution4K
}

type AspectRatio string

const (
	AspectRatio1x1  AspectRatio = "1:1"
	AspectRatio3x4  AspectRatio = "3:4"
	AspectRatio4x3  AspectRatio = "4:3"
	AspectRatio9x16 AspectRatio = "9:16"
	AspectRatio16x9 AspectRatio = "16:9"
	AspectRatio3x2  AspectRatio = "3:2"
	AspectRatio2x3  AspectRatio = "2:3"
	AspectRatio21x9 AspectRatio = "21:9"
)

func (ratio AspectRatio) Valid() bool {
	switch ratio {
	case AspectRatio1x1, AspectRatio3x4, AspectRatio4x3, AspectRatio9x16, AspectRatio16x9,
		AspectRatio3x2, AspectRatio2x3, AspectRatio21x9:
		return true
	default:
		return false
	}
}

// Dimensions converts the product resolution bucket and aspect ratio into the
// exact pixel size sent to provider. Resolution is the standard short edge for the
// selected product tier. Keep this table aligned with the web product options.
func Dimensions(resolution Resolution, ratio AspectRatio) (int64, int64, error) {
	shortEdge := map[Resolution]int64{
		Resolution480P: 480, Resolution720P: 720, Resolution1080P: 1080, Resolution2K: 1440, Resolution4K: 2160,
	}
	edge := shortEdge[resolution]
	if edge == 0 {
		return 0, 0, ErrInvalidGeneration
	}
	parts := map[AspectRatio][2]int64{
		AspectRatio1x1: {1, 1}, AspectRatio3x4: {3, 4}, AspectRatio4x3: {4, 3}, AspectRatio9x16: {9, 16},
		AspectRatio16x9: {16, 9}, AspectRatio3x2: {3, 2}, AspectRatio2x3: {2, 3}, AspectRatio21x9: {21, 9},
	}[ratio]
	if parts == [2]int64{} {
		return 0, 0, ErrInvalidGeneration
	}
	if parts[0] >= parts[1] {
		return edge * parts[0] / parts[1], edge, nil
	}
	return edge, edge * parts[1] / parts[0], nil
}

type Config struct {
	Prompt      string
	ModelID     string
	Resolution  Resolution
	AspectRatio AspectRatio
	Watermark   bool
}

type ConfigPatch struct {
	Prompt      *string
	ModelID     *string
	Resolution  *Resolution
	AspectRatio *AspectRatio
	Watermark   *bool
}

func (config Config) ValidDraft() bool {
	return validDraftConfig(config.Prompt, config.ModelID, config.Resolution, config.AspectRatio)
}

func (config Config) Ready() bool {
	return strings.TrimSpace(config.Prompt) != "" && strings.TrimSpace(config.ModelID) != "" &&
		config.Resolution.Valid() && config.AspectRatio.Valid()
}

func (config Config) Apply(patch ConfigPatch) (Config, bool, error) {
	next := config
	if patch.Prompt != nil {
		next.Prompt = *patch.Prompt
	}
	if patch.ModelID != nil {
		next.ModelID = *patch.ModelID
	}
	if patch.Resolution != nil {
		next.Resolution = *patch.Resolution
	}
	if patch.AspectRatio != nil {
		next.AspectRatio = *patch.AspectRatio
	}
	if patch.Watermark != nil {
		next.Watermark = *patch.Watermark
	}
	if !next.ValidDraft() {
		return Config{}, false, ErrInvalidGeneration
	}
	return next, next != config, nil
}

func validDraftConfig(prompt, modelID string, resolution Resolution, aspectRatio AspectRatio) bool {
	if !utf8.ValidString(prompt) || utf8.RuneCountInString(prompt) > maxPromptRunes {
		return false
	}
	if modelID != "" && strings.TrimSpace(modelID) == "" {
		return false
	}
	return (resolution == "" || resolution.Valid()) && (aspectRatio == "" || aspectRatio.Valid())
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
