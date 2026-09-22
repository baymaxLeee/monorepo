package canvasgeneration

import (
	"testing"

	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
	domaintask "github.com/example/monorepo/canvas/internal/domain/task"
)

func TestGenerationRunMatchesStoryboardDraftNode(t *testing.T) {
	t.Parallel()

	if !generationRunMatchesNode(domaintask.RunTypeCanvasStoryboardGeneration, domaincanvas.NodeTypeStoryboardDraft) {
		t.Fatal("storyboard run must match its temporary canvas node")
	}
	if generationRunMatchesNode(domaintask.RunTypeCanvasNodeVideoGeneration, domaincanvas.NodeTypeStoryboardDraft) {
		t.Fatal("video generation run must not match a storyboard draft node")
	}
}
