package application

import (
	"fmt"
	"net/http"
)

type Error struct {
	Status  int
	Code    string
	Message string
}

func (err *Error) Error() string { return err.Message }

func BadRequest(message string) error {
	return &Error{Status: http.StatusBadRequest, Code: "bad_request", Message: message}
}

func Conflict(code, message string) error {
	return &Error{Status: http.StatusConflict, Code: code, Message: message}
}

func NotFound(message string) error {
	return &Error{Status: http.StatusNotFound, Code: "not_found", Message: message}
}

type RuntimeResponseError struct {
	Response *http.Response
}

func (err *RuntimeResponseError) Error() string {
	return fmt.Sprintf("Runtime request failed with status %d", err.Response.StatusCode)
}
