package canvasstream

import (
	"reflect"
	"testing"
	"time"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
)

func TestDiffPublishesUTF8TextSuffixAndTerminalCheckpoint(t *testing.T) {
	before := State{Texts: []TextCheckpoint{{NodeID: "node-1", TaskRunID: "run-1", Content: "你", Offset: 3, Status: "running"}}}
	current := State{Texts: []TextCheckpoint{{NodeID: "node-1", TaskRunID: "run-1", Content: "你好", Offset: 6, Status: "succeeded"}}}

	change := mustDiff(t, before, current)
	if !change.Changed || change.StructuralChanged || !change.TerminalText || change.TextBytes != 3 ||
		len(change.Event.Patches) != 2 || change.Event.Patches[0].TextDelta == nil ||
		change.Event.Patches[0].TextDelta.Content != "好" || change.Event.Patches[0].TextDelta.StartOffset != 3 || change.Event.Patches[0].TextDelta.EndOffset != 6 {
		t.Fatalf("diff = %+v", change)
	}
	if len(change.Event.Patches) != 2 || change.Event.Patches[0].Kind != PatchTextAppend ||
		change.Event.Patches[1].Kind != PatchTextStatus {
		t.Fatalf("text patches = %+v", change.Event.Patches)
	}
}

func TestDiffPublishesTaskOnlyChangeWithoutInventingNodePatch(t *testing.T) {
	node := domain.CanvasNode{ID: "node-1", Revision: 3}
	before := State{
		Nodes:       []domain.CanvasNode{node},
		NodeNumbers: map[string]int32{},
		Tasks:       []TaskState{{NodeID: node.ID, TaskRunID: "run-1", Status: "queued"}},
	}
	current := before
	current.Tasks = []TaskState{{NodeID: node.ID, TaskRunID: "run-1", Status: "failed", ErrorMessage: "failed"}}

	change := mustDiff(t, before, current)
	if !change.Changed || !change.StructuralChanged {
		t.Fatalf("task-only diff = %+v", change)
	}
	if len(change.Event.Patches) != 1 || change.Event.Patches[0].Kind != PatchTaskUpsert ||
		change.Event.Patches[0].Task == nil || change.Event.Patches[0].Task.Status != "failed" {
		t.Fatalf("task patch = %+v", change.Event.Patches)
	}
}

func TestDiffIgnoresTransportMetadata(t *testing.T) {
	state := State{Nodes: []domain.CanvasNode{}, NodeNumbers: map[string]int32{}}
	before := state
	before.Cursor = 7

	change := mustDiff(t, before, state)
	if change.Changed {
		t.Fatalf("transport metadata changed projection: %+v", change)
	}
}

func TestDiffRejectsNonAppendTextMutation(t *testing.T) {
	before := State{Texts: []TextCheckpoint{{NodeID: "node-1", TaskRunID: "run-1", Content: "hello", Offset: 5, Status: "running"}}}
	current := State{Texts: []TextCheckpoint{{NodeID: "node-1", TaskRunID: "run-1", Content: "jello!", Offset: 6, Status: "running"}}}
	if _, err := Diff(before, current); err == nil {
		t.Fatal("Diff() accepted a non-append text mutation")
	}
}

func mustDiff(t *testing.T, before, current State) Change {
	t.Helper()
	change, err := Diff(before, current)
	if err != nil {
		t.Fatal(err)
	}
	return change
}

