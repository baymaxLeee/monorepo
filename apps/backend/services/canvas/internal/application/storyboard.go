package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"unicode/utf8"
)

func storyboardDTO(row p.StoryboardDraft) (c.StoryboardDraft, error) {
	var input c.StoryboardDraftInput
	shots := []c.StoryboardShot{}
	if err := json.Unmarshal([]byte(row.Input), &input); err != nil {
		return c.StoryboardDraft{}, err
	}
	if err := json.Unmarshal([]byte(row.Shots), &shots); err != nil {
		return c.StoryboardDraft{}, err
	}
	return c.StoryboardDraft{ID: row.ID, Revision: row.Revision, Input: input, CancelRequested: row.CancelRequested, Plot: input.Plot, VideoConfig: input.VideoConfig, Status: row.Status, Error: row.Error, Shots: shots, CreatedAt: isoTime(row.CreatedAt)}, nil
}
func (s *Service) StartStoryboard(ctx context.Context, actor Actor, canvasID string, in c.StoryboardDraftInput) (c.StoryboardDraft, error) {
	if len(in.OperationID) < 1 || len(in.OperationID) > 160 || !utf8.ValidString(in.Plot) || strings.TrimSpace(in.Plot) == "" || utf8.RuneCountInString(in.Plot) > 30000 || in.ProviderID == "" || in.VideoConfig.ProviderID == "" || in.DurationMin < 4 || in.DurationMax < in.DurationMin || in.DurationMax > 30 || in.TotalDurationMin < 60 || in.TotalDurationMax < in.TotalDurationMin || in.TotalDurationMax > 3000 {
		return c.StoryboardDraft{}, Invalid("剧本、推理模型、视频模型和有效时长范围为必填项")
	}
	in.Parameters = nil
	raw, err := json.Marshal(in)
	if err != nil {
		return c.StoryboardDraft{}, err
	}
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	row := p.StoryboardDraft{ID: newID(), Revision: 1, CanvasID: canvasID, TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, UserID: actor.UserID, OperationID: in.OperationID, RequestHash: hash, Input: string(raw), Shots: "[]", Status: "queued"}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, actor, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		var previous p.StoryboardDraft
		err = tx.Where("canvas_id = ? AND user_id = ? AND operation_id = ?", canvasID, actor.UserID, in.OperationID).First(&previous).Error
		if err == nil {
			if previous.RequestHash != hash {
				return Invalid("operation id was used with different input")
			}
			row = previous
			return nil
		}
		if err != gorm.ErrRecordNotFound {
			return err
		}
		catalog, err := s.CreativeProviders(ctx, actor, board.ProjectID)
		if err != nil {
			return err
		}
		inferenceAllowed, videoAllowed := false, false
		var inferenceModel c.ProjectProvider
		for _, model := range catalog.Items {
			inferenceAllowed = inferenceAllowed || (model.ID == in.ProviderID && model.ProviderKind == "chat")
			if model.ID == in.ProviderID {
				inferenceModel = model
			}
			videoAllowed = videoAllowed || (model.ID == in.VideoConfig.ProviderID && model.ProviderKind == "video")
		}
		if !inferenceAllowed || !videoAllowed {
			return &Error{Status: 403, Code: "model_not_granted", Message: "请选择项目已授权的分镜模型与视频模型"}
		}
		parameters, err := s.ResolveInferenceParameters(ctx, actor, in.ProviderID)
		if err != nil {
			return err
		}
		in.Parameters = parameters
		frozen, err := json.Marshal(in)
		if err != nil {
			return err
		}
		row.Input = string(frozen)
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return tx.Create(&p.GenerationUsageMetadata{GenerationID: row.ID, TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, ProjectID: board.ProjectID, ModelName: inferenceModel.Name, ModelID: inferenceModel.Model}).Error
	})
	if err != nil {
		return c.StoryboardDraft{}, err
	}
	return storyboardDTO(row)
}
func (s *Service) ListStoryboards(ctx context.Context, actor Actor, canvasID string) (c.StoryboardDraftList, error) {
	db := s.DB.WithContext(ctx)
	if _, err := boardAccess(db, actor, canvasID, false); err != nil {
		return c.StoryboardDraftList{}, err
	}
	var rows []p.StoryboardDraft
	err := db.Where("canvas_id = ? AND tenant_id = ? AND workspace_id = ? AND user_id = ? AND status NOT IN ?", canvasID, actor.TenantID, actor.WorkspaceID, actor.UserID, []string{"confirmed", "discarded"}).Order("created_at DESC").Find(&rows).Error
	result := c.StoryboardDraftList{Items: []c.StoryboardDraft{}}
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		item, e := storyboardDTO(row)
		if e != nil {
			return result, e
		}
		result.Items = append(result.Items, item)
	}
	return result, nil
}
func storyboardAccess(tx *gorm.DB, actor Actor, canvasID, id string) (p.StoryboardDraft, error) {
	var row p.StoryboardDraft
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND canvas_id = ? AND tenant_id = ? AND workspace_id = ? AND user_id = ?", id, canvasID, actor.TenantID, actor.WorkspaceID, actor.UserID).First(&row).Error
	if err == gorm.ErrRecordNotFound {
		return row, NotFound()
	}
	return row, err
}
func (s *Service) CancelStoryboard(ctx context.Context, actor Actor, canvasID, id string) (c.StoryboardDraft, error) {
	var row p.StoryboardDraft
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := boardAccess(tx, actor, canvasID, true); err != nil {
			return err
		}
		var err error
		row, err = storyboardAccess(tx, actor, canvasID, id)
		if err != nil {
			return err
		}
		if row.Status == "confirmed" {
			return Conflict()
		}
		row.CancelRequested = true
		row.Revision++
		if row.Status != "queued" && row.Status != "running" {
			row.Status = "discarded"
		}
		return tx.Save(&row).Error
	})
	if err != nil {
		return c.StoryboardDraft{}, err
	}
	if row.TaskID != "" && (row.Status == "queued" || row.Status == "running") {
		if _, err = s.Executor.Cancel(ctx, row.TaskID, row.ID); err != nil {
			return c.StoryboardDraft{}, err
		}
	}
	return storyboardDTO(row)
}
func (s *Service) ConfirmStoryboard(ctx context.Context, actor Actor, canvasID, id string, in c.StoryboardConfirm) (c.Graph, error) {
	var result c.Graph
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		board, err := boardAccess(tx, actor, canvasID, true)
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "id = ?", canvasID).Error; err != nil {
			return err
		}
		row, err := storyboardAccess(tx, actor, canvasID, id)
		if err != nil {
			return err
		}
		if row.Status == "confirmed" {
			result, err = readGraph(tx, board)
			return err
		}
		if row.Status != "completed" || row.CancelRequested || board.Revision != in.ExpectedRevision {
			return Conflict()
		}
		draft, err := storyboardDTO(row)
		if err != nil {
			return err
		}
		if !validStoryboardShots(in.Shots) || len(in.Shots) != len(draft.Shots) || in.VideoConfig.ProviderID == "" {
			return Invalid("请确认全部候选分镜及视频模型")
		}
		allowed := map[string]bool{}
		for _, shot := range draft.Shots {
			allowed[shot.ID] = true
		}
		graph, err := readGraph(tx, board)
		if err != nil {
			return err
		}
		rank := int64(0)
		for _, node := range graph.Nodes {
			if node.StoryboardRank > rank {
				rank = node.StoryboardRank
			}
		}
		nodes := make([]c.Node, 0, len(in.Shots))
		for index, shot := range in.Shots {
			if !allowed[shot.ID] || strings.TrimSpace(shot.Prompt) == "" || shot.DurationSeconds < 1 || shot.DurationSeconds > 300 {
				return Invalid("候选分镜无效或重复")
			}
			delete(allowed, shot.ID)
			config := in.VideoConfig
			config.DurationSeconds = shot.DurationSeconds
			node := c.Node{ID: newID(), Type: 6, Name: "视频生成", Prompt: shot.Prompt, VideoInputMode: 1, GenerationConfig: config, StoryboardRank: rank + int64(index) + 1, X: float64(index%4) * 360, Y: float64(index/4) * 300, IncomingEdges: []c.Edge{}}
			if err = validNode(node); err != nil {
				return err
			}
			nodes = append(nodes, node)
		}
		nested := *s
		nested.DB = tx
		result, err = nested.Mutate(ctx, actor, canvasID, c.Mutation{OperationID: "storyboard:" + id, ExpectedRevision: board.Revision, Upsert: nodes, DeleteIDs: []string{}})
		if err != nil {
			return err
		}
		row.Status = "confirmed"
		row.Revision++
		return tx.Save(&row).Error
	})
	return result, err
}
