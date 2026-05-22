package service

import "errors"

var (
	ErrConflict             = errors.New("conflict")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrInvalidRefreshToken  = errors.New("invalid refresh token")
	ErrInvalidRegistration  = errors.New("invalid registration")
	ErrInvalidSubject       = errors.New("invalid subject")
	ErrInvalidRole          = errors.New("invalid role")
	ErrRoleAssignmentFailed = errors.New("role assignment failed")
	ErrRoleAssignmentAbsent = errors.New("role assignment not found")
)
