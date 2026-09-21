package application

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string     { return e.Message }
func Invalid(message string) error { return &Error{400, "invalid_argument", message} }
func NotFound() error              { return &Error{404, "not_found", "resource not found"} }
func Conflict() error {
	return &Error{409, "revision_conflict", "画布已更新，请重新读取后再提交"}
}
func ConflictMessage(code, message string) error { return &Error{409, code, message} }
func uniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

type Actor struct{ UserID, TenantID, WorkspaceID, WorkspaceRole string }
