package http

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
)

type storyboardDraftServiceSpy struct {
	startCalls int
	listed     []applicationcanvas.StoryboardSession
}

func (s *storyboardDraftServiceSpy) Start(
	context.Context,
	applicationcanvas.Scope,
	string,
	string,
	string,
	applicationcanvas.StoryboardModelConfig,
	applicationcanvas.StoryboardPlanningConfig,
	int,
) (applicationcanvas.StoryboardSession, error) {
	s.startCalls++
	return applicationcanvas.StoryboardSession{ID: "manual-run", Status: applicationcanvas.StoryboardStatusQueued}, nil
}

func (s *storyboardDraftServiceSpy) List(context.Context, applicationcanvas.Scope, string, string) ([]applicationcanvas.StoryboardSession, error) {
	return s.listed, nil
}

func TestStoryboardDraftSessionIsProjectedOnItsTemporaryNode(t *testing.T) {
	spy := &storyboardDraftServiceSpy{listed: []applicationcanvas.StoryboardSession{{
		ID: "draft-node-1", Plot: "plot", Status: applicationcanvas.StoryboardStatusCompleted,
		Drafts: []applicationcanvas.Draft{{ID: "shot-1", CanvasNodeNo: 1, Prompt: "prompt", DurationSeconds: 5}},
	}}}
	handler := &CanvasNodeHandler{drafts: spy}
	nodes := []*contractcanvasnode.CanvasNode{
		{NodeID: "draft-node-1", Type: contractcanvasnode.CanvasNodeType_STORYBOARD_DRAFT},
		{NodeID: "video-node-1", Type: contractcanvasnode.CanvasNodeType_VIDEO_GENERATION},
	}

	if err := handler.attachStoryboardDraftSessions(context.Background(), applicationcanvas.Scope{}, "project-1", "canvas-1", nodes); err != nil {
		t.Fatalf("attachStoryboardDraftSessions returned error: %v", err)
	}
	if nodes[0].DraftSession == nil || nodes[0].DraftSession.TaskRunID != "draft-node-1" || len(nodes[0].DraftSession.CanvasNodes) != 1 {
		t.Fatalf("draft session was not attached to its node: %#v", nodes[0].DraftSession)
	}
	if nodes[1].DraftSession != nil {
		t.Fatalf("non-draft node received a draft session: %#v", nodes[1].DraftSession)
	}

	payload, err := json.Marshal(&contractcanvasnode.BatchGetCanvasNodeStatesResponse{Items: []*contractcanvasnode.CanvasNodeState{}})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	if strings.Contains(string(payload), "DraftSessions") || strings.Contains(string(payload), "draft_sessions") {
		t.Fatalf("legacy draft session collection leaked into batch protocol: %s", payload)
	}
}

func (*storyboardDraftServiceSpy) Cancel(context.Context, applicationcanvas.Scope, string, string, string) error {
	return nil
}

func (*storyboardDraftServiceSpy) Confirm(context.Context, applicationcanvas.Scope, string, string, string, []applicationcanvas.StoryboardOverride) ([]domaincanvas.CanvasNode, int64, error) {
	return nil, 0, nil
}

func TestCreateCanvasNodesAlwaysUsesCanvasPlanner(t *testing.T) {
	spy := &storyboardDraftServiceSpy{}
	handler := &CanvasNodeHandler{drafts: spy}

	response, err := handler.CreateCanvasNodes(storyboardHandlerContext(), &contractcanvasnode.CreateCanvasNodesRequest{
		ProjectID: "project-1", CanvasID: "canvas-1", Plot: "manual plot",
	})
	if err != nil {
		t.Fatalf("CreateCanvasNodes returned error: %v", err)
	}
	if spy.startCalls != 1 {
		t.Fatalf("unexpected Start calls: %d", spy.startCalls)
	}
	if response.Session == nil || response.Session.TaskRunID != "manual-run" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func storyboardHandlerContext() context.Context {
	return requestcontext.WithMetadata(context.Background(), requestcontext.Metadata{
		TenantID: "tenant-1", UserID: "user-1", Service: "canvas-test",
		Action: "CreateCanvasNodes", Version: projectAPIVersion,
	})
}
