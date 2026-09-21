package deletion

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

// Jobs retain the targets of effects that cannot commit atomically with MySQL.
// Kind includes a payload version; unknown kinds remain pending for a reader
// that understands them. Completed jobs are retained as deletion audit facts.
type Job struct {
	ID, TenantID, Kind string
	Payload            json.RawMessage
	NextAttemptAt      time.Time
	LeaseUntil         *time.Time
	StateVersion       int64
	Attempts           int32
	CompletedAt        *time.Time
	LastError          string
}

type Store interface {
	Enqueue(context.Context, Job) error
	Claim(context.Context, time.Time, time.Time, int) ([]Job, error)
	Finish(context.Context, Job, time.Time, error) error
}

type Enqueuer interface {
	Enqueue(context.Context, Job) error
}
type Queue struct{ store Enqueuer }

func NewQueue(store Enqueuer) *Queue { return &Queue{store: store} }

func (q *Queue) Enqueue(ctx context.Context, tenantID, kind, key string, payload any) error {
	if q == nil || q.store == nil || tenantID == "" || kind == "" || key == "" {
		return errors.New("invalid deletion job")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.store.Enqueue(ctx, Job{ID: idFor(tenantID, kind, key), TenantID: tenantID, Kind: kind, Payload: data, NextAttemptAt: time.Now().UTC(), StateVersion: 1})
}

func idFor(tenantID, kind, key string) string {
	hash := sha256.Sum256([]byte(tenantID + "\x00" + kind + "\x00" + key))
	return hex.EncodeToString(hash[:])
}

type Handler func(context.Context, json.RawMessage) error

type Processor struct {
	store    Store
	handlers map[string]Handler
}

func NewProcessor(store Store, handlers map[string]Handler) *Processor {
	return &Processor{store: store, handlers: handlers}
}

func (p *Processor) Process(ctx context.Context) error {
	now := time.Now().UTC()
	jobs, err := p.store.Claim(ctx, now, now.Add(2*time.Minute), 1)
	if err != nil {
		return err
	}
	var failures error
	for _, job := range jobs {
		handler := p.handlers[job.Kind]
		workErr := errors.New("unsupported deletion job kind")
		if handler != nil {
			workCtx, cancel := context.WithTimeout(ctx, time.Minute)
			workErr = handler(workCtx, job.Payload)
			cancel()
		}
		finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		finishErr := p.store.Finish(finishCtx, job, time.Now().UTC(), workErr)
		cancel()
		failures = errors.Join(failures, workErr, finishErr)
	}
	return failures
}
