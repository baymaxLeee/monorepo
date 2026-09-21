package assetmatching

import (
	domainasset "github.com/example/monorepo/canvas/internal/server/domain/asset"
)

type Candidate struct {
	ResourceAssetID string                `json:"resource_asset_id"`
	Name            string                `json:"name"`
	MediaType       domainasset.MediaType `json:"media_type"`
	ResourceID      string                `json:"resource_id,omitempty"`
	ResourceName    string                `json:"resource_name,omitempty"`
	Description     string                `json:"description,omitempty"`
	Primary         bool                  `json:"primary,omitempty"`
}

type Binding struct {
	ResourceAssetID string
	EntityName      string
}

func AppendBinding(
	bindings []Binding,
	binding Binding,
) []Binding {
	for _, existing := range bindings {
		if existing.ResourceAssetID == binding.ResourceAssetID {
			return bindings
		}
	}
	return append(bindings, binding)
}

// SelectionRules is shared by single-node and batch inference so appearance and
// primary-look decisions do not drift between the two entry points.
const SelectionRules = "以全局设定、位置参考和镜头叙述共同判断实际出镜的人物、场景、道具与明确需要的音频；仅在台词提及、否定要求或连续性角色表中出现不算出镜。优先依据剧情阶段、场景和镜头描述与素材名称、描述做语义匹配；只有可靠命中具体形象时才选择非主素材，否则选择该 resource 的 primary=true 主素材。同一分镜同一 resource 最多选择一个形象；同一实际人物只选择一个最合适的素材，即使候选属于不同 resource，也不能因别称或名称子串重复匹配（例如“老太监2”不能同时配“太后心腹太监2”和“太监2”）；不同人物仍分别判断，实体归属不确定时不选。"
