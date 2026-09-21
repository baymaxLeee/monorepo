package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"sort"
	"unicode/utf8"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	domain "github.com/example/monorepo/canvas/internal/server/domain/canvas"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func nodeDTO(v p.Node) (c.Node, error) {
	var config c.GenerationConfig
	if err := json.Unmarshal([]byte(v.GenerationConfig), &config); err != nil {
		return c.Node{}, err
	}
	edges := []c.Edge{}
	if err := json.Unmarshal([]byte(v.IncomingEdges), &edges); err != nil {
		return c.Node{}, err
	}
	return c.Node{AssetID: v.AssetID, ResourceID: v.ResourceID, ResourceAssetID: v.ResourceAssetID, GenerationConfig: config, VideoInputMode: v.VideoInputMode, ID: v.ID, Type: v.Type, Name: v.Name, Text: v.Text, Prompt: v.Prompt, X: v.X, Y: v.Y, StoryboardRank: v.StoryboardRank, Revision: v.Revision, IncomingEdges: edges}, nil
}
func readGraph(db *gorm.DB, board p.Board) (c.Graph, error) {
	var rows []p.Node
	if err := db.Where("canvas_id = ?", board.ID).Order("created_at, id").Find(&rows).Error; err != nil {
		return c.Graph{}, err
	}
	resourceAssetIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.ResourceAssetID != "" {
			resourceAssetIDs = append(resourceAssetIDs, row.ResourceAssetID)
		}
	}
	if len(resourceAssetIDs) > 0 {
		type liveAsset struct {
			ResourceAssetID string
			AssetID         string
			Name            string
			MediaType       int16
		}
		var live []liveAsset
		if err := db.Table("resource_assets").Select("resource_assets.id AS resource_asset_id, resource_assets.current_asset_id AS asset_id, resource_assets.name, resource_assets.media_type").Joins(
			"JOIN resources ON resources.id = resource_assets.resource_id AND resources.project_id = ? AND resources.deleted_at IS NULL", board.ProjectID,
		).Where("resource_assets.id IN ? AND resource_assets.deleted_at IS NULL", resourceAssetIDs).Scan(&live).Error; err != nil {
			return c.Graph{}, err
		}
		byID := make(map[string]liveAsset, len(live))
		for _, item := range live {
			byID[item.ResourceAssetID] = item
		}
		for index := range rows {
			if item, ok := byID[rows[index].ResourceAssetID]; ok {
				rows[index].AssetID, rows[index].Name, rows[index].Type = item.AssetID, item.Name, item.MediaType
			}
		}
	}
	result := c.Graph{Canvas: boardDTO(board), Nodes: []c.Node{}}
	for _, row := range rows {
		node, err := nodeDTO(row)
		if err != nil {
			return c.Graph{}, err
		}
		result.Nodes = append(result.Nodes, node)
	}
	return result, nil
}
func boardAccess(db *gorm.DB, a Actor, id string, write bool) (p.Board, error) {
	var board p.Board
	if err := db.Where("id = ?", id).First(&board).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return board, NotFound()
		}
		return board, err
	}
	_, err := access(db, a, board.ProjectID, write)
	return board, err
}
func (s *Service) Graph(ctx context.Context, a Actor, id string) (c.Graph, error) {
	var result c.Graph
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, a, id, false)
		if err != nil {
			return err
		}
		// Share the board lock with mutations so revision and nodes form one snapshot.
		if err = tx.Clauses(clause.Locking{Strength: "SHARE"}).First(&board, "id = ?", id).Error; err != nil {
			return err
		}
		result, err = readGraph(tx, board)
		return err
	})
	return result, err
}
func validNode(n c.Node) error {
	if n.VideoInputMode != 1 && n.VideoInputMode != 2 {
		return Invalid("invalid video input mode")
	}
	if n.Type != 6 && n.VideoInputMode != 1 {
		return Invalid("frame mode only applies to video generation")
	}
	if len(n.GenerationConfig.ProviderID) > 32 || len(n.GenerationConfig.Resolution) > 32 || len(n.GenerationConfig.AspectRatio) > 32 || n.GenerationConfig.DurationSeconds < -1 {
		return Invalid("invalid generation configuration")
	}
	if n.ID == "" || len(n.ID) > 36 || !domain.ValidCanvasNodeName(n.Name) || !utf8.ValidString(n.Text) || !utf8.ValidString(n.Prompt) || utf8.RuneCountInString(n.Prompt) > 50000 {
		return Invalid("invalid node")
	}
	if math.IsNaN(n.X) || math.IsInf(n.X, 0) || math.IsNaN(n.Y) || math.IsInf(n.Y, 0) {
		return Invalid("invalid position")
	}
	// Media nodes require the asset ownership migration before they can be created.
	if n.Type < 1 || n.Type > 7 || (n.Type <= 3 && n.AssetID == "") || ((n.Type == 4 || n.Type == 7) && n.AssetID != "") {
		return Invalid("media nodes require an owned asset")
	}
	if (n.Type == 6 && n.StoryboardRank <= 0) || (n.Type != 6 && n.StoryboardRank != 0) {
		return Invalid("invalid storyboard rank")
	}
	return nil
}
func validateGraph(nodes map[string]c.Node) error {
	all := make([]domain.CanvasNode, 0, len(nodes))
	edgeIDs := map[string]bool{}
	for _, n := range nodes {
		if err := validNode(n); err != nil {
			return err
		}
		v := domain.CanvasNode{ID: n.ID, Type: domain.NodeType(n.Type)}
		for _, e := range n.IncomingEdges {
			if e.ID == "" || len(e.ID) > 36 || edgeIDs[e.ID] {
				return Invalid("duplicate or invalid edge id")
			}
			edgeIDs[e.ID] = true
			v.IncomingEdges = append(v.IncomingEdges, domain.IncomingEdge{ID: e.ID, SourceNodeID: e.SourceNodeID, SourcePort: domain.Port(e.SourcePort), TargetPort: domain.Port(e.TargetPort), TargetOrder: e.TargetOrder})
		}
		all = append(all, v)
	}
	for _, n := range all {
		if err := domain.ValidateIncomingEdges(all, n.ID, n.IncomingEdges, domain.VideoInputMode(nodes[n.ID].VideoInputMode)); err != nil {
			return Invalid(err.Error())
		}
	}
	return nil
}
func (s *Service) Mutate(ctx context.Context, a Actor, id string, in c.Mutation) (c.Graph, error) {
	if len(in.OperationID) < 1 || len(in.OperationID) > 160 || in.ExpectedRevision < 1 || len(in.Upsert)+len(in.DeleteIDs) == 0 {
		return c.Graph{}, Invalid("operation id, revision and changes are required")
	}
	raw, err := json.Marshal(in)
	if err != nil {
		return c.Graph{}, err
	}
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	var result c.Graph
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, a, id, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", id).Error; err != nil {
			return err
		}
		var op p.Operation
		err = tx.Where("canvas_id = ? AND user_id = ? AND operation_id = ?", id, a.UserID, in.OperationID).First(&op).Error
		if err == nil {
			if op.RequestHash != hash {
				return Invalid("operation id was already used with different input")
			}
			return json.Unmarshal([]byte(op.Result), &result)
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		if board.Revision != in.ExpectedRevision {
			return Conflict()
		}
		graph, err := readGraph(tx, board)
		if err != nil {
			return err
		}
		nodes := map[string]c.Node{}
		for _, n := range graph.Nodes {
			nodes[n.ID] = n
		}
		removed := map[string]bool{}
		for _, nodeID := range in.DeleteIDs {
			if removed[nodeID] {
				return Invalid("duplicate delete id")
			}
			if _, ok := nodes[nodeID]; !ok {
				return NotFound()
			}
			removed[nodeID] = true
			delete(nodes, nodeID)
		}
		changed := map[string]bool{}
		createdMedia := map[string]string{}
		for _, n := range in.Upsert {
			if changed[n.ID] || removed[n.ID] {
				return Invalid("duplicate node mutation")
			}
			changed[n.ID] = true
			old, exists := nodes[n.ID]
			if exists {
				if old.Type != n.Type || old.AssetID != n.AssetID || old.ResourceID != n.ResourceID || old.ResourceAssetID != n.ResourceAssetID {
					return Invalid("node type is immutable")
				}
				if old.Revision != n.Revision {
					return Conflict()
				}
				n.Revision++
			} else {
				if n.Type <= 3 {
					if n.AssetID == "" {
						return Invalid("media nodes require an owned asset")
					}
					var owned int64
					if err := tx.Model(&p.Asset{}).Where(
						"id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'PROJECT_ASSET' AND deleted_at IS NULL)",
						n.AssetID, a.TenantID, a.WorkspaceID, board.ProjectID,
					).Count(&owned).Error; err != nil {
						return err
					}
					if owned != 1 {
						return NotFound()
					}
					createdMedia[n.ID] = n.AssetID
				} else if n.AssetID != "" {
					return Invalid("generated nodes cannot bind uploaded assets")
				}
				if n.Revision != 0 {
					return Conflict()
				}
				var count int64
				if err := tx.Unscoped().Model(&p.Node{}).Where("id = ?", n.ID).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					return Conflict()
				}
				n.Revision = 1
			}
			if n.IncomingEdges == nil {
				n.IncomingEdges = []c.Edge{}
			}
			nodes[n.ID] = n
		}
		for nodeID, n := range nodes {
			edges := []c.Edge{}
			for _, e := range n.IncomingEdges {
				if !removed[e.SourceNodeID] {
					edges = append(edges, e)
				}
			}
			if len(edges) != len(n.IncomingEdges) {
				if !changed[nodeID] {
					n.Revision++
				}
				n.IncomingEdges = edges
				changed[nodeID] = true
				nodes[nodeID] = n
			}
		}
		if err := validateGraph(nodes); err != nil {
			return err
		}
		if len(in.DeleteIDs) > 0 {
			if err := releaseGenerationOwners(tx, tx.Model(&p.Node{}).Select("id").Where("canvas_id = ? AND id IN ?", id, in.DeleteIDs)); err != nil {
				return err
			}
			if err := tx.Where("owner_type = ? AND owner_key IN ?", "CANVAS_NODE_ASSET", in.DeleteIDs).Delete(&p.AssetReference{}).Error; err != nil {
				return err
			}
			if err := tx.Where("canvas_id = ? AND id IN ?", id, in.DeleteIDs).Delete(&p.Node{}).Error; err != nil {
				return err
			}
		}
		for nodeID := range changed {
			n := nodes[nodeID]
			edges, err := json.Marshal(n.IncomingEdges)
			if err != nil {
				return err
			}
			config, err := json.Marshal(n.GenerationConfig)
			if err != nil {
				return err
			}
			v := p.Node{AssetID: n.AssetID, ResourceID: n.ResourceID, ResourceAssetID: n.ResourceAssetID, GenerationConfig: string(config), VideoInputMode: n.VideoInputMode, ID: n.ID, CanvasID: id, Type: n.Type, Name: n.Name, Text: n.Text, Prompt: n.Prompt, X: n.X, Y: n.Y, StoryboardRank: n.StoryboardRank, Revision: n.Revision, IncomingEdges: string(edges)}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"generation_config", "video_input_mode", "name", "text", "prompt", "x", "y", "storyboard_rank", "revision", "incoming_edges", "updated_at"})}).Create(&v).Error; err != nil {
				return err
			}
			if assetID := createdMedia[nodeID]; assetID != "" {
				if err := tx.Create(&p.AssetReference{AssetID: assetID, OwnerType: "CANVAS_NODE_ASSET", OwnerKey: nodeID}).Error; err != nil {
					return err
				}
			}
		}
		board.Revision++
		if err := tx.Save(&board).Error; err != nil {
			return err
		}
		result = c.Graph{Canvas: boardDTO(board), Nodes: []c.Node{}}
		for _, n := range nodes {
			result.Nodes = append(result.Nodes, n)
		}
		sort.Slice(result.Nodes, func(i, j int) bool { return result.Nodes[i].ID < result.Nodes[j].ID })
		body, err := json.Marshal(result)
		if err != nil {
			return err
		}
		return tx.Create(&p.Operation{CanvasID: id, UserID: a.UserID, OperationID: in.OperationID, RequestHash: hash, Result: string(body)}).Error
	})
	return result, err
}
