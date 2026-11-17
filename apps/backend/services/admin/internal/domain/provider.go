package domain

import "time"

type Provider struct {
	ID, UserID, WorkspaceID, TenantID        string
	Name, Model, Kind                        string
	ResponsesDialect                         *string
	BaseURL, APIKeyEncrypted, ExtraBody      string
	PricingJSON                              *string
	ContextWindow, MaxOutputTokens           int
	SupportsImageInput, IsDefault, IsEnabled bool
	CreatedAt, UpdatedAt                     time.Time
}
