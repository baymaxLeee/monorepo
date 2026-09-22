package canvasnode

import (
	"testing"
	"time"

	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
)

func TestStoryboardDraftNodeDataRoundTrip(t *testing.T) {
	t.Parallel()

	node, err := domain.NewCanvasNode(domain.CanvasNodeInput{
		ID: "draft-node", TenantID: "tenant", ProjectID: "project", CanvasID: "canvas",
		CreatedBy: "user", Type: domain.NodeTypeStoryboardDraft,
		Name: domain.DefaultCanvasNodeName(domain.NodeTypeStoryboardDraft), Prompt: "第一场：雨夜追逐",
		Position: domain.Position{PositionX: 20, PositionY: 30}, Now: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("NewCanvasNode() error = %v", err)
	}

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
}
