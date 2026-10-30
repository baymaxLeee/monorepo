package canvastextgeneration

import (
	"context"
	"errors"
	"sync"
	"time"
	"unicode/utf8"
)

// A bounded aggregation window persists partial text even when a provider stalls.
// Closing a browser never owns this writer; the task execution owns its lifetime.
type checkpointWriter struct {
	mu      sync.Mutex
	ctx     context.Context
	persist func(context.Context, int64, string) error
	offset  int64
	pending string
	err     error
	stop    chan struct{}
	done    chan struct{}
	once    sync.Once
}

func newCheckpointWriter(ctx context.Context, persist func(context.Context, int64, string) error, offset int64) *checkpointWriter {
	w := &checkpointWriter{ctx: ctx, persist: persist, offset: offset, stop: make(chan struct{}), done: make(chan struct{})}
	go func() {
		defer close(w.done)
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-w.stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.mu.Lock()
				w.flush()
				w.mu.Unlock()
			}
		}
	}()
	return w
}
func (w *checkpointWriter) append(delta string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !utf8.ValidString(delta) {
		return errors.New("invalid UTF-8 text checkpoint")
	}
	if w.err != nil {
		return w.err
	}
	w.pending += delta
	if len(w.pending) >= 1024 {
		w.flush()
	}
	return w.err
}
func (w *checkpointWriter) flush() {
	if w.pending == "" || w.err != nil {
		return
	}
	w.err = w.persist(w.ctx, w.offset, w.pending)
	if w.err == nil {
		w.offset += int64(len(w.pending))
		w.pending = ""
	}
}
func (w *checkpointWriter) close() error {
	w.once.Do(func() { close(w.stop); <-w.done; w.mu.Lock(); defer w.mu.Unlock(); w.flush() })
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.err
}