func TestDiffReviewsHaveIndependentPayloadAndClearOnRemoval(t *testing.T) {
	node := domain.CanvasNode{ID: "node", AssetID: "asset", Revision: 4}
	before := State{Nodes: []domain.CanvasNode{node}, NodeReviews: []NodeReviews{{NodeID: "node", AssetID: "asset", Reviews: []domainasset.Review{{PackageID: "package", Status: domainasset.ReviewStatusSubmitting}}}}}
	current := before
	current.NodeReviews = []NodeReviews{{NodeID: "node", AssetID: "asset", Reviews: []domainasset.Review{{PackageID: "package", Status: domainasset.ReviewStatusApproved}}}}
	change := mustDiff(t, before, current)
	if len(change.Event.Patches) != 1 || change.Event.Patches[0].Kind != PatchNodeReviewsUpsert || change.Event.Patches[0].NodeReviews.Reviews[0].Status != domainasset.ReviewStatusApproved {
		t.Fatalf("review change=%+v", change)
	}
	current.NodeReviews = nil
	change = mustDiff(t, before, current)
	if len(change.Event.Patches) != 1 || change.Event.Patches[0].Kind != PatchNodeReviewsRemove {
		t.Fatalf("review removal=%+v", change)
	}
}

func TestStabilizeReviewTimestampsPreservesVisibleChanges(t *testing.T) {
	now := time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)
	prior := domainasset.Review{PackageID: "package", Status: domainasset.ReviewStatusSubmitting, CreatedAt: now, UpdatedAt: now}
	for _, tc := range []struct {
		name       string
		change     func(*NodeReviews)
		wantChange bool
	}{
		{"only audit time", func(*NodeReviews) {}, false},
		{"processing", func(n *NodeReviews) { n.Reviews[0].Status = domainasset.ReviewStatusProcessing }, true},
		{"approved", func(n *NodeReviews) { n.Reviews[0].Status = domainasset.ReviewStatusApproved }, true},
		{"failed", func(n *NodeReviews) {
			n.Reviews[0].Status = domainasset.ReviewStatusFailed
			n.Reviews[0].FailureReason = "素材未通过合规审核"
		}, true},
		{"rate limit reason", func(n *NodeReviews) { n.Reviews[0].FailureReason = "Ark 限流等待中" }, true},
		{"resubmission", func(n *NodeReviews) { n.Reviews[0].CreatedAt = now.Add(time.Second) }, true},
		{"model coverage", func(n *NodeReviews) { n.Reviews[0].ModelIDs = []string{"model"} }, true},
		{"provider identity", func(n *NodeReviews) { n.Reviews[0].ProviderAssetID = "provider" }, true},
		{"content replacement", func(n *NodeReviews) { n.AssetID = "new-asset" }, true},
		{"package added", func(n *NodeReviews) {
			n.Reviews = append(n.Reviews, domainasset.Review{PackageID: "second", Status: domainasset.ReviewStatusFailed})
		}, true},
		{"reviews cleared", func(n *NodeReviews) { n.Reviews = []domainasset.Review{} }, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := State{NodeReviews: []NodeReviews{{NodeID: "node", AssetID: "asset", Reviews: []domainasset.Review{prior}}}}
			nextReview := prior
			nextReview.UpdatedAt = now.Add(time.Second)
			current := State{NodeReviews: []NodeReviews{{NodeID: "node", AssetID: "asset", Reviews: []domainasset.Review{nextReview}}}}
			tc.change(&current.NodeReviews[0])
			normalized := StabilizeReviewTimestamps(before, current)
			change := mustDiff(t, before, normalized)
			if change.Changed != tc.wantChange {
				t.Fatalf("change=%+v", change)
			}
			if len(current.NodeReviews[0].Reviews) > 0 && !current.NodeReviews[0].Reviews[0].UpdatedAt.Equal(nextReview.UpdatedAt) {
				t.Fatal("mutated source audit time")
			}
			if !tc.wantChange {
				// An unrelated node change must not smuggle a new review timestamp into
				// its checkpoint without the matching review patch.
				normalized.Nodes = []domain.CanvasNode{{ID: "other", Name: "renamed"}}
				change = mustDiff(t, before, normalized)
				if len(change.Event.Patches) != 1 || change.Event.Patches[0].Kind != PatchNodeUpsert || !reflect.DeepEqual(normalized.NodeReviews, before.NodeReviews) {
					t.Fatalf("unrelated change=%+v", change)
				}
			}
		})
	}
}
