// Package tracecontext preserves independent system correlation at logging boundaries.
package tracecontext

import (
	"context"
	"errors"

	"go.opentelemetry.io/otel/trace"
)

type contextError struct {
	systemContext trace.SpanContext
	err           error
}

func (err *contextError) Error() string { return err.err.Error() }
func (err *contextError) Unwrap() error { return err.err }

// WrapError preserves only the in-memory correlation context required by the
// immediate logging boundary. It never persists IDs or changes the cause.
func WrapError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	value := trace.SpanContextFromContext(ctx)
	if !value.IsValid() {
		return err
	}
	return &contextError{systemContext: value, err: err}
}

// ErrorContext overlays the first system context attached to err onto parent.
// Business OTel context, metadata, deadlines and cancellation remain caller-owned.
func ErrorContext(parent context.Context, err error) (context.Context, bool) {
	var correlated *contextError
	if !errors.As(err, &correlated) || !correlated.systemContext.IsValid() {
		return nil, false
	}
	return trace.ContextWithSpanContext(parent, correlated.systemContext), true
}
