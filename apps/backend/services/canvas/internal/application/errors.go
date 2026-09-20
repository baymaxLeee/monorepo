package application

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

type Actor struct{ UserID, OrgID, OrgRole string }
