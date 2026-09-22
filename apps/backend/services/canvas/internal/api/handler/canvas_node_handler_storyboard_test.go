package http

import (
	"context"
	"testing"

	contractcanvasnode "github.com/example/monorepo/canvas/internal/api/contracts/canvasnode"
	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	applicationcanvas "github.com/example/monorepo/canvas/internal/application/canvas"
	domaincanvas "github.com/example/monorepo/canvas/internal/domain/canvas"
)

type storyboardDraftServiceSpy struct {
	startCalls         int
	startPreparedCalls int
	preparedDrafts     []applicationcanvas.Draft
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

func (s *storyboardDraftServiceSpy) StartPrepared(
	_ context.Context,
	_ applicationcanvas.Scope,
	_, _, _ string,
	_ applicationcanvas.StoryboardModelConfig,
	_ applicationcanvas.StoryboardPlanningConfig,
	drafts []applicationcanvas.Draft,
) (applicationcanvas.StoryboardSession, error) {
	s.startPreparedCalls++
	s.preparedDrafts = drafts
	return applicationcanvas.StoryboardSession{ID: "agent-run", Status: applicationcanvas.StoryboardStatusCompleted, Drafts: drafts}, nil
}

func (*storyboardDraftServiceSpy) List(context.Context, applicationcanvas.Scope, string, string) ([]applicationcanvas.StoryboardSession, error) {
	return nil, nil
}

func (*storyboardDraftServiceSpy) Cancel(context.Context, applicationcanvas.Scope, string, string, string) error {
	return nil
}

func (*storyboardDraftServiceSpy) Confirm(context.Context, applicationcanvas.Scope, string, string, string, []applicationcanvas.StoryboardOverride) ([]domaincanvas.CanvasNode, int64, error) {
	return nil, 0, nil
}

func TestCreateCanvasNodesUsesCanvasPlannerWhenDraftsAreAbsent(t *testing.T) {
	spy := &storyboardDraftServiceSpy{}
	handler := &CanvasNodeHandler{drafts: spy}

	response, err := handler.CreateCanvasNodes(storyboardHandlerContext(), &contractcanvasnode.CreateCanvasNodesRequest{
		ProjectID: "project-1", CanvasID: "canvas-1", Plot: "manual plot",
	})
	if err != nil {
		t.Fatalf("CreateCanvasNodes returned error: %v", err)
	}
	if spy.startCalls != 1 || spy.startPreparedCalls != 0 {
		t.Fatalf("unexpected dispatch: Start=%d StartPrepared=%d", spy.startCalls, spy.startPreparedCalls)
	}
	if response.Session == nil || response.Session.TaskRunID != "manual-run" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestCreateCanvasNodesPersistsAgentPreparedDraftsThroughSameEndpoint(t *testing.T) {
	spy := &storyboardDraftServiceSpy{}
	handler := &CanvasNodeHandler{drafts: spy}

	response, err := handler.CreateCanvasNodes(storyboardHandlerContext(), &contractcanvasnode.CreateCanvasNodesRequest{
		ProjectID: "project-1", CanvasID: "canvas-1", Plot: "agent plot",
		CanvasNodes: []*contractcanvasnode.CanvasNodeDraft{{
			DraftID: "draft-1", CanvasNodeNo: 1, Prompt: "wide establishing shot", DurationSeconds: 5,
		}},
	})
	if err != nil {
		t.Fatalf("CreateCanvasNodes returned error: %v", err)
	}
	if spy.startCalls != 0 || spy.startPreparedCalls != 1 || len(spy.preparedDrafts) != 1 {
		t.Fatalf("unexpected dispatch: Start=%d StartPrepared=%d drafts=%d", spy.startCalls, spy.startPreparedCalls, len(spy.preparedDrafts))
	}
	if response.Session == nil || response.Session.TaskRunID != "agent-run" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func storyboardHandlerContext() context.Context {
	return requestcontext.WithMetadata(context.Background(), requestcontext.Metadata{
		TenantID: "tenant-1", UserID: "user-1", Service: "canvas-test",
		Action: "CreateCanvasNodes", Version: projectAPIVersion,
	})
}
