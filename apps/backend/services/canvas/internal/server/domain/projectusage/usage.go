package projectusage

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalidCall       = errors.New("project usage AIGW call is invalid")
	ErrInvalidRecord     = errors.New("project usage record is invalid")
	ErrInvalidTransition = errors.New("project usage state transition is invalid")
	ErrInvalidAmount     = errors.New("project usage amount is invalid")
)

type CaptureResult string

const (
	CaptureCaptured         CaptureResult = "CAPTURED"
	CaptureNotSent          CaptureResult = "NOT_SENT"
	CaptureRequestIDUnknown CaptureResult = "REQUEST_ID_UNKNOWN"
)

type CallBillingStatus string

const (
	CallBillingPending     CallBillingStatus = "PENDING"
	CallBillingFinal       CallBillingStatus = "FINAL"
	CallBillingNeedsReview CallBillingStatus = "NEEDS_REVIEW"
)

type SettlementReason string

const (
	SettlementAIGWSettled     SettlementReason = "AIGW_SETTLED"
	SettlementNotSent         SettlementReason = "NOT_SENT"
	SettlementCancelConfirmed SettlementReason = "CANCEL_CONFIRMED"
)

type RecordBillingStatus string

const (
	RecordBillingPending     RecordBillingStatus = "PENDING"
	RecordBillingReady       RecordBillingStatus = "READY"
	RecordBillingNeedsReview RecordBillingStatus = "NEEDS_REVIEW"
)

type CallRef struct {
	TaskRunID   string
	CallOrdinal int32
}

type AIGWCall struct {
	TaskRunID        string
	CallOrdinal      int32
	CallType         string
	ProjectID        string
	ModelID          string
	ModelName        string
	ModelSource      string
	RequestStartedAt *time.Time
	RequestID        *string
	CaptureResult    *CaptureResult
	BillingStatus    CallBillingStatus
	SettlementReason *SettlementReason
	Amount           *string
	Currency         *string
	ReviewReason     string
	StateVersion     int64
	CreatedAt        time.Time
	UpdatedAt        time.Time
	FinalizedAt      *time.Time
}

type NewAIGWCallInput struct {
	TaskRunID   string
	CallOrdinal int32
	CallType    string
	ProjectID   string
	ModelID     string
	ModelName   string
	ModelSource string
	Now         time.Time
}

func NewAIGWCall(input NewAIGWCallInput) (AIGWCall, error) {
	call := AIGWCall{
		TaskRunID: strings.TrimSpace(input.TaskRunID), CallOrdinal: input.CallOrdinal,
		CallType: strings.TrimSpace(input.CallType), ProjectID: strings.TrimSpace(input.ProjectID),
		ModelID: strings.TrimSpace(input.ModelID), ModelName: strings.TrimSpace(input.ModelName),
		ModelSource: strings.TrimSpace(input.ModelSource), BillingStatus: CallBillingPending,
		StateVersion: 1, CreatedAt: input.Now, UpdatedAt: input.Now,
	}
	if err := call.Validate(); err != nil {
		return AIGWCall{}, err
	}
	return call, nil
}

func (call AIGWCall) Ref() CallRef {
	return CallRef{TaskRunID: call.TaskRunID, CallOrdinal: call.CallOrdinal}
}

func (call *AIGWCall) StartRequest(now time.Time) error {
	if now.IsZero() || call.BillingStatus != CallBillingPending || call.CaptureResult != nil || call.RequestID != nil {
		return ErrInvalidTransition
	}
	if call.RequestStartedAt != nil {
		return nil
	}
	call.RequestStartedAt = &now
	call.UpdatedAt = now
	call.StateVersion++
	return call.Validate()
}

