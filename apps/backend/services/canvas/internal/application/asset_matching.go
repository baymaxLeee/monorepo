package application

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type matchCandidate struct {
	ResourceID      string `json:"resource_id"`
	ResourceAssetID string `json:"resource_asset_id"`
	AssetID         string `json:"asset_id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	MediaType       int16  `json:"media_type"`
}

type matchOutput struct {
	Matches []struct {
		ResourceAssetID string `json:"resource_asset_id"`
		Anchor          string `json:"anchor"`
	} `json:"matches"`
}

func assetMatchDTO(match p.AssetMatchRun, generation p.Generation) c.AssetMatchRun {
	errorText := generation.Error
	if match.Error != "" {
		errorText = match.Error
	}
	return c.AssetMatchRun{ID: match.ID, NodeID: match.NodeID, Status: generation.Status, Error: errorText, CancelRequested: generation.CancelRequested, Applied: match.Applied, CreatedAt: isoTime(match.CreatedAt)}
}

func loadMatchCandidates(tx *gorm.DB, actor Actor, projectID string, node p.Node) ([]matchCandidate, error) {
	rows := []matchCandidate{}
	query := tx.Table("resource_assets AS ra").
		Select("r.id AS resource_id, ra.id AS resource_asset_id, ra.current_asset_id AS asset_id, ra.name, r.description, ra.media_type").
		Joins("JOIN resources AS r ON r.id=ra.resource_id AND r.deleted_at IS NULL").
		Joins("JOIN assets AS a ON a.id=ra.current_asset_id AND a.deleted_at IS NULL").
		Where("ra.deleted_at IS NULL AND r.project_id=? AND r.tenant_id=? AND r.workspace_id=?", projectID, actor.TenantID, actor.WorkspaceID).
		Where("EXISTS (SELECT 1 FROM asset_references ar WHERE ar.asset_id=a.id AND ar.owner_type='RESOURCE_ASSET_REVISION' AND ar.owner_key=ra.id AND ar.deleted_at IS NULL)").
		Where("r.type <> 4 OR r.primary_resource_asset_id=ra.id")
	if node.Type == 5 {
		query = query.Where("ra.media_type=1")
	}
	if err := query.Order("r.type, r.created_at DESC, ra.sequence_no").Limit(40).Scan(&rows).Error; err != nil {
		return nil, err
	}
	var edges []c.Edge
	if err := json.Unmarshal([]byte(node.IncomingEdges), &edges); err != nil {
		return nil, err
	}
	sourceIDs := make([]string, 0, len(edges))
	for _, edge := range edges {
		sourceIDs = append(sourceIDs, edge.SourceNodeID)
	}
	used := map[string]bool{}
	if len(sourceIDs) > 0 {
		var assetIDs []string
		if err := tx.Model(&p.Node{}).Where("canvas_id=? AND id IN ? AND deleted_at IS NULL", node.CanvasID, sourceIDs).Pluck("asset_id", &assetIDs).Error; err != nil {
			return nil, err
		}
		for _, id := range assetIDs {
			used[id] = true
		}
	}
	available := rows[:0]
	for _, item := range rows {
		if !used[item.AssetID] {
			available = append(available, item)
		}
	}
	return available, nil
}

func matchingPrompt(prompt string, candidates []matchCandidate) (string, error) {
	visible, err := domain.ReplaceAssetMentionsWithLabels(prompt)
	if err != nil {
		return "", Invalid("提示词中的素材引用无效")
	}
	raw, err := json.Marshal(candidates)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`你是影视创作素材匹配器。只从候选素材中选择确实出现在脚本里的实体。返回严格 JSON，不要 Markdown：{"matches":[{"resource_asset_id":"候选ID","anchor":"脚本中原样出现的最短文本"}]}。同一资源最多一次，没有匹配返回空数组。脚本：%s\n候选素材：%s`, visible, raw), nil
}

func (s *Service) StartAssetMatch(ctx context.Context, actor Actor, canvasID, nodeID string, in c.StartAssetMatch) (c.AssetMatchRun, error) {
	if strings.TrimSpace(in.OperationID) == "" || len(in.OperationID) > 160 {
		return c.AssetMatchRun{}, Invalid("operation id is required")
	}
	var match p.AssetMatchRun
	var generation p.Generation
	initialBoard, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, true)
	if err != nil {
		return c.AssetMatchRun{}, err
	}
	providers, err := s.CreativeProviders(ctx, actor, initialBoard.ProjectID)
	if err != nil {
		return c.AssetMatchRun{}, err
	}
	var provider c.ProjectProvider
	for _, item := range providers.Items {
		if item.ProviderKind == "chat" {
			provider = item
			break
		}
	}
	if provider.ID == "" {
		return c.AssetMatchRun{}, &Error{Status: 503, Code: "model_unavailable", Message: "素材匹配模型不可用"}
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, actor, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id=?", canvasID).Error; err != nil {
			return err
		}
		if err = tx.Where("canvas_id=? AND user_id=? AND operation_id=?", canvasID, actor.UserID, in.OperationID).First(&generation).Error; err == nil {
			if generation.NodeID != nodeID {
				return Conflict()
			}
			if err = tx.First(&match, "id=?", generation.ID).Error; err != nil {
				return Conflict()
			}
			return nil
		} else if err != gorm.ErrRecordNotFound {
			return err
		}
		var node p.Node
		if err = tx.Where("id=? AND canvas_id=?", nodeID, canvasID).First(&node).Error; err != nil {
			return NotFound()
		}
		if node.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if strings.TrimSpace(node.Prompt) == "" || (node.Type != 5 && node.Type != 6) || (node.Type == 6 && node.VideoInputMode == 2) {
			return Invalid("当前节点不能进行素材匹配")
		}
		var active int64
		if err = tx.Model(&p.Generation{}).Where("node_id=? AND status IN ?", nodeID, []string{"queued", "running"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return Conflict()
		}
		candidates, err := loadMatchCandidates(tx, actor, board.ProjectID, node)
		if err != nil {
			return err
		}
		if len(candidates) == 0 {
			return Invalid("项目资源库中没有可匹配素材")
		}
		modelPrompt, err := matchingPrompt(node.Prompt, candidates)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(candidates)
		if err != nil {
			return err
		}
		id := newID()
		// Asset matching applies its own structured result. A sentinel keeps the
		// generic text worker from writing raw JSON into the node text field.
		generation = p.Generation{ID: id, CanvasID: canvasID, NodeID: nodeID, TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, UserID: actor.UserID, OperationID: in.OperationID, NodeRevision: -1, ProviderID: provider.ID, Prompt: modelPrompt, Status: "queued", TaskType: "text-generation", InputPayload: "{}"}
		match = p.AssetMatchRun{ID: id, CanvasID: canvasID, NodeID: nodeID, NodeRevision: node.Revision, OriginalPrompt: node.Prompt, Candidates: string(raw)}
		if err = tx.Create(&generation).Error; err != nil {
			return err
		}
		if err = tx.Create(&match).Error; err != nil {
			return err
		}
		return tx.Create(&p.GenerationUsageMetadata{GenerationID: id, TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: board.ProjectID, ModelName: provider.Name, ModelID: provider.Model}).Error
	})
	if err != nil {
		return c.AssetMatchRun{}, err
	}
	return assetMatchDTO(match, generation), nil
}

func parseMatchOutput(text string) (matchOutput, error) {
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end < start {
		return matchOutput{}, fmt.Errorf("missing JSON result")
	}
	var out matchOutput
	if err := json.Unmarshal([]byte(text[start:end+1]), &out); err != nil {
		return out, err
	}
	return out, nil
}

func stableMatchNodeID(runID, assetID string) string {
	return strings.ReplaceAll(uuid.NewSHA1(uuid.NameSpaceOID, []byte(runID+":"+assetID)).String(), "-", "")
}

func (s *Service) applyAssetMatch(ctx context.Context, actor Actor, match p.AssetMatchRun, generation p.Generation) error {
	output, err := parseMatchOutput(generation.OutputText)
	if err != nil {
		return s.DB.WithContext(ctx).Model(&p.AssetMatchRun{}).Where("id=? AND applied=false", match.ID).Update("error", "素材匹配结果无效，请重试").Error
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&match, "id=?", match.ID).Error; err != nil {
			return err
		}
		if match.Applied || match.Error != "" {
			return nil
		}
		board, err := boardAccess(tx, actor, match.CanvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id=?", match.CanvasID).Error; err != nil {
			return err
		}
		var target p.Node
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND canvas_id=?", match.NodeID, match.CanvasID).First(&target).Error; err != nil {
			return NotFound()
		}
		if target.Revision != match.NodeRevision || target.Prompt != match.OriginalPrompt {
			return ConflictMessage("asset_match_stale", "节点已变化，素材匹配结果未应用")
		}
		var candidates []matchCandidate
		if err = json.Unmarshal([]byte(match.Candidates), &candidates); err != nil {
			return err
		}
		byID := make(map[string]matchCandidate, len(candidates))
		for _, item := range candidates {
			byID[item.ResourceAssetID] = item
		}
		prompt := target.Prompt
		counts := map[int16]int{}
		nextOrder := map[int16]int32{}
		var edges []c.Edge
		if err = json.Unmarshal([]byte(target.IncomingEdges), &edges); err != nil {
			return err
		}
		for _, edge := range edges {
			media := int16(0)
			switch edge.TargetPort {
			case "REFERENCE_IMAGE":
				media = 1
			case "REFERENCE_VIDEO":
				media = 2
			case "REFERENCE_AUDIO":
				media = 3
			}
			if media != 0 {
				counts[media]++
				if nextOrder[media] <= edge.TargetOrder {
					nextOrder[media] = edge.TargetOrder + 1
				}
			}
		}
		seenResource := map[string]bool{}
		changed := false
		for index, selected := range output.Matches {
			item, ok := byID[selected.ResourceAssetID]
			limit := map[int16]int{1: 4, 2: 2, 3: 1}[item.MediaType]
			if !ok || limit == 0 || counts[item.MediaType] >= limit || seenResource[item.ResourceID] {
				continue
			}
			nodeID := stableMatchNodeID(match.ID, item.ResourceAssetID)
			next, inserted, insertErr := domain.InsertAssetMentionAfterText(prompt, strings.TrimSpace(selected.Anchor), nodeID, item.Name)
			if insertErr != nil {
				return Invalid("素材匹配锚点无效")
			}
			if !inserted {
				continue
			}
			var slot p.ResourceAsset
			if err = tx.Where("id=? AND resource_id=? AND current_asset_id=?", item.ResourceAssetID, item.ResourceID, item.AssetID).First(&slot).Error; err != nil {
				continue
			}
			var resource p.Resource
			if err = tx.Where("id=? AND project_id=?", item.ResourceID, board.ProjectID).First(&resource).Error; err != nil {
				continue
			}
			node := p.Node{ID: nodeID, CanvasID: match.CanvasID, AssetID: item.AssetID, Type: item.MediaType, Name: item.Name, X: target.X - 360, Y: target.Y + float64(index)*180, Revision: 1, VideoInputMode: 1, GenerationConfig: "{}", IncomingEdges: "[]"}
			if err = tx.Create(&node).Error; err != nil {
				return err
			}
			if err = tx.Create(&p.AssetReference{AssetID: item.AssetID, OwnerType: "CANVAS_NODE_ASSET", OwnerKey: nodeID}).Error; err != nil {
				return err
			}
			port := "REFERENCE_IMAGE"
			if item.MediaType == 2 {
				port = "REFERENCE_VIDEO"
			} else if item.MediaType == 3 {
				port = "REFERENCE_AUDIO"
			}
			edges = append(edges, c.Edge{ID: newID(), SourceNodeID: nodeID, SourcePort: "OUTPUT", TargetPort: port, TargetOrder: nextOrder[item.MediaType]})
			prompt = next
			counts[item.MediaType]++
			nextOrder[item.MediaType]++
			seenResource[item.ResourceID] = true
			changed = true
		}
		if changed {
			rawEdges, err := json.Marshal(edges)
			if err != nil {
				return err
			}
			target.Prompt, target.IncomingEdges, target.Revision = prompt, string(rawEdges), target.Revision+1
			if err = tx.Save(&target).Error; err != nil {
				return err
			}
			board.Revision++
			if err = tx.Save(&board).Error; err != nil {
				return err
			}
		}
		match.Applied = true
		return tx.Save(&match).Error
	})
}

func (s *Service) GetAssetMatch(ctx context.Context, actor Actor, canvasID, nodeID, runID string) (c.AssetMatchRun, error) {
	if _, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, false); err != nil {
		return c.AssetMatchRun{}, err
	}
	var match p.AssetMatchRun
	var generation p.Generation
	if err := s.DB.WithContext(ctx).Where("id=? AND canvas_id=? AND node_id=?", runID, canvasID, nodeID).First(&match).Error; err != nil {
		return c.AssetMatchRun{}, NotFound()
	}
	if err := s.DB.WithContext(ctx).Where("id=? AND tenant_id=? AND workspace_id=?", runID, actor.TenantID, actor.WorkspaceID).First(&generation).Error; err != nil {
		return c.AssetMatchRun{}, NotFound()
	}
	if generation.Status == "completed" && !match.Applied && match.Error == "" {
		if err := s.applyAssetMatch(ctx, actor, match, generation); err != nil {
			if appErr, ok := err.(*Error); ok && appErr.Code == "asset_match_stale" {
				match.Error = appErr.Message
				if updateErr := s.DB.WithContext(ctx).Model(&p.AssetMatchRun{}).Where("id=? AND applied=false", runID).Update("error", match.Error).Error; updateErr != nil {
					return c.AssetMatchRun{}, updateErr
				}
			} else {
				return c.AssetMatchRun{}, err
			}
		}
		_ = s.DB.WithContext(ctx).First(&match, "id=?", runID).Error
	}
	return assetMatchDTO(match, generation), nil
}

func (s *Service) LatestAssetMatch(ctx context.Context, actor Actor, canvasID, nodeID string) (c.AssetMatchRun, error) {
	if _, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, false); err != nil {
		return c.AssetMatchRun{}, err
	}
	var match p.AssetMatchRun
	if err := s.DB.WithContext(ctx).Where("canvas_id=? AND node_id=?", canvasID, nodeID).Order("created_at DESC,id DESC").First(&match).Error; err != nil {
		return c.AssetMatchRun{}, NotFound()
	}
	return s.GetAssetMatch(ctx, actor, canvasID, nodeID, match.ID)
}

func (s *Service) CancelAssetMatch(ctx context.Context, actor Actor, canvasID, nodeID, runID string) (c.AssetMatchRun, error) {
	if _, err := boardAccess(s.DB.WithContext(ctx), actor, canvasID, true); err != nil {
		return c.AssetMatchRun{}, err
	}
	var generation p.Generation
	if err := s.DB.WithContext(ctx).Where("id=? AND canvas_id=? AND node_id=?", runID, canvasID, nodeID).First(&generation).Error; err != nil {
		return c.AssetMatchRun{}, NotFound()
	}
	if generation.Status == "queued" || generation.Status == "running" {
		generation.CancelRequested = true
		if err := s.DB.WithContext(ctx).Save(&generation).Error; err != nil {
			return c.AssetMatchRun{}, err
		}
		if generation.TaskID != "" {
			if _, err := s.Executor.Cancel(ctx, generation.TaskID, generation.ID); err != nil {
				return c.AssetMatchRun{}, err
			}
		}
	}
	var match p.AssetMatchRun
	if err := s.DB.WithContext(ctx).First(&match, "id=?", runID).Error; err != nil {
		return c.AssetMatchRun{}, err
	}
	return assetMatchDTO(match, generation), nil
}
