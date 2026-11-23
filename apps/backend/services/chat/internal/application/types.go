package application

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

type AuthContext struct {
	UserID        string
	TenantID      string
	WorkspaceID   string
	WorkspaceRole string
}

type Conversation struct {
	ID                   string
	State                ConversationState
	Operation            ConversationOperation
	RuntimeThreadID      string
	CreateRequestID      string
	CreateFingerprint    string
	RuntimeRequest       json.RawMessage
	SourceConversationID *string
	SourceMessageID      *string
	UserID               string
	TenantID             string
	WorkspaceID          string
	Title                string
	PluginSelections     []ConversationPluginSelection
	AttemptCount         int
	NextAttemptAt        time.Time
	LastError            *string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type ConversationState string

const (
	ConversationCreating ConversationState = "creating"
	ConversationReady    ConversationState = "ready"
	ConversationDeleting ConversationState = "deleting"
)

type ConversationOperation string

const (
	ConversationCreate ConversationOperation = "create"
	ConversationFork   ConversationOperation = "fork"
)

type CreateConversationInput struct {
	RequestID         string                        `json:"request_id"`
	Title             *string                       `json:"title,omitempty"`
	ProviderID        *string                       `json:"provider_id,omitempty"`
	ReasoningEffort   *string                       `json:"reasoning_effort,omitempty"`
	ApprovalPolicy    *string                       `json:"approval_policy,omitempty"`
	PermissionProfile *string                       `json:"permission_profile,omitempty"`
	PluginSelections  []ConversationPluginSelection `json:"plugin_selections,omitempty"`
}

type CreateCanvasConversationInput struct {
	RequestID       string  `json:"request_id"`
	Title           *string `json:"title,omitempty"`
	ProviderID      *string `json:"provider_id,omitempty"`
	ReasoningEffort *string `json:"reasoning_effort,omitempty"`
	ProjectID       string  `json:"project_id"`
	CanvasID        string  `json:"canvas_id"`
}

// ConversationPluginSelection is the only product-owned plugin state. Endpoint,
// header, credential, release and tool policy data never enter Chat persistence.
type ConversationPluginSelection struct {
	PluginID string            `json:"plugin_id"`
	Bindings map[string]string `json:"bindings,omitempty"`
}

type ConversationIntent struct {
	Operation            ConversationOperation
	Input                CreateConversationInput
	CreateFingerprint    string
	RuntimeRequest       json.RawMessage
	SourceConversationID *string
	SourceMessageID      *string
}

type Repository interface {
	Ping(context.Context) error
	Reserve(context.Context, AuthContext, ConversationIntent) (Conversation, error)
	BindRuntimeThread(context.Context, AuthContext, string, string) (Conversation, error)
	RecordSagaFailure(context.Context, AuthContext, string, ConversationState, error) error
	List(context.Context, AuthContext) ([]Conversation, error)
	Get(context.Context, AuthContext, string) (*Conversation, error)
	UpdateTitle(context.Context, AuthContext, string, string) (*Conversation, error)
	UpdateTitleIfDefault(context.Context, AuthContext, string, string) (*Conversation, error)
	BeginDelete(context.Context, AuthContext, string) (*Conversation, error)
	CompleteDelete(context.Context, AuthContext, string, string) error
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

type RuntimeProviderCapability struct {
	ID                 string         `json:"id"`
	Name               string         `json:"name"`
	Model              string         `json:"model"`
	BaseURL            string         `json:"baseUrl"`
	APIKey             string         `json:"apiKey"`
	ExtraBody          map[string]any `json:"extraBody"`
	ContextWindow      int            `json:"contextWindow"`
	MaxOutputTokens    int            `json:"maxOutputTokens"`
	SupportsImageInput bool           `json:"supportsImageInput"`
	ProviderKind       string         `json:"providerKind,omitempty"`
}

type RuntimeProviderPricing struct {
	Currency        string `json:"currency"`
	Unit            string `json:"unit"`
	UnitPriceMicros int64  `json:"unitPriceMicros"`
}

type RuntimeMediaProviderCapability struct {
	ID              string                  `json:"id"`
	Name            string                  `json:"name"`
	Model           string                  `json:"model"`
	BaseURL         string                  `json:"baseUrl"`
	APIKey          string                  `json:"apiKey"`
	ExtraBody       map[string]any          `json:"extraBody"`
	ContextWindow   int                     `json:"contextWindow"`
	MaxOutputTokens int                     `json:"maxOutputTokens"`
	Pricing         *RuntimeProviderPricing `json:"pricing"`
	ProviderKind    string                  `json:"providerKind"`
	IsDefault       bool                    `json:"isDefault"`
}

type RuntimeMediaCapabilities struct {
	Providers []RuntimeMediaProviderCapability `json:"providers"`
}

type TurnCapabilities struct {
	Provider RuntimeProviderCapability `json:"provider"`
	Media    RuntimeMediaCapabilities  `json:"media"`
	Plugins  map[string]any            `json:"plugins"`
	Skills   []map[string]any          `json:"skills"`
	Memories []UserMemory              `json:"memories"`
}

type TurnCapabilityResolver interface {
	ResolveTurn(context.Context, AuthContext, *string, []ConversationPluginSelection) (TurnCapabilities, error)
	ResolveProvider(context.Context, AuthContext, *string) (RuntimeProviderCapability, error)
	ResolvePlugins(context.Context, AuthContext, []ConversationPluginSelection) (map[string]any, error)
}