func (call AIGWCall) Validate() error {
	if strings.TrimSpace(call.TaskRunID) == "" || call.CallOrdinal <= 0 ||
		strings.TrimSpace(call.CallType) == "" || strings.TrimSpace(call.ProjectID) == "" ||
		strings.TrimSpace(call.ModelID) == "" || strings.TrimSpace(call.ModelName) == "" ||
		strings.TrimSpace(call.ModelSource) == "" ||
		call.StateVersion < 1 || call.CreatedAt.IsZero() || call.UpdatedAt.IsZero() {
		return ErrInvalidCall
	}
	switch call.BillingStatus {
	case CallBillingPending:
		if call.SettlementReason != nil || call.Amount != nil || call.Currency != nil || call.FinalizedAt != nil {
			return ErrInvalidCall
		}
		if call.CaptureResult != nil {
			if call.RequestStartedAt == nil || *call.CaptureResult != CaptureCaptured || call.RequestID == nil || strings.TrimSpace(*call.RequestID) == "" {
				return ErrInvalidCall
			}
		} else if call.RequestID != nil {
			return ErrInvalidCall
		}
	case CallBillingFinal:
		if call.CaptureResult == nil || call.SettlementReason == nil || call.Amount == nil || call.FinalizedAt == nil {
			return ErrInvalidCall
		}
		if _, err := NormalizeAmount(*call.Amount); err != nil {
			return ErrInvalidCall
		}
		switch *call.SettlementReason {
		case SettlementAIGWSettled:
			if call.RequestStartedAt == nil || *call.CaptureResult != CaptureCaptured || call.RequestID == nil ||
				(call.Currency != nil && strings.TrimSpace(*call.Currency) == "") {
				return ErrInvalidCall
			}
		case SettlementNotSent:
			if *call.CaptureResult != CaptureNotSent || call.RequestID != nil || *call.Amount != "0" || call.Currency != nil {
				return ErrInvalidCall
			}
		case SettlementCancelConfirmed:
			if call.RequestStartedAt == nil || *call.Amount != "0" || call.Currency != nil {
				return ErrInvalidCall
			}
			switch *call.CaptureResult {
			case CaptureCaptured:
				if call.RequestID == nil || strings.TrimSpace(*call.RequestID) == "" {
					return ErrInvalidCall
				}
			case CaptureRequestIDUnknown:
				if call.RequestID != nil {
					return ErrInvalidCall
				}
			default:
				return ErrInvalidCall
			}
		default:
			return ErrInvalidCall
		}
	case CallBillingNeedsReview:
		if call.CaptureResult == nil || strings.TrimSpace(call.ReviewReason) == "" || call.Amount != nil || call.Currency != nil || call.FinalizedAt == nil {
			return ErrInvalidCall
		}
		if *call.CaptureResult == CaptureCaptured && (call.RequestStartedAt == nil || call.RequestID == nil || strings.TrimSpace(*call.RequestID) == "") {
			return ErrInvalidCall
		}
		if *call.CaptureResult == CaptureRequestIDUnknown {
			if call.RequestStartedAt == nil || call.RequestID != nil {
				return ErrInvalidCall
			}
		}
	case "":
		return ErrInvalidCall
	default:
		return ErrInvalidCall
	}
	return nil
}

// ValidateTransition protects the append-only billing facts at the persistence
// boundary. Application callers normally use the domain mutators below, but a
// repository must still reject a valid-in-isolation object that rewinds a
// started, captured, or terminal call.
func (call AIGWCall) ValidateTransition(next AIGWCall) error {
	if err := call.Validate(); err != nil {
		return err
	}
	if err := next.Validate(); err != nil {
		return err
	}
	if call.TaskRunID != next.TaskRunID || call.CallOrdinal != next.CallOrdinal ||
		call.CallType != next.CallType || call.ProjectID != next.ProjectID ||
		call.ModelID != next.ModelID || call.ModelName != next.ModelName ||
		call.ModelSource != next.ModelSource || !call.CreatedAt.Equal(next.CreatedAt) ||
		next.StateVersion != call.StateVersion+1 || next.UpdatedAt.Before(call.UpdatedAt) {
		return ErrInvalidTransition
	}
	if call.RequestStartedAt != nil &&
		(next.RequestStartedAt == nil || !call.RequestStartedAt.Equal(*next.RequestStartedAt)) {
		return ErrInvalidTransition
	}
	if call.RequestID != nil && (next.RequestID == nil || *call.RequestID != *next.RequestID) {
		return ErrInvalidTransition
	}
	if call.CaptureResult != nil &&
		(next.CaptureResult == nil || *call.CaptureResult != *next.CaptureResult) {
		return ErrInvalidTransition
	}
	switch call.BillingStatus {
	case CallBillingPending:
		switch next.BillingStatus {
		case CallBillingPending, CallBillingFinal, CallBillingNeedsReview:
			return nil
		}
	case CallBillingNeedsReview:
		if next.BillingStatus == CallBillingFinal && next.SettlementReason != nil &&
			*next.SettlementReason == SettlementCancelConfirmed {
			return nil
		}
	}
	return ErrInvalidTransition
}

