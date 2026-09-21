package asyncrunner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	asynccontract "github.com/example/monorepo/canvas/internal/contract/asyncexecution"
	domaintask "github.com/example/monorepo/canvas/internal/server/domain/task"
)

var ErrInvalidPayload = errors.New("invalid async task payload")

type Message struct {
	TaskRunID string `json:"TaskRunID"`
}

type Claim struct {
	TaskRunID         string
	RunType           domaintask.RunType
	ExecutionState    domaintask.AsyncExecutionState
	ExecutionVersion  int64
	ExecutionAttempts int32
	ExecutionToken    string
	Session           *Session
}

type Session struct {
	mu                sync.Mutex
	eventMu           sync.Mutex
	taskRunID         string
	runType           domaintask.RunType
	executionVersion  int64
	executionAttempts int32
	executionToken    string
	payload           json.RawMessage
}

type sessionContextKey struct{}

func NewSession(
	taskRunID string,
	runType domaintask.RunType,
	executionVersion int64,
	executionAttempts int32,
	executionToken string,
	payload json.RawMessage,
) *Session {
	return &Session{
		taskRunID: taskRunID, runType: runType,
		executionVersion: executionVersion, executionAttempts: executionAttempts,
		executionToken: executionToken, payload: append(json.RawMessage(nil), payload...),
	}
}

func WithSession(ctx context.Context, session *Session) context.Context {
	return context.WithValue(ctx, sessionContextKey{}, session)
}

func SessionFromContext(ctx context.Context) (*Session, bool) {
	session, ok := ctx.Value(sessionContextKey{}).(*Session)
	return session, ok && session != nil
}

func (session *Session) Snapshot() Claim {
	session.mu.Lock()
	defer session.mu.Unlock()
	return Claim{
		TaskRunID: session.taskRunID, RunType: session.runType,
		ExecutionVersion: session.executionVersion, ExecutionAttempts: session.executionAttempts,
		ExecutionToken: session.executionToken, Session: session,
	}
}

func (session *Session) UpdateExecutionVersion(version int64) {
	session.mu.Lock()
	defer session.mu.Unlock()
	session.executionVersion = version
}

func (session *Session) Payload() json.RawMessage {
	session.mu.Lock()
	defer session.mu.Unlock()
	return append(json.RawMessage(nil), session.payload...)
}

func (session *Session) SerializeEvent(run func(Claim) error) error {
	session.eventMu.Lock()
	defer session.eventMu.Unlock()
	return run(session.Snapshot())
}

type Control interface {
	Claim(context.Context, string, domaintask.RunType) (Claim, bool, error)
	Heartbeat(context.Context, string) (bool, error)
	RecordFailure(context.Context, string, asynccontract.FailurePayload) error
}

type Executor interface {
	Execute(context.Context, string) error
}

type ExecutorRegistration struct {
	RunType           domaintask.RunType
	Executor          Executor
	HeartbeatInterval time.Duration
}

type Clock interface {
	Now() time.Time
}

type retryableError struct {
	err error
}

func (err *retryableError) Error() string { return err.err.Error() }
func (err *retryableError) Unwrap() error { return err.err }

// Retryable explicitly marks dependency connectivity failures that are safe to execute again.
func Retryable(err error) error {
	if err == nil {
		return nil
	}
	return &retryableError{err: err}
}

func IsRetryable(err error) bool {
	var target *retryableError
	return errors.As(err, &target)
}

type Runner struct {
	control        Control
	executors      map[domaintask.RunType]ExecutorRegistration
	clock          Clock
	heartbeatGrace time.Duration
}

func New(control Control, registrations []ExecutorRegistration, clock Clock) *Runner {
	executors := make(map[domaintask.RunType]ExecutorRegistration, len(registrations))
	for _, registration := range registrations {
		if registration.Executor != nil {
			executors[registration.RunType] = registration
		}
	}
	return &Runner{
		control: control, executors: executors, clock: clock,
		heartbeatGrace: 5 * time.Minute,
	}
}

