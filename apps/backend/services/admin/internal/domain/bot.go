package domain

import "time"

type Bot struct {
	ID, UserID, WorkspaceID, TenantID, Name, Status, Tone                                                          string
	RoleDescription, DomainDescription, Audience, WelcomeMessage, TextProviderID, ImageProviderID, VideoProviderID *string
	SuggestedQuestions                                                                                             []string
	CreatedAt, UpdatedAt                                                                                           time.Time
}
type SkillSummary struct {
	ID, UserID, WorkspaceID, TenantID, Username, Name, Description, Status string
	IsEnabled, HasUnpublishedChanges                                       bool
	PublishedAt                                                            *time.Time
	CreatedAt, UpdatedAt                                                   time.Time
}
