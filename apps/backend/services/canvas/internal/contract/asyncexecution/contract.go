package asyncexecution

import (
	"encoding/json"
)

const (
	APIVersion          = "2026-07-31"
	ActionClaim         = "ClaimAsyncExecution"
	ActionHeartbeat     = "HeartbeatAsyncExecution"
	DirectiveContinue   = "CONTINUE"
	DirectiveStop       = "STOP"
	ServiceIdentityType = "3"
)

type ClaimRequest struct {
	TaskRunID string `json:"TaskRunID"`
	RunType   string `json:"RunType"`
}

type ClaimResponse struct {
	Directive         string          `json:"Directive"`
	RunType           string          `json:"RunType,omitempty"`
	ExecutionState    string          `json:"ExecutionState,omitempty"`
	ExecutionVersion  int64           `json:"ExecutionVersion,omitempty"`
	ExecutionAttempts int32           `json:"ExecutionAttempts,omitempty"`
	ExecutionToken    string          `json:"ExecutionToken,omitempty"`
	Payload           json.RawMessage `json:"Payload,omitempty"`
}

type HeartbeatRequest struct {
	TaskRunID        string `json:"TaskRunID"`
	RunType          string `json:"RunType"`
	ExecutionVersion int64  `json:"ExecutionVersion"`
}

type HeartbeatResponse struct {
	Directive        string `json:"Directive"`
	ExecutionVersion int64  `json:"ExecutionVersion,omitempty"`
}
