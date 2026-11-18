package application

import (
	"context"
	"io"
	"net/http"
	"time"
)

type AuthContext struct {
	UserID      string
	TenantID    string
	WorkspaceID string
}

type Conversation struct {
	ID               string    `json:"id"`
	RuntimeSessionID string    `json:"-"`
	CreateRequestID  string    `json:"-"`
	UserID           string    `json:"user_id"`
	TenantID         string    `json:"tenant_id"`
	WorkspaceID      string    `json:"workspace_id"`
	Title            string    `json:"title"`
	ProjectID        *string   `json:"project_id"`
	CanvasID         *string   `json:"canvas_id"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type CreateConversationInput struct {
	RequestID  string  `json:"request_id"`
	Title      *string `json:"title,omitempty"`
	ProviderID *string `json:"provider_id,omitempty"`
	ReasoningEffort *string `json:"reasoning_effort,omitempty"`
	ProjectID  *string `json:"project_id,omitempty"`
	CanvasID   *string `json:"canvas_id,omitempty"`
}

type Repository interface {
	Ping(context.Context) error
	Create(context.Context, AuthContext, string, CreateConversationInput) (Conversation, error)
	List(context.Context, AuthContext) ([]Conversation, error)
	Get(context.Context, AuthContext, string) (*Conversation, error)
	UpdateTitle(context.Context, AuthContext, string, string) (*Conversation, error)
	UpdateTitleIfDefault(context.Context, AuthContext, string, string) (*Conversation, error)
	Delete(context.Context, AuthContext, string) (*Conversation, error)
	Close()
}

type RuntimeRequest struct {
	Method  string
	Path    string
	Headers http.Header
	Body    io.Reader
}

type RuntimeClient interface {
	Do(context.Context, RuntimeRequest) (*http.Response, error)
}
