package provider

import (
	"testing"

	applicationmodel "github.com/example/monorepo/canvas/internal/application/model"
)

func TestStoryboardRequestForcesNativeFunctionCall(t *testing.T) {
	request := storyboardForcedToolRequest(
		applicationmodel.Selection{ModelID: "provider-1"},
		[]byte(`{"type":"object"}`),
		"create_canvas_nodes",
		"Create storyboard nodes",
		nil,
	)

	if len(request.Tools) != 1 {
		t.Fatalf("expected exactly one function tool, got %d", len(request.Tools))
	}
	tool := request.Tools[0].GetToolFunction()
	if tool == nil || tool.GetName() != "create_canvas_nodes" || !tool.GetStrict() {
		t.Fatalf("unexpected storyboard function tool: %#v", tool)
	}
	choice := request.ToolChoice.GetFunctionToolChoice()
	if choice == nil || choice.GetName() != "create_canvas_nodes" {
		t.Fatalf("storyboard request did not force create_canvas_nodes: %#v", choice)
	}
	if request.GetParallelToolCalls() {
		t.Fatal("storyboard request must not allow parallel tool calls")
	}
	if request.Store == nil || *request.Store {
		t.Fatal("storyboard provider request must not persist a provider-side conversation")
	}
}
