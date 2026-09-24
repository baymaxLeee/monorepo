package assetclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCreateUploadSessionUsesAssetIntentContract(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/internal/upload-sessions" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("X-Caller-Service") != callerService || request.Header.Get("X-Internal-Token") != "token" {
			t.Fatalf("service identity headers = %#v", request.Header)
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["intent_id"] != "intent" {
			t.Fatalf("intent_id = %#v", payload["intent_id"])
		}
		if _, exists := payload["idempotency_key"]; exists {
			t.Fatalf("unexpected legacy idempotency_key in payload: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"upload_session_id": "session", "intent_id": "intent", "state": "pending", "user_id": "user",
			"category": "canvas-cover", "filename": "cover.png", "media_type": "image/png", "size_bytes": 128,
			"expires_at": time.Now().UTC().Add(time.Hour), "upload_url": "/api/asset-server/upload-sessions/session/content",
		})
	}))
	t.Cleanup(server.Close)

	client := New(server.URL, "token", server.Client())
	session, err := client.CreateUploadSession(context.Background(), CreateUploadSessionInput{
		TenantID: "tenant", WorkspaceID: "workspace", UserID: "user", Filename: "cover.png",
		MediaType: "image/png", Category: "canvas-cover", IdempotencyKey: "intent", SizeBytes: 128,
	})
	if err != nil {
		t.Fatalf("CreateUploadSession() error = %v", err)
	}
	if session.UploadSessionID != "session" || session.IntentID != "intent" {
		t.Fatalf("session = %#v", session)
	}
}
