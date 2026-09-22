package canvasstoryboard

import (
	"encoding/json"
	"testing"

	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
)

func TestDecodeStateRequiresCanvasNodeIdentity(t *testing.T) {
	t.Parallel()

	row := nodeRow{
		ID:        mustParseID(t, "01a0c7ee-35b9-7bd3-86c5-6d2f16e64d97"),
		ProjectID: mustParseID(t, "01a0c7ec-5bd5-721b-8de8-033c61775d45"),
		CanvasID:  mustParseID(t, "01a0c7ee-2e16-70a4-9c83-5c28f1de4af9"),
	}
	state := applicationcanvas.StoryboardSession{
		ID: row.ID.String(), ProjectID: row.ProjectID.String(), CanvasID: row.CanvasID.String(), Plot: "plot",
	}
	payload, err := json.Marshal(storyboardPayload{Version: 1, Plot: state.Plot, Session: state})
	if err != nil {
		t.Fatal(err)
	}
	row.NodeData, err = json.Marshal(nodeDocument{Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = decodeState(row); err != nil {
		t.Fatalf("decodeState() error = %v", err)
	}

	state.CanvasID = mustParseID(t, "01a0c7ee-2e16-70a4-9c83-5c28f1de4afa").String()
	payload, err = json.Marshal(storyboardPayload{Version: 1, Plot: state.Plot, Session: state})
	if err != nil {
		t.Fatal(err)
	}
	row.NodeData, err = json.Marshal(nodeDocument{Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = decodeState(row); err == nil {
		t.Fatal("decodeState() accepted a payload for another Canvas")
	}
}

func mustParseID(t *testing.T, value string) persistenceid.UUID {
	t.Helper()
	id, err := persistenceid.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