func (call *AIGWCall) Capture(requestID string, now time.Time) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || now.IsZero() {
		return ErrInvalidTransition
	}
	if call.BillingStatus != CallBillingPending || call.RequestStartedAt == nil || call.SettlementReason != nil {
		if call.CaptureResult != nil && *call.CaptureResult == CaptureCaptured && call.RequestID != nil && *call.RequestID == requestID {
			return nil
		}
		return ErrInvalidTransition
	}
	if call.CaptureResult != nil {
		if *call.CaptureResult == CaptureCaptured && call.RequestID != nil && *call.RequestID == requestID {
			return nil
		}
		return ErrInvalidTransition
	}
	result := CaptureCaptured
	call.CaptureResult = &result
	call.RequestID = &requestID
	call.UpdatedAt = now
	call.StateVersion++
	return call.Validate()
}

func (call *AIGWCall) FinalizeNotSent(now time.Time) error {
	if call.isExactFinal(CaptureNotSent, SettlementNotSent, "0", "") {
		return nil
	}
	if call.BillingStatus != CallBillingPending || call.CaptureResult != nil || now.IsZero() {
		return ErrInvalidTransition
	}
	capture, reason, amount := CaptureNotSent, SettlementNotSent, "0"
	call.CaptureResult, call.SettlementReason, call.Amount = &capture, &reason, &amount
	call.BillingStatus, call.FinalizedAt, call.UpdatedAt = CallBillingFinal, &now, now
	call.StateVersion++
	return call.Validate()
}

func (call *AIGWCall) ConfirmCancellation(now time.Time) error {
	if call.isCancellationFinal() {
		return call.Validate()
	}
	// AIGW's successful cancellation is an authoritative zero-charge fact. It
	// may therefore resolve a missing response RequestID without inventing one;
	// the original capture result remains immutable for auditability.
	if now.IsZero() || call.RequestStartedAt == nil || call.CaptureResult == nil ||
		(call.BillingStatus != CallBillingPending && call.BillingStatus != CallBillingNeedsReview) {
		return ErrInvalidTransition
	}
	switch *call.CaptureResult {
	case CaptureCaptured:
		if call.RequestID == nil || strings.TrimSpace(*call.RequestID) == "" {
			return ErrInvalidTransition
		}
	case CaptureRequestIDUnknown:
		if call.RequestID != nil {
			return ErrInvalidTransition
		}
	default:
		return ErrInvalidTransition
	}
	reason, amount := SettlementCancelConfirmed, "0"
	call.SettlementReason, call.Amount = &reason, &amount
	call.Currency, call.ReviewReason = nil, ""
	call.BillingStatus, call.FinalizedAt, call.UpdatedAt = CallBillingFinal, &now, now
	call.StateVersion++
	return call.Validate()
}

