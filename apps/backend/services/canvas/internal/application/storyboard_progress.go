package application

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) GetStoryboard(ctx context.Context, actor Actor, canvasID, id string) (c.StoryboardDraft, error) {
	db := s.DB.WithContext(ctx)
	if _, err := boardAccess(db, actor, canvasID, false); err != nil {
		return c.StoryboardDraft{}, err
	}
	row, err := storyboardAccess(db, actor, canvasID, id)
	if err != nil {
		return c.StoryboardDraft{}, err
	}
	return storyboardDTO(row)
}

func validStoryboardShots(shots []c.StoryboardShot) bool {
	if len(shots) == 0 {
		return false
	}
	seen := make(map[string]bool, len(shots))
	for _, shot := range shots {
		if shot.ID == "" || seen[shot.ID] || !utf8.ValidString(shot.Prompt) || strings.TrimSpace(shot.Prompt) == "" || utf8.RuneCountInString(shot.Prompt) > 30000 || shot.DurationSeconds < 4 || shot.DurationSeconds > 30 {
			return false
		}
		seen[shot.ID] = true
	}
	return true
}

func (s *Service) UpdateStoryboard(ctx context.Context, actor Actor, canvasID, id string, input c.StoryboardDraftUpdate) (c.StoryboardDraft, error) {
	if !validStoryboardShots(input.Shots) || input.VideoConfig.ProviderID == "" {
		return c.StoryboardDraft{}, Invalid("请填写有效的候选分镜和视频模型")
	}
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
		if row.Status != "completed" || row.CancelRequested || row.Revision != input.ExpectedRevision {
			return Conflict()
		}
		current, err := storyboardDTO(row)
		if err != nil {
			return err
		}
		allowed := make(map[string]bool, len(current.Shots))
		for _, shot := range current.Shots {
			allowed[shot.ID] = true
		}
		if len(input.Shots) != len(current.Shots) {
			return Invalid("请保留完整候选分镜")
		}
		for _, shot := range input.Shots {
			if !allowed[shot.ID] {
				return Invalid("候选分镜身份不匹配")
			}
		}
		current.Input.VideoConfig = input.VideoConfig
		raw, err := json.Marshal(current.Input)
		if err != nil {
			return err
		}
		shots, err := json.Marshal(input.Shots)
		if err != nil {
			return err
		}
		row.Input, row.Shots, row.Revision = string(raw), string(shots), row.Revision+1
		return tx.Save(&row).Error
	})
	if err != nil {
		return c.StoryboardDraft{}, err
	}
	return storyboardDTO(row)
}

func normalizeStoryboardShot(draftID string, shot c.StoryboardShot) (c.StoryboardShot, error) {
	if shot.SequenceNo < 1 {
		number, err := strconv.Atoi(shot.ID)
		if err != nil || number < 1 {
			return shot, Invalid("invalid storyboard sequence")
		}
		shot.SequenceNo = int32(number)
	}
	shot.ID = strings.ReplaceAll(uuid.NewSHA1(uuid.NameSpaceOID, []byte(draftID+":"+strconv.Itoa(int(shot.SequenceNo)))).String(), "-", "")
	if !validStoryboardShots([]c.StoryboardShot{shot}) {
		return shot, Invalid("invalid storyboard candidate")
	}
	return shot, nil
}

func (s *Service) CommitStoryboardProgress(ctx context.Context, id string, input c.StoryboardProgress) (c.StoryboardDraft, error) {
	var row p.StoryboardDraft
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&row, "id = ?", id).Error; err != nil {
			return NotFound()
		}
		live, err := lockStoryboardParent(tx, row)
		if err != nil {
			return err
		}
		if !live {
			return NotFound()
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return NotFound()
			}
			return err
		}
		if row.CancelRequested || (row.Status != "running" && row.Status != "queued") {
			return Conflict()
		}
		actor := Actor{TenantID: row.TenantID, WorkspaceID: row.WorkspaceID, UserID: row.UserID}
		if _, err := boardAccess(tx, actor, row.CanvasID, true); err != nil {
			return err
		}
		current, err := storyboardDTO(row)
		if err != nil {
			return err
		}
		byNumber := make(map[int32]c.StoryboardShot, len(current.Shots))
		for _, shot := range current.Shots {
			byNumber[shot.SequenceNo] = shot
		}
		for _, candidate := range input.Shots {
			shot, err := normalizeStoryboardShot(id, candidate)
			if err != nil {
				return err
			}
			if previous, exists := byNumber[shot.SequenceNo]; exists {
				if previous.Prompt != shot.Prompt || previous.DurationSeconds != shot.DurationSeconds {
					return Conflict()
				}
				continue
			}
			byNumber[shot.SequenceNo] = shot
		}
		shots := make([]c.StoryboardShot, 0, len(byNumber))
		for _, shot := range byNumber {
			shots = append(shots, shot)
		}
		sort.Slice(shots, func(i, j int) bool { return shots[i].SequenceNo < shots[j].SequenceNo })
		raw, err := json.Marshal(shots)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(current.Shots, shots) || row.Status != "running" {
			row.Shots, row.Status, row.Revision = string(raw), "running", row.Revision+1
			return tx.Save(&row).Error
		}
		return nil
	})
	if err != nil {
		return c.StoryboardDraft{}, err
	}
	return storyboardDTO(row)
}

type StoryboardStream struct {
	Observe func(context.Context, func(c.StoryboardDraft) error) error
}

func (s *Service) StreamStoryboard(ctx context.Context, actor Actor, canvasID, id string) (StoryboardStream, error) {
	if _, err := s.GetStoryboard(ctx, actor, canvasID, id); err != nil {
		return StoryboardStream{}, err
	}
	return StoryboardStream{Observe: func(ctx context.Context, emit func(c.StoryboardDraft) error) error {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		previous := ""
		for {
			current, err := s.GetStoryboard(ctx, actor, canvasID, id)
			if err != nil {
				return err
			}
			encoded, err := json.Marshal(current)
			if err != nil {
				return err
			}
			if string(encoded) != previous {
				if err := emit(current); err != nil {
					return err
				}
				previous = string(encoded)
			}
			if current.Status != "queued" && current.Status != "running" {
				return nil
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-ticker.C:
			}
		}
	}}, nil
}
