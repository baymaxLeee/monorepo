package assetmatching

import (
	"strings"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
)

type Limits struct {
	Image int64
	Video int64
	Audio int64
}

func (limits Limits) For(mediaType domainasset.MediaType) (int64, bool) {
	switch mediaType {
	case domainasset.MediaImage:
		return limits.Image, limits.Image > 0
	case domainasset.MediaVideo:
		return limits.Video, limits.Video > 0
	case domainasset.MediaAudio:
		return limits.Audio, limits.Audio > 0
	default:
		return 0, false
	}
}

// Budget caps only additions; existing references are never removed to make room.
type Budget struct {
	limits    Limits
	used      map[domainasset.MediaType]int64
	resources map[string]bool
	assets    map[string]bool
}

func NewBudget(limits Limits, existing map[domainasset.MediaType]int64) *Budget {
	used := make(map[domainasset.MediaType]int64, len(existing))
	for media, count := range existing {
		used[media] = count
	}
	return &Budget{limits: limits, used: used, resources: make(map[string]bool), assets: make(map[string]bool)}
}
func (b *Budget) Take(candidate Candidate) bool {
	id := strings.TrimSpace(candidate.ResourceAssetID)
	resource := strings.TrimSpace(candidate.ResourceID)
	if resource == "" {
		resource = id
	}
	limit, ok := b.limits.For(candidate.MediaType)
	if id == "" || !ok || b.assets[id] || b.resources[resource] || b.used[candidate.MediaType] >= limit {
		return false
	}
	b.assets[id] = true
	b.resources[resource] = true
	b.used[candidate.MediaType]++
	return true
}
