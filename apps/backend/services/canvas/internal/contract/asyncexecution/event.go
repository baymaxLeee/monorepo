package asyncexecution

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type EventType string

const (
	EventTypeCheckpoint EventType = "CHECKPOINT"
	EventTypeSuccess    EventType = "SUCCESS"
	EventTypeFailure    EventType = "FAILURE"
)

type ConsumeStatus string

const (
	ConsumeStatusPending   ConsumeStatus = "PENDING"
	ConsumeStatusConsuming ConsumeStatus = "CONSUMING"
	ConsumeStatusConsumed  ConsumeStatus = "CONSUMED"
	ConsumeStatusDiscarded ConsumeStatus = "DISCARDED"
)

type FailurePayload struct {
	Retryable      bool       `json:"Retryable"`
	ErrorCode      string     `json:"ErrorCode"`
	ErrorMessage   string     `json:"ErrorMessage"`
	NextDispatchAt *time.Time `json:"NextDispatchAt,omitempty"`
}

type Event struct {
	ID                string
	TaskRunID         string
	RunType           string
	ExecutionToken    string
	Sequence          int32
	EventType         EventType
	PayloadVersion    int32
	Payload           json.RawMessage
	PayloadSHA256     string
	TerminalSlot      *int8
	ConsumeStatus     ConsumeStatus
	NextConsumeAt     time.Time
	ConsumeLeaseUntil *time.Time
	ConsumeAttempts   int32
	StateVersion      int64
	LastErrorCode     string
	LastErrorMessage  string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	ConsumedAt        *time.Time
}

func (event Event) Validate() error {
	if strings.TrimSpace(event.ID) == "" ||
		strings.TrimSpace(event.TaskRunID) == "" ||
		strings.TrimSpace(event.RunType) == "" ||
		strings.TrimSpace(event.ExecutionToken) == "" ||
		event.Sequence <= 0 ||
		event.PayloadVersion <= 0 ||
		event.StateVersion <= 0 ||
		event.NextConsumeAt.IsZero() ||
		event.CreatedAt.IsZero() ||
		event.UpdatedAt.IsZero() {
		return errors.New("invalid async execution event")
	}
	if event.EventType != EventTypeCheckpoint &&
		event.EventType != EventTypeSuccess &&
		event.EventType != EventTypeFailure {
		return errors.New("invalid async execution event type")
	}
	if event.ConsumeStatus != ConsumeStatusPending &&
		event.ConsumeStatus != ConsumeStatusConsuming &&
		event.ConsumeStatus != ConsumeStatusConsumed &&
		event.ConsumeStatus != ConsumeStatusDiscarded {
		return errors.New("invalid async execution consume status")
	}
	isTerminal := event.EventType == EventTypeSuccess || event.EventType == EventTypeFailure
	if isTerminal != (event.TerminalSlot != nil && *event.TerminalSlot == 1) {
		return errors.New("invalid async execution terminal slot")
	}
	if event.PayloadSHA256 != PayloadSHA256(event.Payload) {
		return errors.New("invalid async execution payload hash")
	}
	return nil
}

func PayloadSHA256(payload json.RawMessage) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
