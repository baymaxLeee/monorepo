package canvastextgenerationredis

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	app "github.com/example/monorepo/canvas/internal/application/canvastextgeneration"
)

const (
	keyPrefix  = "agentframe:canvas-text-generation:"
	deltaField = "delta"
)

type Store struct{ client redis.UniversalClient }

func New(client redis.UniversalClient) *Store { return &Store{client: client} }
func (s *Store) Create(ctx context.Context, scope applicationcanvas.Scope, state app.Session) (bool, error) {
	payload, e := json.Marshal(state)
	if e != nil {
		return false, e
	}
	return s.client.SetNX(ctx, stateKey(scope, state.ProjectID, state.CanvasID, state.NodeID, state.ID), payload, 0).Result()
}
func (s *Store) Get(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID string) (app.Session, error) {
	payload, e := s.client.Get(ctx, stateKey(scope, projectID, canvasID, nodeID, runID)).Bytes()
	if errors.Is(e, redis.Nil) {
		return app.Session{}, app.ErrNotFound
	}
	if e != nil {
		return app.Session{}, e
	}
	var state app.Session
	if e = json.Unmarshal(payload, &state); e != nil {
		return app.Session{}, e
	}
	return state, nil
}
func (s *Store) Append(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID, delta string) error {
	state := stateKey(scope, projectID, canvasID, nodeID, runID)
	events := eventKey(scope, projectID, canvasID, nodeID, runID)
	for i := 0; i < 8; i++ {
		e := s.client.Watch(ctx, func(tx *redis.Tx) error {
			payload, e := tx.Get(ctx, state).Bytes()
			if errors.Is(e, redis.Nil) {
				return app.ErrNotFound
			}
			if e != nil {
				return e
			}
			var current app.Session
			if e = json.Unmarshal(payload, &current); e != nil {
				return e
			}
			current.Content += delta
			next, e := json.Marshal(current)
			if e != nil {
				return e
			}
			_, e = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, state, next, 0)
				pipe.XAdd(ctx, &redis.XAddArgs{Stream: events, Values: map[string]any{deltaField: delta}})
				return nil
			})
			return e
		}, state)
		if !errors.Is(e, redis.TxFailedErr) {
			return e
		}
	}
	return redis.TxFailedErr
}

func (s *Store) ReadDeltas(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID, cursor string, block time.Duration) ([]app.Delta, error) {
	streams, err := s.client.XRead(ctx, &redis.XReadArgs{
		Streams: []string{eventKey(scope, projectID, canvasID, nodeID, runID), cursor},
		Count:   128,
		Block:   block,
	}).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	result := make([]app.Delta, 0)
	for _, stream := range streams {
		for _, message := range stream.Messages {
			text, ok := message.Values[deltaField].(string)
			if !ok {
				return nil, errors.New("canvas text generation delta is invalid")
			}
			result = append(result, app.Delta{Cursor: message.ID, Text: text})
		}
	}
	return result, nil
}

func (s *Store) Retire(ctx context.Context, scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID string, retention time.Duration) error {
	_, err := s.client.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.Expire(ctx, stateKey(scope, projectID, canvasID, nodeID, runID), retention)
		pipe.Expire(ctx, eventKey(scope, projectID, canvasID, nodeID, runID), retention)
		return nil
	})
	return err
}

func stateKey(scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID string) string {
	return baseKey(scope, projectID, canvasID, nodeID, runID) + ":state"
}

func eventKey(scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID string) string {
	return baseKey(scope, projectID, canvasID, nodeID, runID) + ":events"
}

func baseKey(scope applicationcanvas.Scope, projectID, canvasID, nodeID, runID string) string {
	workspace := "<personal>"
	if scope.WorkspaceID != nil {
		workspace = *scope.WorkspaceID
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{scope.TenantID, workspace, scope.CallerID, projectID, canvasID, nodeID, runID}, "\x00")))
	return keyPrefix + hex.EncodeToString(sum[:])
}
