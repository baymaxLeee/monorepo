package errno

import (
	"errors"
	"net/http"
)

// Ensure preserves an existing BizError and classifies only raw errors.
func Ensure(code ErrorCode, err error) error {
	if err == nil {
		return nil
	}
	var bizErr *BizError
	if errors.As(err, &bizErr) {
		return err
	}
	return Wrap(code, err)
}

// EnsureWithMessage preserves an existing BizError and otherwise classifies
// the raw error with a safe caller-provided message.
func EnsureWithMessage(code ErrorCode, message string, err error) error {
	if err == nil {
		return nil
	}
	var bizErr *BizError
	if errors.As(err, &bizErr) {
		return err
	}
	return WrapWithMessage(code, message, err)
}

func WrapWithMessage(code ErrorCode, message string, err error) *BizError {
	return NewWithMessage(code, message).WithCause(err)
}

// Status returns the HTTP status for a classified error. Raw errors use 500.
func Status(err error) int {
	meta := Meta(CodeOf(err))
	if meta.HTTPCode >= 100 && meta.HTTPCode <= 599 {
		return meta.HTTPCode
	}
	return http.StatusInternalServerError
}

// CodeOf returns the stable code or InternalError for an unclassified error.
func CodeOf(err error) ErrorCode {
	var bizErr *BizError
	if errors.As(err, &bizErr) {
		return bizErr.Code
	}
	return ErrInternalError
}

// MessageOf returns only a user-safe message. Raw error text is never exposed.
func MessageOf(err error) string {
	var bizErr *BizError
	if errors.As(err, &bizErr) {
		if bizErr.Message != "" {
			return bizErr.Message
		}
		return Meta(bizErr.Code).Message
	}
	return Meta(ErrInternalError).Message
}

func Persistence(err error) error {
	return Ensure(ErrPersistenceError, err)
}

func ExternalDependency(err error) error {
	return Ensure(ErrExternalDependencyError, err)
}

func Configuration(err error) error {
	return Ensure(ErrConfigurationError, err)
}

func Serialization(err error) error {
	return Ensure(ErrSerializationError, err)
}

func RedisDependency(err error) error {
	return Ensure(ErrRedisDependencyError, err)
}

func ModelDependency(err error) error {
	return Ensure(ErrModelDependencyError, err)
}

func ObjectStorageDependency(err error) error {
	return Ensure(ErrObjectStorageDependencyError, err)
}

func ExecutionLaneDependency(err error) error {
	return Ensure(ErrExecutionLaneDependencyError, err)
}