func (runner *Runner) Supports(runType domaintask.RunType) bool {
	if runner == nil {
		return false
	}
	_, ok := runner.executors[runType]
	return ok
}

func (runner *Runner) Handle(ctx context.Context, expectedRunType domaintask.RunType, payload []byte) (resultErr error) {
	var message Message
	if len(payload) == 0 || json.Unmarshal(payload, &message) != nil || message.TaskRunID == "" {
		return ErrInvalidPayload
	}
	if runner.control == nil || runner.clock == nil {
		return errors.New("async runner is not configured")
	}
	registration, ok := runner.executors[expectedRunType]
	if !ok {
		return fmt.Errorf("async executor is not configured for %s", expectedRunType)
	}
	claim, claimed, err := runner.control.Claim(ctx, message.TaskRunID, expectedRunType)
	if err != nil || !claimed {
		return err
	}
	if claim.TaskRunID != message.TaskRunID || claim.RunType != expectedRunType {
		return errors.New("async execution claim mismatch")
	}
	if claim.ExecutionState == domaintask.AsyncExecutionFailurePending {
		return errors.New("async execution failure pending phase is no longer executable")
	}
	if claim.ExecutionState != domaintask.AsyncExecutionExecuting {
		return errors.New("async execution claim is not executable")
	}
	session := claim.Session
	if session == nil {
		session = NewSession(
			claim.TaskRunID,
			claim.RunType,
			claim.ExecutionVersion,
			claim.ExecutionAttempts,
			claim.ExecutionToken,
			nil,
		)
	}

	executionCtx, cancel := context.WithCancel(WithSession(ctx, session))
	defer cancel()
	heartbeatErr := make(chan error, 1)
	heartbeatDone := runner.startHeartbeat(executionCtx, message.TaskRunID, registration.HeartbeatInterval, cancel, heartbeatErr)
	defer func() {
		cancel()
		<-heartbeatDone
		select {
		case err := <-heartbeatErr:
			resultErr = errors.Join(resultErr, err)
		default:
		}
	}()

	err = execute(registration.Executor, executionCtx, message.TaskRunID)
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	failure := asynccontract.FailurePayload{
		Retryable:    IsRetryable(err),
		ErrorCode:    "EXECUTION_FAILED",
		ErrorMessage: "asynchronous execution failed",
	}
	if failure.Retryable {
		backoff := time.Duration(claim.ExecutionAttempts) * 3 * time.Second
		nextDispatchAt := runner.clock.Now().Add(backoff)
		failure.ErrorCode = "EXECUTION_TEMPORARILY_UNAVAILABLE"
		failure.ErrorMessage = "temporary execution dependency unavailable"
		failure.NextDispatchAt = &nextDispatchAt
	}
	return errors.Join(err, runner.control.RecordFailure(executionCtx, message.TaskRunID, failure))
}

func execute(executor Executor, ctx context.Context, taskRunID string) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("async executor panic: %v", recovered)
		}
	}()
	return executor.Execute(ctx, taskRunID)
}

func (runner *Runner) startHeartbeat(
	ctx context.Context,
	taskRunID string,
	interval time.Duration,
	cancel context.CancelFunc,
	errs chan<- error,
) <-chan struct{} {
	done := make(chan struct{})
	if interval <= 0 {
		close(done)
		return done
	}
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		var disconnectedAt time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				continued, err := runner.control.Heartbeat(ctx, taskRunID)
				if err != nil {
					now := runner.clock.Now()
					if disconnectedAt.IsZero() {
						disconnectedAt = now
						continue
					}
					if runner.heartbeatGrace > 0 && now.Sub(disconnectedAt) < runner.heartbeatGrace {
						continue
					}
					select {
					case errs <- err:
					default:
					}
					cancel()
					return
				}
				disconnectedAt = time.Time{}
				if !continued {
					cancel()
					return
				}
			}
		}
	}()
	return done
}
