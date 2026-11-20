package application

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizePluginSelectionsEncodesEmptySelectionAsJSONArray(t *testing.T) {
	selections, err := normalizePluginSelections(nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(selections)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("empty plugin selections = %s, want []", encoded)
	}
}

type sagaRepositoryStub struct {
	reserve       func(ConversationIntent) (Conversation, error)
	bind          func(string, string) (Conversation, error)
	recordFailure func(string, ConversationState, error) error
	get           func(string) (*Conversation, error)
	beginDelete   func(string) (*Conversation, error)
	complete      func(string, string) error
}

func (*sagaRepositoryStub) Ping(context.Context) error { return nil }
func (*sagaRepositoryStub) Close()                     {}
func (stub *sagaRepositoryStub) Reserve(_ context.Context, _ AuthContext, intent ConversationIntent) (Conversation, error) {
	return stub.reserve(intent)
}
func (stub *sagaRepositoryStub) BindRuntimeThread(_ context.Context, _ AuthContext, id, threadID string) (Conversation, error) {
	return stub.bind(id, threadID)
}
func (stub *sagaRepositoryStub) RecordSagaFailure(_ context.Context, _ AuthContext, id string, state ConversationState, cause error) error {
	return stub.recordFailure(id, state, cause)
}
func (*sagaRepositoryStub) List(context.Context, AuthContext) ([]Conversation, error) {
	return nil, nil
}
func (stub *sagaRepositoryStub) Get(_ context.Context, _ AuthContext, id string) (*Conversation, error) {
	return stub.get(id)
}
func (*sagaRepositoryStub) UpdateTitle(context.Context, AuthContext, string, string) (*Conversation, error) {
	return nil, nil
}
func (*sagaRepositoryStub) UpdateTitleIfDefault(context.Context, AuthContext, string, string) (*Conversation, error) {
	return nil, nil
}
func (stub *sagaRepositoryStub) BeginDelete(_ context.Context, _ AuthContext, id string) (*Conversation, error) {
	return stub.beginDelete(id)
}
func (stub *sagaRepositoryStub) CompleteDelete(_ context.Context, _ AuthContext, id, threadID string) error {
	return stub.complete(id, threadID)
}

type sagaRuntimeStub struct {
	do func(RuntimeRequest) (*http.Response, error)
}

func (stub *sagaRuntimeStub) Do(_ context.Context, request RuntimeRequest) (*http.Response, error) {
	return stub.do(request)
}

func sagaScope() AuthContext {
	return AuthContext{UserID: "user", TenantID: "tenant", WorkspaceID: "workspace"}
}

func pendingConversation(intent ConversationIntent) Conversation {
	return Conversation{
		ID:                   "conversation",
		State:                ConversationCreating,
		Operation:            intent.Operation,
		CreateRequestID:      intent.Input.RequestID,
		CreateFingerprint:    intent.CreateFingerprint,
		RuntimeRequest:       append([]byte(nil), intent.RuntimeRequest...),
		SourceConversationID: intent.SourceConversationID,
		SourceMessageID:      intent.SourceMessageID,
		UserID:               "user",
		TenantID:             "tenant",
		WorkspaceID:          "workspace",
		Title:                "新对话",
		PluginSelections:     clonePluginSelections(intent.Input.PluginSelections),
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}
}

