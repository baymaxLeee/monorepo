package application

import "time"

type AuthConfig struct {
	AccessTokenSecret string
	AccessTokenTTL    time.Duration
	RefreshTokenTTL   time.Duration
	GuestWorkspaceID  string
}

type WorkspaceConfig struct {
	GuestWorkspaceID string
}

type SeedConfig struct {
	SuperAdminID          string
	SuperAdminAccount     string
	SuperAdminEmail       string
	SuperAdminPassword    string
	SuperAdminDisplayName string
	GuestWorkspaceID      string
	GuestWorkspaceName    string
	GuestWorkspaceSlug    string
}
