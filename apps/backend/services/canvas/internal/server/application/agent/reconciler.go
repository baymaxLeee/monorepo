package agent

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
)

var ErrSkillsUnavailable = errors.New("agent skills are unavailable")

type SkillSnapshot struct {
	mu        sync.RWMutex
	ready     bool
	skills    []SyncedSkill
	lastError error
}

func NewSkillSnapshot() *SkillSnapshot { return &SkillSnapshot{} }

func (s *SkillSnapshot) Ready(skills []SyncedSkill) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ready = true
	s.lastError = nil
	s.skills = sortedSkills(skills)
}

func (s *SkillSnapshot) Failed(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ready = false
	s.lastError = err
}

func (s *SkillSnapshot) VersionIDs() ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.ready {
		if s.lastError != nil {
			return nil, fmt.Errorf("%w: %v", ErrSkillsUnavailable, s.lastError)
		}
		return nil, ErrSkillsUnavailable
	}
	versions := make([]string, 0, len(s.skills))
	for _, skill := range s.skills {
		versions = append(versions, skill.VersionID)
	}
	sort.Strings(versions)
	return versions, nil
}

type Reconciler struct {
	root      string
	store     Store
	publisher SkillPublisher
	snapshot  *SkillSnapshot
}

func NewReconciler(root string, store Store, publisher SkillPublisher, snapshot *SkillSnapshot) *Reconciler {
	return &Reconciler{root: root, store: store, publisher: publisher, snapshot: snapshot}
}

func (r *Reconciler) Sync(ctx context.Context) error {
	localSkills, err := DiscoverSkills(r.root)
	if err != nil {
		r.snapshot.Failed(err)
		return err
	}
	storedSkills, err := r.store.ListSkills(ctx)
	if err != nil {
		r.snapshot.Failed(err)
		return fmt.Errorf("load synchronized Agent skills: %w", err)
	}
	storedByKey := make(map[string]SyncedSkill, len(storedSkills))
	for _, stored := range storedSkills {
		storedByKey[stored.Key] = stored
	}
	desired := make([]SyncedSkill, 0, len(localSkills))
	for _, local := range localSkills {
		stored, unchanged := storedByKey[local.Key]
		unchanged = unchanged && stored.ContentHash == local.Hash && stored.AssetID != "" && stored.VersionID != ""
		if unchanged {
			desired = append(desired, stored)
			continue
		}
		published, publishErr := r.publisher.Publish(ctx, local)
		if publishErr != nil {
			err = fmt.Errorf("publish Agent skill %q: %w", local.Key, publishErr)
			r.snapshot.Failed(err)
			return err
		}
		if published.Key != local.Key || published.ContentHash != local.Hash || published.AssetID == "" || published.VersionID == "" {
			err = fmt.Errorf("publish Agent skill %q returned invalid identity", local.Key)
			r.snapshot.Failed(err)
			return err
		}
		desired = append(desired, published)
	}
	desired = sortedSkills(desired)
	if err := r.store.ReplaceSkills(ctx, desired); err != nil {
		r.snapshot.Failed(err)
		return fmt.Errorf("replace synchronized Agent skill snapshot: %w", err)
	}
	r.snapshot.Ready(desired)
	return nil
}

func sortedSkills(skills []SyncedSkill) []SyncedSkill {
	result := append([]SyncedSkill(nil), skills...)
	sort.Slice(result, func(i, j int) bool { return result[i].Key < result[j].Key })
	return result
}