func runtimeJSON(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestCreateConversationReservesBeforeRuntimeAndBindsThread(t *testing.T) {
	approvalPolicy := "on-request"
	permissionProfile := ":workspace"
	var order []string
	var reserved Conversation
	repository := &sagaRepositoryStub{
		reserve: func(intent ConversationIntent) (Conversation, error) {
			order = append(order, "reserve")
			reserved = pendingConversation(intent)
			return reserved, nil
		},
		bind: func(id, threadID string) (Conversation, error) {
			order = append(order, "bind")
			if id != reserved.ID || threadID != "runtime-thread" {
				t.Fatalf("bind = (%q, %q)", id, threadID)
			}
			reserved.State = ConversationReady
			reserved.RuntimeThreadID = threadID
			return reserved, nil
		},
		recordFailure: func(string, ConversationState, error) error {
			t.Fatal("unexpected saga failure")
			return nil
		},
	}
	runtime := &sagaRuntimeStub{do: func(request RuntimeRequest) (*http.Response, error) {
		order = append(order, "runtime")
		if request.Method != http.MethodPost || request.Path != "/v1/sessions" {
			t.Fatalf("Runtime request = %s %s", request.Method, request.Path)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		var input CreateConversationInput
		if err := json.Unmarshal(body, &input); err != nil {
			t.Fatal(err)
		}
		if input.RequestID != "request-1234" {
			t.Fatalf("request id = %q", input.RequestID)
		}
		if input.ApprovalPolicy == nil || *input.ApprovalPolicy != approvalPolicy ||
			input.PermissionProfile == nil || *input.PermissionProfile != permissionProfile {
			t.Fatalf("execution policy = (%v, %v)", input.ApprovalPolicy, input.PermissionProfile)
		}
		return runtimeJSON(http.StatusCreated, `{"id":"runtime-thread"}`), nil
	}}

	result, err := NewService(repository, runtime).Create(
		context.Background(), sagaScope(), make(http.Header), CreateConversationInput{
			RequestID: "request-1234", ApprovalPolicy: &approvalPolicy, PermissionProfile: &permissionProfile,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result["id"] != "conversation" {
		t.Fatalf("result id = %#v", result["id"])
	}
	if strings.Join(order, ",") != "reserve,runtime,bind" {
		t.Fatalf("order = %v", order)
	}
}

func TestCreateCanvasConversationNormalizesProductBindingIntoPluginSelection(t *testing.T) {
	var reserved Conversation
	repository := &sagaRepositoryStub{
		reserve: func(intent ConversationIntent) (Conversation, error) {
			want := []ConversationPluginSelection{{
				PluginID: canvasPluginID,
				Bindings: map[string]string{"project_id": "project", "canvas_id": "canvas"},
			}}
			if !reflect.DeepEqual(intent.Input.PluginSelections, want) {
				t.Fatalf("plugin selections = %#v, want %#v", intent.Input.PluginSelections, want)
			}
			reserved = pendingConversation(intent)
			return reserved, nil
		},
		bind: func(_ string, threadID string) (Conversation, error) {
			reserved.State = ConversationReady
			reserved.RuntimeThreadID = threadID
			return reserved, nil
		},
		recordFailure: func(string, ConversationState, error) error {
			t.Fatal("unexpected saga failure")
			return nil
		},
	}
	runtime := &sagaRuntimeStub{do: func(request RuntimeRequest) (*http.Response, error) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		var input map[string]any
		if err := json.Unmarshal(body, &input); err != nil {
			t.Fatal(err)
		}
		if _, exists := input["plugin_selections"]; exists {
			t.Fatalf("Runtime Thread input leaked Chat plugin selections: %#v", input)
		}
		return runtimeJSON(http.StatusCreated, `{"id":"runtime-thread"}`), nil
	}}

	result, err := NewService(repository, runtime).CreateCanvas(
		context.Background(), sagaScope(), make(http.Header),
		CreateCanvasConversationInput{RequestID: "request-1234", ProjectID: "project", CanvasID: "canvas"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result["id"] != "conversation" || result["project_id"] != "project" || result["canvas_id"] != "canvas" {
		t.Fatalf("Canvas binding = %#v", result)
	}
}

func TestConversationIntentFingerprintIncludesCanonicalPluginSelections(t *testing.T) {
	left, err := createConversationIntent(CreateConversationInput{
		RequestID: "request-1234",
		PluginSelections: []ConversationPluginSelection{
			{PluginID: "knowledge@platform"},
			{PluginID: "canvas@platform", Bindings: map[string]string{"canvas_id": "canvas", "project_id": "project"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	right, err := createConversationIntent(CreateConversationInput{
		RequestID: "request-1234",
		PluginSelections: []ConversationPluginSelection{
			{PluginID: "canvas@platform", Bindings: map[string]string{"project_id": "project", "canvas_id": "canvas"}},
			{PluginID: "knowledge@platform"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if left.CreateFingerprint != right.CreateFingerprint {
		t.Fatalf("equivalent selection order changed fingerprint: %q != %q", left.CreateFingerprint, right.CreateFingerprint)
	}

	changed, err := createConversationIntent(CreateConversationInput{
		RequestID: "request-1234",
		PluginSelections: []ConversationPluginSelection{{
			PluginID: "canvas@platform", Bindings: map[string]string{"project_id": "project", "canvas_id": "other"},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if left.CreateFingerprint == changed.CreateFingerprint {
		t.Fatal("different plugin bindings reused the same conversation fingerprint")
	}
}

func TestCreateConversationPersistsRuntimeFailureWithoutBinding(t *testing.T) {
	runtimeFailure := errors.New("Runtime unavailable")
	failureRecorded := false
	repository := &sagaRepositoryStub{
		reserve: func(intent ConversationIntent) (Conversation, error) { return pendingConversation(intent), nil },
		bind: func(string, string) (Conversation, error) {
			t.Fatal("failed Runtime request must not bind")
			return Conversation{}, nil
		},
		recordFailure: func(id string, state ConversationState, cause error) error {
			failureRecorded = true
			if id != "conversation" || state != ConversationCreating || !errors.Is(cause, runtimeFailure) {
				t.Fatalf("failure = (%q, %q, %v)", id, state, cause)
			}
			return nil
		},
	}
	runtime := &sagaRuntimeStub{do: func(RuntimeRequest) (*http.Response, error) { return nil, runtimeFailure }}

	_, err := NewService(repository, runtime).Create(
		context.Background(), sagaScope(), make(http.Header), CreateConversationInput{RequestID: "request-1234"},
	)
	if !errors.Is(err, runtimeFailure) {
		t.Fatalf("error = %v", err)
	}
	if !failureRecorded {
		t.Fatal("saga failure was not persisted")
	}
}

func TestDeleteConversationKeepsIntentUntilRuntimeConfirmsAbsence(t *testing.T) {
	order := make([]string, 0, 3)
	ready := Conversation{
		ID: "conversation", State: ConversationReady, Operation: ConversationCreate, RuntimeThreadID: "runtime-thread",
		UserID: "user", TenantID: "tenant", WorkspaceID: "workspace",
	}
	repository := &sagaRepositoryStub{
		get: func(string) (*Conversation, error) {
			value := ready
			return &value, nil
		},
		beginDelete: func(id string) (*Conversation, error) {
			order = append(order, "begin")
			value := ready
			value.State = ConversationDeleting
			return &value, nil
		},
		complete: func(id, threadID string) error {
			order = append(order, "complete")
			if id != ready.ID || threadID != ready.RuntimeThreadID {
				t.Fatalf("complete = (%q, %q)", id, threadID)
			}
			return nil
		},
		recordFailure: func(string, ConversationState, error) error {
			t.Fatal("unexpected delete failure")
			return nil
		},
	}
	runtime := &sagaRuntimeStub{do: func(request RuntimeRequest) (*http.Response, error) {
		order = append(order, "runtime")
		if request.Method != http.MethodDelete || request.Path != "/v1/sessions/runtime-thread" {
			t.Fatalf("Runtime request = %s %s", request.Method, request.Path)
		}
		return &http.Response{StatusCode: http.StatusNotFound, Header: make(http.Header), Body: http.NoBody}, nil
	}}

	if err := NewService(repository, runtime).Delete(
		context.Background(), sagaScope(), make(http.Header), ready.ID,
	); err != nil {
		t.Fatal(err)
	}
	if strings.Join(order, ",") != "begin,runtime,complete" {
		t.Fatalf("order = %v", order)
	}
}

func TestForkConversationReservesDurableRequestBeforeRuntime(t *testing.T) {
	order := make([]string, 0, 3)
	source := Conversation{
		ID: "source", State: ConversationReady, Operation: ConversationCreate, RuntimeThreadID: "source-thread",
		UserID: "user", TenantID: "tenant", WorkspaceID: "workspace", Title: "Source",
		PluginSelections: []ConversationPluginSelection{{
			PluginID: "canvas@platform", Bindings: map[string]string{"project_id": "project", "canvas_id": "canvas"},
		}},
	}
	var reserved Conversation
	repository := &sagaRepositoryStub{
		get: func(id string) (*Conversation, error) {
			if id != source.ID {
				t.Fatalf("source id = %q", id)
			}
			value := source
			return &value, nil
		},
		reserve: func(intent ConversationIntent) (Conversation, error) {
			order = append(order, "reserve")
			if intent.Operation != ConversationFork || intent.SourceConversationID == nil || *intent.SourceConversationID != source.ID ||
				intent.SourceMessageID == nil || *intent.SourceMessageID != "message" {
				t.Fatalf("fork intent = %#v", intent)
			}
			if !reflect.DeepEqual(intent.Input.PluginSelections, source.PluginSelections) {
				t.Fatalf("fork plugin selections = %#v, want %#v", intent.Input.PluginSelections, source.PluginSelections)
			}
			reserved = pendingConversation(intent)
			return reserved, nil
		},
		bind: func(id, threadID string) (Conversation, error) {
			order = append(order, "bind")
			reserved.State = ConversationReady
			reserved.RuntimeThreadID = threadID
			return reserved, nil
		},
		recordFailure: func(string, ConversationState, error) error {
			t.Fatal("unexpected fork failure")
			return nil
		},
	}
	runtime := &sagaRuntimeStub{do: func(request RuntimeRequest) (*http.Response, error) {
		order = append(order, "runtime")
		if request.Path != "/v1/sessions/source-thread/forks" {
			t.Fatalf("fork path = %q", request.Path)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		var input map[string]string
		if err := json.Unmarshal(body, &input); err != nil {
			t.Fatal(err)
		}
		if input["message_id"] != "message" || input["request_id"] != "fork-request" {
			t.Fatalf("fork body = %#v", input)
		}
		return runtimeJSON(http.StatusCreated, `{"id":"fork-thread","source_message_id":"message"}`), nil
	}}

	result, err := NewService(repository, runtime).Fork(
		context.Background(), sagaScope(), make(http.Header), source.ID, "message", "fork-request",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result["id"] != "conversation" || result["source_message_id"] != "message" {
		t.Fatalf("fork result = %#v", result)
	}
	if strings.Join(order, ",") != "reserve,runtime,bind" {
		t.Fatalf("order = %v", order)
	}
}
