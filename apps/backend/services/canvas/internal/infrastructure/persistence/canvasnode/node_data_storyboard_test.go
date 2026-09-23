package canvasnode

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
)

func TestStoryboardDraftNodeDataRoundTrip(t *testing.T) {
	t.Parallel()

	newNode := func(t *testing.T) domain.CanvasNode {
		t.Helper()
		node, err := domain.NewCanvasNode(domain.CanvasNodeInput{
			ID: "0199a716-c892-748d-a222-8e1029407029", TenantID: "tenant",
			ProjectID: "0199a716-c892-748d-a222-8e1029407030", CanvasID: "0199a716-c892-748d-a222-8e1029407031",
			CreatedBy: "user", Type: domain.NodeTypeStoryboardDraft,
			Name: domain.DefaultCanvasNodeName(domain.NodeTypeStoryboardDraft), Prompt: "第一场：雨夜追逐",
			Position: domain.Position{PositionX: 20, PositionY: 30}, Now: time.Now().UTC(),
		})
		if err != nil {
			t.Fatalf("NewCanvasNode() error = %v", err)
		}
		return node
	}

	t.Run("encodes the base document", func(t *testing.T) {
		node := newNode(t)
		encoded, err := encodeCanvasNodeData(node)
		if err != nil {
			t.Fatalf("encodeCanvasNodeData() error = %v", err)
		}
		document, payload, err := decodeCanvasNodeData(domain.NodeTypeStoryboardDraft, encoded)
		if err != nil {
			t.Fatalf("decodeCanvasNodeData() error = %v", err)
		}
		draft, ok := payload.(*canvasNodeStoryboardDraftPayload)
		if !ok {
			t.Fatalf("payload type = %T", payload)
		}
		if draft.Plot != node.Prompt || draft.Version != 1 {
			t.Fatalf("payload = %#v", draft)
		}
		if document.Position.X != 20 || document.Position.Y != 30 {
			t.Fatalf("position = %#v", document.Position)
		}
	})

	t.Run("preserves session state when position changes", func(t *testing.T) {
		node := newNode(t)
		row, err := toRow(node)
		if err != nil {
			t.Fatalf("toRow() error = %v", err)
		}

		var document map[string]json.RawMessage
		if err = json.Unmarshal(row.NodeData, &document); err != nil {
			t.Fatalf("decode document: %v", err)
		}
		payload := map[string]any{
			"version": 1,
			"plot":    node.Prompt,
			"session": map[string]any{"id": node.ID, "status": "running"},
			"generation": map[string]any{
				"protocol_version":        2,
				"next_model_call_ordinal": 3,
			},
		}
		document["payload"], err = json.Marshal(payload)
		if err != nil {
			t.Fatalf("encode payload: %v", err)
		}
		row.NodeData, err = json.Marshal(document)
		if err != nil {
			t.Fatalf("encode document: %v", err)
		}

		loaded, err := fromRow(row)
		if err != nil {
			t.Fatalf("fromRow() error = %v", err)
		}
		position := domain.Position{PositionX: -132, PositionY: -143}
		if err = loaded.Update(domain.UpdatePatch{Position: &position}, "user", time.Now().UTC()); err != nil {
			t.Fatalf("CanvasNode.Update() error = %v", err)
		}
		updated, err := encodeCanvasNodeDataForUpdate(loaded, row.NodeData)
		if err != nil {
			t.Fatalf("encodeCanvasNodeDataForUpdate() error = %v", err)
		}

		var updatedDocument struct {
			Payload map[string]json.RawMessage `json:"payload"`
		}
		if err = json.Unmarshal(updated, &updatedDocument); err != nil {
			t.Fatalf("decode updated document: %v", err)
		}
		for _, field := range []string{"session", "generation"} {
			want, wantOK := documentPayloadField(t, document["payload"], field)
			got, gotOK := updatedDocument.Payload[field]
			if !gotOK || !wantOK || !reflect.DeepEqual(got, want) {
				t.Errorf("payload %s = %s, want %s", field, got, want)
			}
		}
	})
}

func documentPayloadField(t *testing.T, encoded json.RawMessage, field string) (json.RawMessage, bool) {
	t.Helper()
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	value, ok := payload[field]
	return value, ok
}
