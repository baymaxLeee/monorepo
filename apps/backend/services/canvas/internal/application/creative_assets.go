package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	ad "github.com/example/monorepo/canvas/internal/server/domain/asset"
	rd "github.com/example/monorepo/canvas/internal/server/domain/resource"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"time"
)

func ownedCreativeAsset(db *gorm.DB, a Actor, projectID, id string) (p.Asset, error) {
	var v p.Asset
	e := db.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND deleted_at IS NULL)", id, a.TenantID, a.WorkspaceID, projectID).First(&v).Error
	if e == gorm.ErrRecordNotFound {
		return v, NotFound()
	}
	return v, e
}
func creativeMediaType(mime string) int16 {
	if strings.HasPrefix(mime, "image/") {
		return 1
	}
	if strings.HasPrefix(mime, "video/") {
		return 2
	}
	if strings.HasPrefix(mime, "audio/") {
		return 3
	}
	return 0
}
func (s *Service) ResourceFromNode(ctx context.Context, a Actor, canvasID, nodeID string, in c.ResourceFromNode) (c.Resource, error) {
	var result c.Resource
	e := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, e := boardAccess(tx, a, canvasID, true)
		if e != nil {
			return e
		}
		if len(in.ResourceID) < 1 || len(in.ResourceID) > 36 {
			return Invalid("invalid resource id")
		}
		if e = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; e != nil {
			return e
		}
		var node p.Node
		if e = tx.Where("id = ? AND canvas_id = ?", nodeID, canvasID).First(&node).Error; e != nil {
			return NotFound()
		}
		asset, e := ownedCreativeAsset(tx, a, board.ProjectID, node.AssetID)
		if e != nil {
			return e
		}
		kind := creativeMediaType(asset.MimeType)
		if (in.Type == 4 && kind != 3) || (in.Type != 4 && kind != 1) {
			return Invalid("此资源类型仅接受图片或音频素材")
		}
		var old p.Resource
		e = tx.Unscoped().First(&old, "id = ?", in.ResourceID).Error
		if e == nil {
			if old.DeletedAt.Valid || old.ProjectID != board.ProjectID || old.Name != in.Name || old.Type != in.Type || old.Description != in.Description || old.TenantID != a.TenantID || old.WorkspaceID != a.WorkspaceID {
				return Conflict()
			}
			var slot p.ResourceAsset
			if e = tx.First(&slot, "id = ? AND current_asset_id = ?", old.PrimaryResourceAssetID, asset.ID).Error; e != nil {
				return Conflict()
			}
			result = resourceDTO(old)
			return nil
		}
		if e != gorm.ErrRecordNotFound {
			return e
		}
		now := time.Now()
		value, e := rd.New(rd.NewInput{ID: in.ResourceID, TenantID: a.TenantID, OwnerType: rd.OwnerProject, OwnerID: board.ProjectID, Type: rd.Type(in.Type), Name: in.Name, Description: in.Description, CreatedBy: a.UserID, Now: now})
		if e != nil {
			return Invalid(e.Error())
		}
		slotID := newID()
		slot, e := rd.NewResourceAsset(rd.NewResourceAssetInput{ID: slotID, ResourceID: in.ResourceID, Name: in.Name, SequenceNo: 1, CurrentAssetID: asset.ID, MediaType: ad.MediaType(kind), Now: now})
		if e != nil {
			return Invalid(e.Error())
		}
		row := p.Resource{ID: value.ID, TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, ProjectID: board.ProjectID, Type: in.Type, Name: value.Name, Description: value.Description, PrimaryResourceAssetID: slotID, ResourceAssetCount: 1, CreatedBy: a.UserID, Revision: 1}
		for _, v := range []any{&row, &p.ResourceAsset{ID: slotID, ResourceID: row.ID, Name: slot.Name, SequenceNo: 1, SourceType: int16(slot.SourceType), CurrentAssetID: asset.ID, MediaType: kind, Revision: 1}, &p.ResourceAssetRevision{ResourceAssetID: slotID, AssetID: asset.ID, MediaType: kind, RevisionNo: 1}, &p.AssetReference{AssetID: asset.ID, OwnerType: "RESOURCE_ASSET_REVISION", OwnerKey: slotID}} {
			if e = tx.Create(v).Error; e != nil {
				return e
			}
		}
		result = resourceDTO(row)
		return nil
	})
	return result, e
}
func (s *Service) CopyCanvasNode(ctx context.Context, a Actor, id, nodeID string, in c.CopyNode) (c.Graph, error) {
	return s.createCreativeNode(ctx, a, id, in.NodeID, in.ExpectedRevision, "node:"+nodeID, func(tx *gorm.DB, board p.Board) (p.Node, error) {
		var node p.Node
		if e := tx.Where("id = ? AND canvas_id = ?", nodeID, id).First(&node).Error; e != nil {
			return node, NotFound()
		}
		if node.AssetID != "" {
			if _, e := ownedCreativeAsset(tx, a, board.ProjectID, node.AssetID); e != nil {
				return node, e
			}
		}
		node.ID = in.NodeID
		node.X += 48
		node.Y += 48
		node.Revision = 1
		node.CreatedAt = time.Time{}
		node.UpdatedAt = time.Time{}
		var edges []c.Edge
		if e := json.Unmarshal([]byte(node.IncomingEdges), &edges); e != nil {
			return node, e
		}
		for i := range edges {
			edges[i].ID = newID()
		}
		raw, e := json.Marshal(edges)
		node.IncomingEdges = string(raw)
		return node, e
	})
}
func (s *Service) CopyCanvasAsset(ctx context.Context, a Actor, id string, in c.CopyAsset) (c.Graph, error) {
	return s.createCreativeNode(ctx, a, id, in.NodeID, in.ExpectedRevision, "asset:"+in.AssetID+":"+fmt.Sprint(in.X, ":", in.Y), func(tx *gorm.DB, board p.Board) (p.Node, error) {
		asset, e := ownedCreativeAsset(tx, a, board.ProjectID, in.AssetID)
		if e != nil {
			return p.Node{}, e
		}
		kind := creativeMediaType(asset.MimeType)
		if kind == 0 {
			return p.Node{}, Invalid("unsupported asset")
		}
		return p.Node{ID: in.NodeID, CanvasID: id, AssetID: asset.ID, Type: kind, Name: "参考素材", X: in.X, Y: in.Y, Revision: 1, VideoInputMode: 1, GenerationConfig: "{}", IncomingEdges: "[]"}, nil
	})
}
func (s *Service) createCreativeNode(ctx context.Context, a Actor, id, newID string, revision int64, fingerprint string, build func(*gorm.DB, p.Board) (p.Node, error)) (c.Graph, error) {
	var out c.Graph
	if len(newID) < 1 || len(newID) > 36 || revision < 1 {
		return out, Invalid("node id and revision required")
	}
	e := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, e := boardAccess(tx, a, id, true)
		if e != nil {
			return e
		}
		if e = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", id).Error; e != nil {
			return e
		}
		digest := sha256.Sum256([]byte(fingerprint))
		hash := hex.EncodeToString(digest[:])
		var op p.Operation
		opErr := tx.Where("canvas_id = ? AND user_id = ? AND operation_id = ?", id, a.UserID, "creative-copy:"+newID).First(&op).Error
		if opErr == nil {
			if op.RequestHash != hash {
				return Conflict()
			}
			var existing p.Node
			if err := tx.First(&existing, "id = ? AND canvas_id = ?", newID, id).Error; err != nil {
				return Conflict()
			}
			out, e = readGraph(tx, board)
			return e
		}
		if opErr != gorm.ErrRecordNotFound {
			return opErr
		}
		if board.Revision != revision {
			return Conflict()
		}
		node, e := build(tx, board)
		if e != nil {
			return e
		}
		if node.Type == 6 {
			if e = tx.Model(&p.Node{}).Where("canvas_id = ?", id).Select("COALESCE(MAX(storyboard_rank),0)+1").Scan(&node.StoryboardRank).Error; e != nil {
				return e
			}
		}
		dto, e := nodeDTO(node)
		if e != nil {
			return e
		}
		if e = validNode(dto); e != nil {
			return e
		}
		var count int64
		if e = tx.Unscoped().Model(&p.Node{}).Where("id = ?", newID).Count(&count).Error; e != nil {
			return e
		}
		if count > 0 {
			return Conflict()
		}
		if e = tx.Create(&node).Error; e != nil {
			return e
		}
		if node.AssetID != "" {
			if e = tx.Create(&p.AssetReference{AssetID: node.AssetID, OwnerType: "CANVAS_NODE_ASSET", OwnerKey: node.ID}).Error; e != nil {
				return e
			}
		}
		board.Revision++
		if e = tx.Save(&board).Error; e != nil {
			return e
		}
		out, e = readGraph(tx, board)
		if e != nil {
			return e
		}
		raw, e := json.Marshal(out)
		if e != nil {
			return e
		}
		return tx.Create(&p.Operation{CanvasID: id, UserID: a.UserID, OperationID: "creative-copy:" + newID, RequestHash: hash, Result: string(raw)}).Error
	})
	return out, e
}
