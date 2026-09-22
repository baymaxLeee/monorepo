package canvas

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode/utf8"

	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

var storyboardReferenceFieldLabels = map[string]string{
	"summary":            "一句话概述",
	"global_setting":     "全局设定",
	"position_reference": "位置参考",
	"shots":              "镜头脚本",
}

func insertSelectedStoryboardAssetMentions(
	prompt string,
	references []StoryboardAssetReference,
	candidates []ProjectAssetCandidate,
	capabilities applicationmodel.VideoCapabilities,
) (string, []ProjectAssetCandidate, error) {
	existingMentionIDs, err := domain.AssetMentionIDs(prompt)
	if err != nil {
		return "", nil, errno.Wrap(errno.ErrInvalidArgument, err)
	}
	existingMentions := make(map[string]struct{}, len(existingMentionIDs))
	for _, id := range existingMentionIDs {
		existingMentions[id] = struct{}{}
	}
	byID := make(map[string]ProjectAssetCandidate, len(candidates))
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.ResourceAssetID) == "" {
			continue
		}
		byID[candidate.ResourceAssetID] = candidate
	}
	insertions := make([]storyboardMentionInsertion, 0, len(references))
	selected := make([]ProjectAssetCandidate, 0, len(references))
	seen := make(map[string]struct{}, len(references))
	used := make(map[domainasset.MediaType]int)
	resultRunes := utf8.RuneCountInString(prompt)
	for order, reference := range references {
		if _, duplicate := seen[reference.ResourceAssetID]; duplicate {
			return "", nil, errno.NewWithMessage(errno.ErrInvalidArgument, "同一素材在单个分镜中只能引用一次")
		}
		seen[reference.ResourceAssetID] = struct{}{}
		candidate, exists := byID[reference.ResourceAssetID]
		if !exists {
			return "", nil, errno.New(errno.ErrNotFound)
		}
		asset := candidate.Asset
		if asset.MediaType == domainasset.MediaAudio && reference.TargetField != "shots" {
			return "", nil, errno.NewWithMessage(errno.ErrInvalidArgument, "素材类型与引用字段不匹配")
		}
		position, ok := storyboardReferencePosition(prompt, reference.TargetField, reference.AnchorText)
		if !ok {
			return "", nil, errno.NewWithMessage(
				errno.ErrInvalidArgument,
				fmt.Sprintf("素材 %s 的引用位置无效", candidate.Name),
			)
		}
		limit := modelAssetLimit(capabilities, asset.MediaType)
		used[asset.MediaType]++
		if limit < 1 || used[asset.MediaType] > limit {
			return "", nil, errno.New(errno.ErrCanvasNodeAssetLimitExceeded)
		}
		if _, exists := existingMentions[candidate.ResourceAssetID]; !exists {
			mention := domain.FormatAssetMention(candidate.ResourceAssetID, candidate.Name)
			resultRunes += utf8.RuneCountInString(mention)
			if resultRunes > storyboardPromptMaxRunes {
				return "", nil, errno.New(errno.ErrInvalidArgument)
			}
			insertions = append(insertions, storyboardMentionInsertion{
				position: position, order: order, mention: mention,
			})
		}
		selected = append(selected, candidate)
	}
	sort.SliceStable(insertions, func(i, j int) bool {
		if insertions[i].position != insertions[j].position {
			return insertions[i].position > insertions[j].position
		}
		return insertions[i].order > insertions[j].order
	})
	result := prompt
	for _, insertion := range insertions {
		result = result[:insertion.position] + insertion.mention + result[insertion.position:]
	}
	return result, selected, nil
}

func storyboardReferencePosition(prompt, field, anchor string) (int, bool) {
	label, valid := storyboardReferenceFieldLabels[strings.TrimSpace(field)]
	anchor = strings.TrimSpace(anchor)
	if !valid || anchor == "" {
		return 0, false
	}
	header := "【" + label + "】\n"
	start := strings.Index(prompt, header)
	if start < 0 {
		return 0, false
	}
	start += len(header)
	end := len(prompt)
	if next := strings.Index(prompt[start:], "\n【"); next >= 0 {
		end = start + next
	}
	if index := strings.Index(prompt[start:end], anchor); index >= 0 {
		return start + index + len(anchor), true
	}
	return 0, false
}

const (
	storyboardAssetCatalogLimit = 1000
	storyboardPromptMaxRunes    = 50000
)

type storyboardMentionInsertion struct {
	position int
	order    int
	mention  string
}

func storyboardAssetLimits(capabilities applicationmodel.VideoCapabilities) AssetLimits {
	return AssetLimits{
		Image: int64(modelAssetLimit(capabilities, domainasset.MediaImage)),
		Video: int64(modelAssetLimit(capabilities, domainasset.MediaVideo)),
		Audio: int64(modelAssetLimit(capabilities, domainasset.MediaAudio)),
	}
}

func modelAssetLimit(capabilities applicationmodel.VideoCapabilities, mediaType domainasset.MediaType) int {
	switch mediaType {
	case domainasset.MediaImage:
		return modelReferenceLimit(capabilities.MaxImageReferences)
	case domainasset.MediaVideo:
		return modelReferenceLimit(capabilities.MaxVideoReferences)
	case domainasset.MediaAudio:
		return modelReferenceLimit(capabilities.MaxAudioReferences)
	default:
		return 0
	}
}

func modelReferenceLimit(maximum *int) int {
	// AIGW's absent maximum means no declared count bound, matching generation
	// admission. MaxInt bridges that optional capability to the matching budget;
	// it is not a product limit. Explicit zero still disables the media type.
	if maximum == nil {
		return math.MaxInt
	}
	return max(0, *maximum)
}