func (call *AIGWCall) Settle(amount, currency string, reason SettlementReason, now time.Time) error {
	normalized, err := NormalizeAmount(amount)
	currency = strings.TrimSpace(currency)
	if err != nil || reason != SettlementAIGWSettled || now.IsZero() {
		return ErrInvalidTransition
	}
	if call.isExactFinal(CaptureCaptured, reason, normalized, currency) {
		return nil
	}
	if call.BillingStatus != CallBillingPending || call.CaptureResult == nil || *call.CaptureResult != CaptureCaptured || call.RequestID == nil {
		return ErrInvalidTransition
	}
	call.SettlementReason, call.Amount = &reason, &normalized
	call.Currency = nil
	if currency != "" {
		call.Currency = &currency
	}
	call.BillingStatus, call.FinalizedAt, call.UpdatedAt = CallBillingFinal, &now, now
	call.StateVersion++
	return call.Validate()
}

func (call *AIGWCall) MarkRequestIDUnknown(reason string, now time.Time) error {
	return call.markNeedsReview(CaptureRequestIDUnknown, reason, now)
}

func (call *AIGWCall) MarkCapturedNeedsReview(reason string, now time.Time) error {
	return call.markNeedsReview(CaptureCaptured, reason, now)
}

func (call *AIGWCall) markNeedsReview(capture CaptureResult, reason string, now time.Time) error {
	reason = strings.TrimSpace(reason)
	if call.BillingStatus == CallBillingNeedsReview && call.CaptureResult != nil && *call.CaptureResult == capture && call.ReviewReason == reason {
		return nil
	}
	if call.BillingStatus != CallBillingPending || reason == "" || now.IsZero() {
		return ErrInvalidTransition
	}
	switch capture {
	case CaptureRequestIDUnknown:
		if call.RequestStartedAt == nil || call.CaptureResult != nil || call.RequestID != nil {
			return ErrInvalidTransition
		}
	case CaptureCaptured:
		if call.CaptureResult == nil || *call.CaptureResult != CaptureCaptured || call.RequestID == nil {
			return ErrInvalidTransition
		}
	default:
		return ErrInvalidTransition
	}
	call.CaptureResult, call.BillingStatus, call.ReviewReason = &capture, CallBillingNeedsReview, reason
	call.FinalizedAt, call.UpdatedAt = &now, now
	call.StateVersion++
	return call.Validate()
}

func (call AIGWCall) isExactFinal(capture CaptureResult, reason SettlementReason, amount, currency string) bool {
	if call.BillingStatus != CallBillingFinal || call.CaptureResult == nil || call.SettlementReason == nil || call.Amount == nil {
		return false
	}
	if *call.CaptureResult != capture || *call.SettlementReason != reason || *call.Amount != amount {
		return false
	}
	if currency == "" {
		return call.Currency == nil
	}
	return call.Currency != nil && *call.Currency == currency
}

func (call AIGWCall) isCancellationFinal() bool {
	if call.BillingStatus != CallBillingFinal || call.CaptureResult == nil || call.SettlementReason == nil ||
		*call.SettlementReason != SettlementCancelConfirmed || call.Amount == nil || *call.Amount != "0" || call.Currency != nil {
		return false
	}
	return *call.CaptureResult == CaptureCaptured || *call.CaptureResult == CaptureRequestIDUnknown
}

type UsageRecord struct {
	TaskRunID          string
	TenantID           string
	WorkspaceID        *string
	ProjectID          string
	TaskType           string
	ResourceType       string
	ModelID            string
	ModelName          string
	ModelSource        string
	CreatedBy          string
	CreatedByName      string
	ConsumedAt         time.Time
	CallCount          int32
	FinalCallCount     int32
	BillingStatus      RecordBillingStatus
	TotalAmount        *string
	Currency           *string
	BillingAttempts    int32
	NoProgressAttempts int32
	NextAttemptAt      *time.Time
	LeaseOwner         string
	LeaseUntil         *time.Time
	StateVersion       int64
	ReviewReason       string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	BillingFinalizedAt *time.Time
}

