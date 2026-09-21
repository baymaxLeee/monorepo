package application

import (
	"context"
	"strings"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	inputs "github.com/example/monorepo/canvas/internal/application/generationinput"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	inputdomain "github.com/example/monorepo/canvas/internal/domain/generationinput"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func generationDTO(v p.Generation) c.Generation {
	return c.Generation{ID: v.ID, NodeID: v.NodeID, Status: v.Status, OutputText: v.OutputText, Error: v.Error, Applied: v.Applied, CancelRequested: v.CancelRequested, CreatedAt: isoTime(v.CreatedAt)}
}
func (s *Service) StartGeneration(ctx context.Context, a Actor, canvasID, nodeID string, in c.StartGeneration) (c.Generation, error) {
	var out p.Generation
	if in.OperationID == "" || len(in.OperationID) > 160 {
		return c.Generation{}, Invalid("operation id is required")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, a, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		err = tx.Where("canvas_id = ? AND user_id = ? AND operation_id = ?", canvasID, a.UserID, in.OperationID).First(&out).Error
		if err == nil {
			if out.NodeID != nodeID || out.NodeRevision != in.ExpectedRevision {
				return Invalid("operation id already used")
			}
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		graph, err := readGraph(tx, board)
		if err != nil {
			return err
		}
		var node c.Node
		for _, v := range graph.Nodes {
			if v.ID == nodeID {
				node = v
			}
		}
		if node.ID == "" {
			return NotFound()
		}
		if node.Revision != in.ExpectedRevision {
			return Conflict()
		}
		if node.Type != 7 {
			return Invalid("this generation endpoint requires a text generation node")
		}
		if node.GenerationConfig.ProviderID == "" || strings.TrimSpace(node.Prompt) == "" {
			return Invalid("select a provider and enter a prompt")
		}
		var active int64
		if err = tx.Model(&p.Generation{}).Where("node_id = ? AND status IN ?", nodeID, []string{"queued", "running"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return Conflict()
		}
		nodes := make([]domain.CanvasNode, 0, len(graph.Nodes))
		var target domain.CanvasNode
		for _, n := range graph.Nodes {
			v := domain.CanvasNode{ID: n.ID, Name: n.Name, Type: domain.NodeType(n.Type), Revision: n.Revision, Text: n.Text, SelectedOutputText: n.Text, Prompt: n.Prompt}
			for _, e := range n.IncomingEdges {
				v.IncomingEdges = append(v.IncomingEdges, domain.IncomingEdge{ID: e.ID, SourceNodeID: e.SourceNodeID, SourcePort: domain.Port(e.SourcePort), TargetPort: domain.Port(e.TargetPort), TargetOrder: e.TargetOrder})
			}
			nodes = append(nodes, v)
			if n.ID == nodeID {
				target = v
			}
		}
		resolved, err := inputs.New(nil).ResolveMentions(ctx, inputs.Scope{TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, UserID: a.UserID}, board.ProjectID, target, nodes, inputs.Modalities(inputdomain.ModalityText))
		if err != nil {
			return Invalid(err.Error())
		}
		prompt := resolved.Prompt
		out = p.Generation{ID: newID(), CanvasID: canvasID, NodeID: nodeID, TenantID: a.TenantID, WorkspaceID: a.WorkspaceID, UserID: a.UserID, OperationID: in.OperationID, NodeRevision: node.Revision, ProviderID: node.GenerationConfig.ProviderID, Prompt: prompt, Status: "queued"}
		return tx.Create(&out).Error
	})
	return generationDTO(out), err
}

func (s *Service) ListGenerations(ctx context.Context, a Actor, canvasID, nodeID string) (c.GenerationList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := boardAccess(db, a, canvasID, false); err != nil {
		return c.GenerationList{}, err
	}
	var rows []p.Generation
	if err := db.Where("canvas_id = ? AND node_id = ?", canvasID, nodeID).Order("created_at DESC,id").Find(&rows).Error; err != nil {
		return c.GenerationList{}, err
	}
	out := c.GenerationList{Items: []c.Generation{}}
	for _, v := range rows {
		out.Items = append(out.Items, generationDTO(v))
	}
	return out, nil
}
func (s *Service) CancelGeneration(ctx context.Context, a Actor, canvasID, id string) (c.Generation, error) {
	var row p.Generation
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := boardAccess(tx, a, canvasID, true); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND canvas_id = ?", id, canvasID).First(&row).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return NotFound()
			}
			return err
		}
		if row.Status != "queued" && row.Status != "running" {
			return nil
		}
		row.CancelRequested = true
		return tx.Save(&row).Error
	})
	if err == nil && row.CancelRequested && row.TaskID != "" {
		_, err = s.Executor.Cancel(ctx, row.TaskID, row.ID)
	}
	return generationDTO(row), err
}
func (s *Service) ApplyGeneration(ctx context.Context, a Actor, canvasID, id string, in c.ExpectedRevision) (c.Graph, error) {
	var result c.Graph
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, a, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		var row p.Generation
		if err = tx.Where("id = ? AND canvas_id = ? AND status = 'completed'", id, canvasID).First(&row).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return NotFound()
			}
			return err
		}
		var node p.Node
		if err = tx.Where("id = ? AND canvas_id = ?", row.NodeID, canvasID).First(&node).Error; err != nil {
			return NotFound()
		}
		if node.Revision != in.ExpectedRevision {
			return Conflict()
		}
		node.Text = row.OutputText
		node.Revision++
		if err = tx.Save(&node).Error; err != nil {
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
