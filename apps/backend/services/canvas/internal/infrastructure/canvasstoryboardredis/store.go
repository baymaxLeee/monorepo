package canvasstoryboardredis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/redis/go-redis/v9"

	applicationcanvasnode "github.com/example/monorepo/canvas/internal/application/canvas"
)

const keyPrefix = "canvas:storyboard-draft:v2:"

type Store struct {
	client redis.UniversalClient
}

func New(client redis.UniversalClient) *Store {
	return &Store{client: client}
}

func (s *Store) Create(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID, taskRunID string,
	state applicationcanvasnode.StoryboardSession,
) (bool, error) {
	payload, err := json.Marshal(state)
	if err != nil {
		return false, err
	}
	return s.client.SetNX(ctx, sessionKey(scope, projectID, canvasID, taskRunID), payload, 0).Result()
}

func (s *Store) Get(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID, taskRunID string,
) (applicationcanvasnode.StoryboardSession, error) {
	payload, err := s.client.Get(ctx, sessionKey(scope, projectID, canvasID, taskRunID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return applicationcanvasnode.StoryboardSession{}, applicationcanvasnode.ErrStoryboardNotFound
	}
	if err != nil {
		return applicationcanvasnode.StoryboardSession{}, err
	}
	var state applicationcanvasnode.StoryboardSession
	if err := json.Unmarshal(payload, &state); err != nil {
		return applicationcanvasnode.StoryboardSession{}, err
	}
	return state, nil
}

func (s *Store) Append(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID, sessionID string,
	draft applicationcanvasnode.Draft,
) error {
	return s.mutate(ctx, scope, projectID, canvasID, sessionID, func(state *applicationcanvasnode.StoryboardSession) error {
		if state.Status != applicationcanvasnode.StoryboardStatusRunning {
			return applicationcanvasnode.ErrStoryboardNotFound
		}
		for index := range state.Drafts {
			if state.Drafts[index].CanvasNodeNo == draft.CanvasNodeNo {
				if state.Drafts[index].ID == draft.ID {
					state.Drafts[index] = draft
				}
				return nil
			}
		}
		state.Drafts = append(state.Drafts, draft)
		sort.Slice(state.Drafts, func(left, right int) bool {
			return state.Drafts[left].CanvasNodeNo < state.Drafts[right].CanvasNodeNo
		})
		return nil
	})
}

func (s *Store) Delete(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID, taskRunID string,
) error {
	return s.client.Del(ctx, sessionKey(scope, projectID, canvasID, taskRunID)).Err()
}

func (s *Store) mutate(
	ctx context.Context,
	scope applicationcanvasnode.Scope,
	projectID, canvasID, sessionID string,
	update func(*applicationcanvasnode.StoryboardSession) error,
) error {
	key := sessionKey(scope, projectID, canvasID, sessionID)
	for attempts := 0; attempts < 8; attempts++ {
		err := s.client.Watch(ctx, func(tx *redis.Tx) error {
			payload, err := tx.Get(ctx, key).Bytes()
			if errors.Is(err, redis.Nil) {
				return applicationcanvasnode.ErrStoryboardNotFound
			}
			if err != nil {
				return err
			}
			var state applicationcanvasnode.StoryboardSession
			if err := json.Unmarshal(payload, &state); err != nil {
				return err
			}
			if state.ID != sessionID {
				return applicationcanvasnode.ErrStoryboardNotFound
			}
			if err := update(&state); err != nil {
				return err
			}
			updated, err := json.Marshal(state)
			if err != nil {
				return err
			}
			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, key, updated, 0)
				return nil
			})
			return err
		}, key)
		if !errors.Is(err, redis.TxFailedErr) {
			return err
		}
	}
	return redis.TxFailedErr
}

func sessionKey(scope applicationcanvasnode.Scope, projectID, canvasID, taskRunID string) string {
	workspace := "<personal>"
	if scope.WorkspaceID != nil {
		workspace = *scope.WorkspaceID
	}
	// Hashing prevents caller-controlled identifiers from changing the Redis
	// key shape while keeping the full tenant/workspace/user ownership tuple.
	parts := []string{scope.TenantID, workspace, scope.CallerID, projectID, canvasID, taskRunID}
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return keyPrefix + hex.EncodeToString(digest[:])
}
