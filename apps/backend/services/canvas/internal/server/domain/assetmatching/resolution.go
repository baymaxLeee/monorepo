package assetmatching

import (
	"strings"

	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
)

// AvailableCandidates applies the same media admission before either model call.
func AvailableCandidates(candidates []Candidate, limits Limits, used map[domainasset.MediaType]int64) []Candidate {
	result := make([]Candidate, 0, len(candidates))
	seen := make(map[string]bool)
	for _, c := range candidates {
		limit, ok := limits.For(c.MediaType)
		if !ok || used[c.MediaType] >= limit || c.ResourceAssetID == "" || seen[c.ResourceAssetID] || (c.MediaType == domainasset.MediaAudio && !c.Primary) {
			continue
		}
		seen[c.ResourceAssetID] = true
		result = append(result, c)
	}
	return result
}

// ResolveBindings validates candidate identity and literal anchors without
// overriding the model's semantic decisions or adding unselected assets.
func ResolveBindings(prompt string, bindings []Binding, candidates []Candidate) []Binding {
	byID := make(map[string]Candidate, len(candidates))
	for _, c := range candidates {
		byID[c.ResourceAssetID] = c
	}
	valid := make([]Binding, 0, len(bindings))
	for _, b := range bindings {
		b.EntityName = strings.TrimSpace(b.EntityName)
		if _, ok := byID[b.ResourceAssetID]; ok && b.EntityName != "" && strings.Contains(prompt, b.EntityName) {
			valid = AppendBinding(valid, b)
		}
	}
	return valid
}

// ReferenceTarget returns a byte range so callers insert only in the chosen
// narrative field. Structured prompts exclude summaries; audio belongs in shots.
func ReferenceTarget(prompt string, media domainasset.MediaType, anchor string) (string, int, int) {
	if strings.TrimSpace(anchor) == "" {
		return "", 0, 0
	}
	markers := []struct{ name, marker string }{{"global_setting", "【全局设定】"}, {"position_reference", "【位置参考】"}, {"shots", "【镜头脚本】"}}
	structured := false
	for _, field := range markers {
		start := strings.Index(prompt, field.marker)
		if start < 0 {
			continue
		}
		structured = true
		start += len(field.marker)
		end := len(prompt)
		for _, next := range markers {
			if i := strings.Index(prompt[start:], next.marker); i >= 0 && start+i < end {
				end = start + i
			}
		}
		if media == domainasset.MediaAudio && field.name != "shots" {
			continue
		}
		if strings.Contains(prompt[start:end], anchor) {
			return field.name, start, end
		}
	}
	if !structured && strings.Contains(prompt, anchor) {
		return "shots", 0, len(prompt)
	}
	return "", 0, 0
}
