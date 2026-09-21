package task

// ClaimError associates a background claim failure with its task run.
type ClaimError struct {
	TaskRunID string
	err       error
}

func NewClaimError(taskRunID string, err error) error {
	if err == nil {
		return nil
	}
	return &ClaimError{TaskRunID: taskRunID, err: err}
}

func (e *ClaimError) Error() string { return e.err.Error() }
func (e *ClaimError) Unwrap() error { return e.err }
