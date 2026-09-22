package agent

import (
	"context"
	"fmt"
)

type PresetSynchronizer struct {
	publisher SkillPublisher
	store     PresetSkillStore
}

func NewPresetSynchronizer(publisher SkillPublisher, store PresetSkillStore) *PresetSynchronizer {
	return &PresetSynchronizer{publisher: publisher, store: store}
}

func (s *PresetSynchronizer) Sync(ctx context.Context, skills []LocalSkill) error {
	if err := s.publisher.Check(ctx); err != nil {
		return fmt.Errorf("check Asset Center skill operations: %w", err)
	}
	for _, item := range skills {
		published, err := s.publisher.Publish(ctx, item)
		if err != nil {
			return fmt.Errorf("publish preset skill %q: %w", item.Key, err)
		}
		if err := s.store.UpsertPresetSkill(ctx, PresetSkill{
			Key: item.Key, AssetCenterSkillID: published.AssetID, Name: item.Name,
			DefaultBound: item.DefaultBound, State: item.State,
		}); err != nil {
			return fmt.Errorf("save preset skill %q: %w", item.Key, err)
		}
	}
	return nil
}
