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
	ErrLastSuperAdmin       = errors.New("cannot revoke the last super_admin")

	ErrOrgNotFound   = errors.New("organization not found")
	ErrInvalidOrg    = errors.New("invalid organization request")
	ErrOwnerNotFound = errors.New("owner user not found")

	// ErrNotActiveMember: the target org is not an active membership of the user.
	ErrNotActiveMember = errors.New("not an active member")
	// ErrInvariant: the operation would break a hard invariant (last org_admin,
	// owner demotion, ...).
	ErrInvariant = errors.New("operation violates an invariant")
)
