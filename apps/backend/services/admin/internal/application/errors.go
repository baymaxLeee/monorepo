package application

import "fmt"

type Error struct {
	Status        int
	Code, Message string
	Details       any
}

func (e *Error) Error() string { return e.Message }
func (e *Error) WithDetails(details any) error {
	e.Details = details
	return e
}
func NewError(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}
func NotFound(format string, args ...any) error {
	return NewError(404, "not_found", fmt.Sprintf(format, args...))
}
func BadRequest(message string) error { return NewError(400, "request_error", message) }
func BadRequestf(format string, args ...any) error {
	return BadRequest(fmt.Sprintf(format, args...))
}
func Forbidden(message string) error { return NewError(403, "forbidden", message) }
func Conflict(message string) error  { return NewError(409, "conflict", message) }
func Conflictf(format string, args ...any) error {
	return Conflict(fmt.Sprintf(format, args...))
}
