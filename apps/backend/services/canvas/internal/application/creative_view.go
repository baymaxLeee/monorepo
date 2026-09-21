package application

import (
	"context"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
)

func (s *Service) GetCanvasView(ctx context.Context, a Actor, id string) (c.CanvasView, error) {
	db := s.DB.WithContext(ctx)
	if _, e := boardAccess(db, a, id, false); e != nil {
		return c.CanvasView{}, e
	}
	var v p.CanvasView
	e := db.Where("canvas_id = ? AND user_id = ?", id, a.UserID).First(&v).Error
	if e == gorm.ErrRecordNotFound {
		return c.CanvasView{Zoom: 1}, nil
	}
	return c.CanvasView{X: v.X, Y: v.Y, Zoom: v.Zoom}, e
}
func (s *Service) SaveCanvasView(ctx context.Context, a Actor, id string, in c.CanvasView) (c.CanvasView, error) {
	if math.IsNaN(in.X) || math.IsInf(in.X, 0) || math.IsNaN(in.Y) || math.IsInf(in.Y, 0) || math.IsNaN(in.Zoom) || math.IsInf(in.Zoom, 0) || in.Zoom <= 0 {
		return in, Invalid("invalid viewport")
	}
	db := s.DB.WithContext(ctx)
	if _, e := boardAccess(db, a, id, false); e != nil {
		return in, e
	}
	v := p.CanvasView{CanvasID: id, UserID: a.UserID, X: in.X, Y: in.Y, Zoom: in.Zoom}
	return in, db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "canvas_id"}, {Name: "user_id"}}, DoUpdates: clause.AssignmentColumns([]string{"x", "y", "zoom", "updated_at"})}).Create(&v).Error
}
