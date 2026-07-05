package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
)

// AuditMeta carries the request-scoped attribution for a high-value mutation:
// who did it (actor) and the correlation id the gateway stamped on the request.
type AuditMeta struct {
	ActorUserID string
	TraceID     string
}

// AuditMetaFromHTTP reads the actor from the verified access token and the
// trace id from the gateway-propagated header (see gateway trace_id middleware).
func AuditMetaFromHTTP(r *http.Request, actorUserID string) AuditMeta {
	return AuditMeta{
		ActorUserID: actorUserID,
		TraceID:     strings.TrimSpace(r.Header.Get("X-Trace-Id")),
	}
}

// auditEntry is the service-facing shape; recordAudit maps it onto the model
// row (nullable columns become NULL when empty).
type auditEntry struct {
	Action string
	Actor  string
	Target string
	Org    string
	Before any
	After  any
	Result string // "ok" | "error"
	Reason string
	Trace  string
}

const (
	auditOK    = "ok"
	auditError = "error"
)

func auditEvent(e auditEntry) model.IamAuditEvent {
	result := e.Result
	if result == "" {
		result = auditOK
	}
	return model.IamAuditEvent{
		ID:           NewID(),
		Action:       e.Action,
		ActorUserID:  strPtr(e.Actor),
		TargetUserID: strPtr(e.Target),
		OrgID:        strPtr(e.Org),
		BeforeJSON:   jsonPtr(e.Before),
		AfterJSON:    jsonPtr(e.After),
		Result:       result,
		Reason:       strPtr(e.Reason),
		TraceID:      strPtr(e.Trace),
		CreatedAt:    time.Now().UTC(),
	}
}

func recordAudit(ctx context.Context, store *crud.Store, e auditEntry) {
	if err := store.RecordAudit(ctx, auditEvent(e)); err != nil {
		slog.ErrorContext(ctx, "iam audit write failed",
			"action", e.Action,
			"actor", e.Actor,
			"target", e.Target,
			"org", e.Org,
			"trace_id", e.Trace,
			"error", err,
		)
	}
}

func mutateWithAudit(ctx context.Context, store *crud.Store, e auditEntry, mutate func(*crud.Store) error) error {
	err := store.Transaction(ctx, func(txStore *crud.Store) error {
		if err := mutate(txStore); err != nil {
			return err
		}
		e.Result = auditOK
		return txStore.RecordAudit(ctx, auditEvent(e))
	})
	if err != nil {
		e.Result = auditError
		e.Reason = err.Error()
		failureCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		recordAudit(failureCtx, store, e)
	}
	return err
}

func strPtr(v string) *string {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return &v
}

func jsonPtr(v any) *string {
	if v == nil {
		return nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(raw)
	return &s
}
