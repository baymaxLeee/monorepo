package projectusage

import (
	"context"
	"errors"
	"time"

	domain "github.com/example/monorepo/canvas/internal/server/domain/projectusage"
)

var (
	ErrCallNotFound         = errors.New("project usage AIGW call was not found")
	ErrCallConflict         = errors.New("project usage AIGW call conflicts with an existing ordinal")
	ErrRecordConflict       = errors.New("project usage record conflicts with an existing TaskRun")
	ErrConcurrentCallUpdate = errors.New("project usage AIGW call changed concurrently")
	ErrCallSetIncomplete    = errors.New("project usage TaskRun has no planned AIGW call")
	ErrTaskRunTerminal      = errors.New("terminal TaskRun cannot start another billable call")
	ErrTaskRunNotTerminal   = errors.New("project usage can only close a terminal TaskRun")
)

type BeginCallInput struct {
	TaskRunID   string
	CallOrdinal int32
	CallType    string
	ProjectID   string
	ModelID     string
	ModelName   string
	ModelSource string
}

type CloseInput struct {
	TaskRunID string
}

type CallStore interface {
	CreateCall(context.Context, domain.AIGWCall) error
	GetCall(context.Context, domain.CallRef) (domain.AIGWCall, error)
	UpdateCall(context.Context, domain.AIGWCall, domain.AIGWCall) (bool, error)
}

type FinalizationStore interface {
	CloseTaskRun(context.Context, CloseInput, time.Time) error
}

type ReconciliationStore interface {
	CallStore
	ClaimDue(context.Context, time.Time, time.Time, string, int) ([]domain.UsageRecord, error)
	ClaimTask(context.Context, string, time.Time, time.Time, string) (domain.UsageRecord, bool, error)
	BeginReconciliation(context.Context, domain.UsageRecord, time.Time) (domain.UsageRecord, bool, error)
	ListCalls(context.Context, string) ([]domain.AIGWCall, error)
	FinishReconciliation(context.Context, domain.UsageRecord, domain.ReconciliationUpdate, time.Time) (bool, error)
}

type MoneyStatus string

const (
	MoneyPending     MoneyStatus = "PENDING"
	MoneySettled     MoneyStatus = "SETTLED"
	MoneyNeedsReview MoneyStatus = "NEEDS_REVIEW"
)

type MoneyResult struct {
	Status   MoneyStatus
	Amount   string
	Currency string
	Reason   string
}

// MoneyQuerier is the application boundary for AIGW request-ID billing facts.
// The adapter currently implements it with ListTokenUsageRecordsInner.
type MoneyQuerier interface {
	QueryMoney(context.Context, string) (MoneyResult, error)
}

// ReconciliationTrigger schedules a best-effort first settlement round after
// the business transaction that created the usage projection has committed.
// The durable NextAttemptAt value remains the fallback when the signal is lost.
type ReconciliationTrigger interface {
	TriggerTask(string) bool
}

type UserNameTarget struct {
	TaskRunID string
	TenantID  string
	UserID    string
}

// UserNameStore owns the mutable display-name snapshot independently from
// billing reconciliation so an IAM outage cannot change a monetary state.
type UserNameStore interface {
	GetUnresolvedUserName(context.Context, string) (UserNameTarget, bool, error)
	ListUnresolvedUserNames(context.Context, int) ([]UserNameTarget, error)
	MarkUserNameResolved(context.Context, UserNameTarget, string, time.Time) error
}

// UserDirectory resolves tenant-scoped IAM user IDs in batches.
type UserDirectory interface {
	DisplayNames(context.Context, string, []string) (map[string]string, error)
}
