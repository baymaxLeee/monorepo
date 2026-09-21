package application

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/example/monorepo/canvas/internal/infrastructure/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MediaContent struct {
	Body io.ReadCloser
	MIME string
}

func (s *Service) UploadNode(ctx context.Context, a Actor, canvasID, nodeID, name string, body io.Reader) (c.Graph, error) {
	if !validName(name) || len(nodeID) < 1 || len(nodeID) > 36 {
		return c.Graph{}, Invalid("invalid media node identity")
	}
	board, err := boardAccess(s.DB.WithContext(ctx), a, canvasID, true)
	if err != nil {
		return c.Graph{}, err
	}
	key, mime, kind, err := s.storeMedia(ctx, a, board.ProjectID, body)
	if err != nil {
		return c.Graph{}, err
	}
	var result c.Graph
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err = boardAccess(tx, a, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		var old p.Node
		err = tx.Unscoped().First(&old, "id = ?", nodeID).Error
		if err == nil {
			if old.CanvasID != canvasID || old.DeletedAt.Valid {
				return Conflict()
			}
			var asset p.Asset
			if err = tx.First(&asset, "id = ?", old.AssetID).Error; err != nil {
				return Conflict()
			}
			if asset.ObjectKey != key {
				return Conflict()
			}
			result, err = readGraph(tx, board)
			return err
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		asset := p.Asset{ID: newID(), TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, ProjectID: board.ProjectID, ObjectKey: key, MimeType: mime}
		if err = tx.Create(&asset).Error; err != nil {
			return err
		}
		config, _ := json.Marshal(c.GenerationConfig{})
		node := p.Node{ID: nodeID, CanvasID: canvasID, AssetID: asset.ID, Type: kind, Name: name, Revision: 1, VideoInputMode: 1, GenerationConfig: string(config), IncomingEdges: "[]"}
		if err = tx.Create(&node).Error; err != nil {
			return err
		}
		if err = tx.Create(&p.AssetReference{AssetID: asset.ID, OwnerType: "CANVAS_NODE_ASSET", OwnerKey: nodeID}).Error; err != nil {
			return err
		}
		board.Revision++
		if err = tx.Save(&board).Error; err != nil {
			return err
		}
		result, err = readGraph(tx, board)
		return err
	})
	return result, err
}
func (s *Service) NodeContent(ctx context.Context, a Actor, canvasID, nodeID string) (MediaContent, error) {
	db := s.DB.WithContext(ctx)
	board, err := boardAccess(db, a, canvasID, false)
	if err != nil {
		return MediaContent{}, err
	}
	var node p.Node
	if err = db.Where("id = ? AND canvas_id = ?", nodeID, canvasID).First(&node).Error; err != nil {
		return MediaContent{}, NotFound()
	}
	var asset p.Asset
	err = db.Where("id = ? AND tenant_id = ? AND workspace_id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM asset_references WHERE asset_id = assets.id AND owner_type = 'CANVAS_NODE_ASSET' AND owner_key = ? AND deleted_at IS NULL)", node.AssetID, a.TenantID, a.WorkspaceID, board.ProjectID, nodeID).First(&asset).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return MediaContent{}, NotFound()
		}
		return MediaContent{}, err
	}
	body, err := s.Storage.Get(ctx, storage.Scope(a.TenantID, a.WorkspaceID, board.ProjectID), asset.ObjectKey)
	return MediaContent{Body: body, MIME: asset.MimeType}, err
}

func (s *Service) storeMedia(ctx context.Context, a Actor, projectID string, body io.Reader) (key, mime string, kind int16, err error) {
	reader := bufio.NewReader(body)
	prefix, err := reader.Peek(512)
	if err != nil && err != io.EOF {
		return "", "", 0, err
	}
	mime = http.DetectContentType(prefix)
	switch {
	case strings.HasPrefix(mime, "image/"):
		kind = 1
	case strings.HasPrefix(mime, "video/"):
		kind = 2
	case strings.HasPrefix(mime, "audio/"):
		kind = 3
	default:
		return "", "", 0, Invalid("unsupported media content")
	}
	key, err = s.Storage.Put(ctx, storage.Scope(a.TenantID, a.WorkspaceID, projectID), reader)
	return key, mime, kind, err
}
