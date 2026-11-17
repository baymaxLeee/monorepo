package httpapi

import (
	"sync"
)

type readiness struct {
	mu    sync.RWMutex
	state string
	err   string
}

func newReadiness() *readiness { return &readiness{state: "pending"} }

func (value *readiness) ready() {
	value.mu.Lock()
	defer value.mu.Unlock()
	value.state = "ready"
	value.err = ""
}

func (value *readiness) failed(err error) {
	value.mu.Lock()
	defer value.mu.Unlock()
	value.state = "failed"
	value.err = err.Error()
}

func (value *readiness) current() (string, string) {
	value.mu.RLock()
	defer value.mu.RUnlock()
	return value.state, value.err
}
