package transaction

import "context"

type hooksKey struct{}
type hooks struct {
	order     []string
	callbacks map[string]func(context.Context) error
}

// BeforeCommit coalesces an outbox producer per business scope within the outer
// transaction. Nested savepoints merge into that same atomic publication unit.
func BeforeCommit(ctx context.Context, key string, fn func(context.Context) error) bool {
	h, ok := ctx.Value(hooksKey{}).(*hooks)
	if !ok {
		return false
	}
	if _, exists := h.callbacks[key]; !exists {
		h.order = append(h.order, key)
	}
	h.callbacks[key] = fn
	return true
}
