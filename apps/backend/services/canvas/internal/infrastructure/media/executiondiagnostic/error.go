package executiondiagnostic

import "errors"

type stageError struct {
	stage string
	err   error
}

func (e *stageError) Error() string { return e.err.Error() }
func (e *stageError) Unwrap() error { return e.err }

// Wrap attaches a stable execution stage while preserving the original error chain.
func Wrap(stage string, err error) error {
	if err == nil {
		return nil
	}
	return &stageError{stage: stage, err: err}
}

// Stage returns the closest stable execution stage attached to err.
func Stage(err error) string {
	var target *stageError
	if errors.As(err, &target) {
		return target.stage
	}
	return "unknown"
}
