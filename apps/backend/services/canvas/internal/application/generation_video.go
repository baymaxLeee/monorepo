package application

import (
	"encoding/json"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	inputs "github.com/example/monorepo/canvas/internal/application/generationinput"
	inputdomain "github.com/example/monorepo/canvas/internal/domain/generationinput"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
)

func videoPayload(tx *gorm.DB, a Actor, projectID string, node c.Node, resolved inputs.Result) (string, error) {
	config := node.GenerationConfig
	if config.DurationSeconds != -1 && config.DurationSeconds <= 0 {
		return "", Invalid("请选择生成时长")
	}
	references := []map[string]string{}
	for _, input := range resolved.Inputs {
		if input.Modality == inputdomain.ModalityText {
			continue
		}
		var asset p.Asset
		if err := tx.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ?", input.AssetID, a.TenantID, a.WorkspaceID, projectID).First(&asset).Error; err != nil {
			return "", NotFound()
		}
		kind := strings.SplitN(asset.MimeType, "/", 2)[0]
		if kind != "image" && kind != "video" && kind != "audio" {
			return "", Invalid("参考素材格式不受支持")
		}
		role := "reference_" + kind
		if input.Role == inputdomain.RoleFirstFrame {
			role = "first_frame"
		}
		if input.Role == inputdomain.RoleLastFrame {
			role = "last_frame"
		}
		references = append(references, map[string]string{"key": asset.ObjectKey, "mimeType": asset.MimeType, "role": role})
	}
	payload := map[string]any{"tenantId": a.TenantID, "workspaceId": a.WorkspaceID, "providerId": config.ProviderID, "prompt": resolved.Prompt, "objectScope": storage.Scope(a.TenantID, a.WorkspaceID, projectID), "references": references, "duration": config.DurationSeconds, "generateAudio": config.GenerateAudio, "watermark": config.Watermark}
	if config.Resolution != "" {
		resolution := strings.ToLower(config.Resolution)
		switch resolution {
		case "480p", "720p", "1080p", "2k", "4k":
		default:
			return "", Invalid("分辨率不受支持")
		}
		payload["resolution"] = resolution
	}
	if config.AspectRatio != "" {
		switch config.AspectRatio {
		case "21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3", "adaptive":
		default:
			return "", Invalid("画幅不受支持")
		}
		payload["aspectRatio"] = config.AspectRatio
	}
	encoded, err := json.Marshal(payload)
	return string(encoded), err
}