func (record UsageRecord) Validate() error {
	if strings.TrimSpace(record.TaskRunID) == "" || strings.TrimSpace(record.TenantID) == "" ||
		strings.TrimSpace(record.ProjectID) == "" || strings.TrimSpace(record.TaskType) == "" ||
		strings.TrimSpace(record.ResourceType) == "" || strings.TrimSpace(record.ModelID) == "" ||
		strings.TrimSpace(record.ModelName) == "" || strings.TrimSpace(record.ModelSource) == "" ||
		strings.TrimSpace(record.CreatedBy) == "" || strings.TrimSpace(record.CreatedByName) == "" ||
		record.ConsumedAt.IsZero() || record.CallCount < 0 ||
		record.FinalCallCount < 0 || record.FinalCallCount > record.CallCount || record.StateVersion < 1 ||
		record.CreatedAt.IsZero() || record.UpdatedAt.IsZero() {
		return ErrInvalidRecord
	}
	switch record.BillingStatus {
	case RecordBillingPending:
		if record.TotalAmount != nil || record.Currency != nil || record.NextAttemptAt == nil || record.BillingFinalizedAt != nil {
			return ErrInvalidRecord
		}
	case RecordBillingReady:
		if record.TotalAmount == nil || record.FinalCallCount != record.CallCount || record.NextAttemptAt != nil || record.BillingFinalizedAt == nil {
			return ErrInvalidRecord
		}
		if _, err := NormalizeAmount(*record.TotalAmount); err != nil {
			return ErrInvalidRecord
		}
		if record.Currency != nil && strings.TrimSpace(*record.Currency) == "" {
			return ErrInvalidRecord
		}
	case RecordBillingNeedsReview:
		if record.TotalAmount != nil || record.Currency != nil || record.NextAttemptAt != nil || record.BillingFinalizedAt != nil || strings.TrimSpace(record.ReviewReason) == "" {
			return ErrInvalidRecord
		}
	default:
		return ErrInvalidRecord
	}
	return nil
}

type ReconciliationUpdate struct {
	BillingStatus      RecordBillingStatus
	FinalCallCount     int32
	TotalAmount        *string
	Currency           *string
	BillingAttempts    int32
	NoProgressAttempts int32
	NextAttemptAt      *time.Time
	ReviewReason       string
	BillingFinalizedAt *time.Time
}

var amountPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$`)

func NormalizeAmount(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !amountPattern.MatchString(value) {
		return "", ErrInvalidAmount
	}
	parts := strings.SplitN(value, ".", 2)
	if len(parts[0]) > 20 || len(parts) == 2 && len(parts[1]) > 18 {
		return "", ErrInvalidAmount
	}
	if dot := strings.IndexByte(value, '.'); dot >= 0 {
		value = strings.TrimRight(value, "0")
		value = strings.TrimRight(value, ".")
	}
	return value, nil
}

func AddAmounts(values ...string) (string, error) {
	if len(values) == 0 {
		return "0", nil
	}
	normalized := make([]string, len(values))
	maxScale := 0
	for index, value := range values {
		var err error
		normalized[index], err = NormalizeAmount(value)
		if err != nil {
			return "", err
		}
		if dot := strings.IndexByte(normalized[index], '.'); dot >= 0 && len(normalized[index])-dot-1 > maxScale {
			maxScale = len(normalized[index]) - dot - 1
		}
	}
	total := new(big.Int)
	for _, value := range normalized {
		parts := strings.SplitN(value, ".", 2)
		fraction := ""
		if len(parts) == 2 {
			fraction = parts[1]
		}
		digits := parts[0] + fraction + strings.Repeat("0", maxScale-len(fraction))
		component := new(big.Int)
		if _, ok := component.SetString(digits, 10); !ok {
			return "", ErrInvalidAmount
		}
		total.Add(total, component)
	}
	digits := total.String()
	if maxScale == 0 {
		return digits, nil
	}
	if len(digits) <= maxScale {
		digits = strings.Repeat("0", maxScale-len(digits)+1) + digits
	}
	point := len(digits) - maxScale
	return NormalizeAmount(digits[:point] + "." + digits[point:])
}
