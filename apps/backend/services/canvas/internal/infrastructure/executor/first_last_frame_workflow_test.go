package executor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type frameCommitterStub struct {
	failed []string
}

func (stub *frameCommitterStub) CommitFailure(_ context.Context, taskRunID string) error {
	stub.failed = append(stub.failed, taskRunID)
	return nil
}

type dispatchDeleterStub struct {
	deleted []string
}

func (stub *dispatchDeleterStub) DeleteAsyncDispatch(_ context.Context, taskRunID string) error {
	stub.deleted = append(stub.deleted, taskRunID)
	return nil
}

func TestFirstLastFrameWorkflowReconcileStartsIdempotentExecutorTask(t *testing.T) {
	t.Parallel()
	const taskRunID = "01a0c86f-cd3e-7449-a6ff-63810aed3c44"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/tasks" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		var input struct {
			Type         string            `json:"type"`
			OwnerService string            `json:"owner_service"`
			OwnerRef     string            `json:"owner_ref"`
			Payload      map[string]string `json:"payload"`
		}
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.Type != firstLastFrameTaskType || input.OwnerService != "canvas" || input.OwnerRef != taskRunID || input.Payload["taskRunId"] != taskRunID {
			t.Fatalf("unexpected task input: %#v", input)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"executor-task","status":"completed"}`))
	}))
	defer server.Close()

	frames := &frameCommitterStub{}
	dispatches := &dispatchDeleterStub{}
	store := NewFirstLastFrameWorkflowStore(nil, &Client{URL: server.URL, Token: "token"}, frames, dispatches)
	if err := store.reconcile(context.Background(), taskRunID); err != nil {
		t.Fatal(err)
	}
	if len(frames.failed) != 0 {
		t.Fatalf("successful workflow committed failure: %#v", frames.failed)
	}
	if len(dispatches.deleted) != 1 || dispatches.deleted[0] != taskRunID {
		t.Fatalf("dispatch was not settled: %#v", dispatches.deleted)
	}
}

func TestFirstLastFrameWorkflowReconcileConvergesFailure(t *testing.T) {
	t.Parallel()
	const taskRunID = "01a0c871-3b8e-7af0-9556-b9165fa82908"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"executor-task","status":"failed"}`))
	}))
	defer server.Close()

	frames := &frameCommitterStub{}
	dispatches := &dispatchDeleterStub{}
	store := NewFirstLastFrameWorkflowStore(nil, &Client{URL: server.URL, Token: "token"}, frames, dispatches)
	if err := store.reconcile(context.Background(), taskRunID); err != nil {
		t.Fatal(err)
	}
	if len(frames.failed) != 1 || frames.failed[0] != taskRunID {
		t.Fatalf("failed workflow was not converged: %#v", frames.failed)
	}
	if len(dispatches.deleted) != 1 || dispatches.deleted[0] != taskRunID {
		t.Fatalf("dispatch was not settled: %#v", dispatches.deleted)
	}
}
