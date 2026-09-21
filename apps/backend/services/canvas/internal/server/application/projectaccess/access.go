package projectaccess

import (
	"context"
	"errors"
	"fmt"
)

var (
	ErrProjectNotFound  = errors.New("project not found")
	ErrForbidden        = errors.New("project member required")
	ErrPermissionLookup = errors.New("project management permission lookup failed")
)

type Access uint8

const (
	AccessRead Access = iota + 1
	AccessUpdate
)

type Permissions struct {
	Read   bool
	Update bool
}

func (permissions Permissions) allows(access Access) bool {
	switch access {
	case AccessRead:
		return permissions.Read
	case AccessUpdate:
		return permissions.Update
	default:
		return false
	}
}

type PermissionReader interface {
	Permissions(context.Context, string, *string, string) (Permissions, error)
}

type MemberChecker interface {
	Check(context.Context, string, *string, string, string) error
}

type Checker interface {
	Check(context.Context, string, *string, string, string, Access) error
}

type Authorizer struct {
	permissions PermissionReader
	members     MemberChecker
}

func NewAuthorizer(permissions PermissionReader, members MemberChecker) *Authorizer {
	return &Authorizer{permissions: permissions, members: members}
}

func (authorizer *Authorizer) Check(
	ctx context.Context,
	tenantID string,
	workspaceID *string,
	userID string,
	projectID string,
	access Access,
) error {
	allowed, err := authorizer.managementAccess(ctx, tenantID, workspaceID, userID, access)
	if err != nil || allowed {
		return err
	}
	return authorizer.members.Check(ctx, tenantID, workspaceID, userID, projectID)
}

func (authorizer *Authorizer) managementAccess(
	ctx context.Context,
	tenantID string,
	workspaceID *string,
	userID string,
	access Access,
) (bool, error) {
	if authorizer == nil || authorizer.permissions == nil || authorizer.members == nil {
		return false, fmt.Errorf("%w: project access authorizer is not configured", ErrPermissionLookup)
	}
	permissions, err := authorizer.permissions.Permissions(ctx, tenantID, workspaceID, userID)
	if err != nil {
		return false, fmt.Errorf("%w: %w", ErrPermissionLookup, err)
	}
	return permissions.allows(access), nil
}

type CacheInvalidator interface {
	Invalidate(context.Context, string, *string, string) error
}
