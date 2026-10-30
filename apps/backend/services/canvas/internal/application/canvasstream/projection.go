package canvasstream

import (
	"fmt"
	canvas "github.com/example/monorepo/canvas/internal/application/canvas"
	archive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	"reflect"
	"slices"
	"sort"
	"strings"

	domainasset "github.com/example/monorepo/canvas/internal/domain/asset"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
)

// ProjectionPart names the independently consumable parts of the Canvas
// projection. Every part is delivered as keyed operations in one cursor frame.
type ProjectionPart string

const (
	ProjectionCanvas         ProjectionPart = "canvas"
	ProjectionArchives       ProjectionPart = "archives"
	ProjectionNodeReviews    ProjectionPart = "node_reviews"
	ProjectionNodes          ProjectionPart = "nodes"
	ProjectionTasks          ProjectionPart = "tasks"
	ProjectionTexts          ProjectionPart = "texts"
	ProjectionProtectedNodes ProjectionPart = "protected_node_ids"
)

// Change is the cursor-independent result of comparing two durable Canvas
// projections. Persistence owns cursor allocation and retention; this domain
// owns the patch semantics applied by every Canvas client.
type Change struct {
	Event             Event
	Changed           bool
	StructuralChanged bool
	TextBytes         int64
	TerminalText      bool
}

// StabilizeReviewTimestamps keeps internal bookkeeping out of the Canvas
// projection. Apply before both checkpoint serialization and Diff so snapshots
// and replay agree at the same cursor (ADR-0077). The source audit time is intact.
func StabilizeReviewTimestamps(before, current State) State {
	previous := make(map[string]NodeReviews, len(before.NodeReviews))
	for _, item := range before.NodeReviews {
		previous[item.NodeID] = item
	}
	current.NodeReviews = slices.Clone(current.NodeReviews)
	for i, item := range current.NodeReviews {
		old, found := previous[item.NodeID]
		if !found || old.AssetID != item.AssetID {
			continue
		}
		byPackage := make(map[string]domainasset.Review, len(old.Reviews))
		for _, review := range old.Reviews {
			byPackage[review.PackageID] = review
		}
		item.Reviews = slices.Clone(item.Reviews)
		for j, review := range item.Reviews {
			prior, exists := byPackage[review.PackageID]
			if !exists {
				continue
			}
			review.UpdatedAt = prior.UpdatedAt
			if reflect.DeepEqual(review, prior) {
				item.Reviews[j] = review
			}
		}
		current.NodeReviews[i] = item
	}
	return current
}

// Diff produces a deterministic operation log from two complete checkpoints.
// A missing operation always means no change; removals are explicit.
func Diff(before, current State) (Change, error) {
	before = canonicalProjection(before)
	current = canonicalProjection(current)
	change := Change{
		Changed:           !reflect.DeepEqual(before, current),
		StructuralChanged: !reflect.DeepEqual(withoutTexts(before), withoutTexts(current)),
		Event:             Event{ProtocolVersion: PatchProtocolVersion, Patches: []Patch{}},
	}
	if !change.Changed {
		return change, nil
	}

	if !reflect.DeepEqual(before.Canvas, current.Canvas) && current.Canvas != nil {
		change.Event.Patches = append(change.Event.Patches, Patch{Kind: PatchCanvasUpsert, Key: current.Canvas.ID, Canvas: current.Canvas})
	}
	diffKeyed(before.Archives, current.Archives, func(v archive.Export) string { return v.TaskRunID }, func(v archive.Export) Patch { return Patch{Kind: PatchArchiveUpsert, Key: v.TaskRunID, Archive: &v} }, func(v archive.Export) Patch { return Patch{Kind: PatchArchiveRemove, Key: v.TaskRunID} }, &change.Event.Patches)
	oldNodes := make(map[string]domain.CanvasNode, len(before.Nodes))
	visibilityOwners := make(map[string]string, len(before.PrivateNodeOwners)+len(current.PrivateNodeOwners))
	for id, owner := range before.PrivateNodeOwners {
		visibilityOwners[id] = owner
	}
	for id, owner := range current.PrivateNodeOwners {
		visibilityOwners[id] = owner
	}
	for _, node := range before.Nodes {
		oldNodes[node.ID] = node
	}
	for _, node := range current.Nodes {
		old, found := oldNodes[node.ID]
		numberChanged := current.NodeNumbers[node.ID] != before.NodeNumbers[node.ID]
		if !found || numberChanged || !reflect.DeepEqual(node, old) || !reflect.DeepEqual(current.Drafts[node.ID], before.Drafts[node.ID]) {
			value := node
			change.Event.Patches = append(change.Event.Patches, Patch{
				Kind: PatchNodeUpsert, Key: node.ID, NodeID: node.ID,
				NodeNumber: current.NodeNumbers[node.ID], VisibilityOwner: current.PrivateNodeOwners[node.ID],
				Node:      &value,
				NodeDraft: draftFor(current, node.ID),
			})
		}
		delete(oldNodes, node.ID)
	}
	deletedNodeIDs := make([]string, 0, len(oldNodes))
	for id := range oldNodes {
		deletedNodeIDs = append(deletedNodeIDs, id)
	}
	sort.Strings(deletedNodeIDs)
	for _, id := range deletedNodeIDs {
		change.Event.Patches = append(change.Event.Patches, Patch{
			Kind: PatchNodeRemove, Key: id, NodeID: id, VisibilityOwner: before.PrivateNodeOwners[id],
		})
	}

	diffKeyed(before.NodeReviews, current.NodeReviews,
		func(value NodeReviews) string { return value.NodeID },
		func(value NodeReviews) Patch {
			item := value
			return Patch{Kind: PatchNodeReviewsUpsert, Key: value.NodeID, NodeID: value.NodeID, VisibilityOwner: visibilityOwners[value.NodeID], NodeReviews: &item}
		},
		func(value NodeReviews) Patch {
			return Patch{Kind: PatchNodeReviewsRemove, Key: value.NodeID, NodeID: value.NodeID, VisibilityOwner: visibilityOwners[value.NodeID]}
		},
		&change.Event.Patches)

	diffKeyed(
		before.Tasks, current.Tasks,
		func(value TaskState) string { return value.TaskRunID },
		func(value TaskState) Patch {
			item := value
			return Patch{Kind: PatchTaskUpsert, Key: value.TaskRunID, NodeID: value.NodeID, VisibilityOwner: visibilityOwners[value.NodeID], Task: &item}
		},
		func(value TaskState) Patch {
			return Patch{Kind: PatchTaskRemove, Key: value.TaskRunID, NodeID: value.NodeID, VisibilityOwner: visibilityOwners[value.NodeID]}
		},
		&change.Event.Patches,
	)

	previousTexts := make(map[string]TextCheckpoint, len(before.Texts))
	for _, checkpoint := range before.Texts {
		previousTexts[checkpoint.TaskRunID] = checkpoint
	}
	for _, checkpoint := range current.Texts {
		if checkpoint.Offset != int64(len(checkpoint.Content)) {
			return Change{}, fmt.Errorf("canvas text %q offset %d does not match UTF-8 byte length %d", checkpoint.TaskRunID, checkpoint.Offset, len(checkpoint.Content))
		}
		old, found := previousTexts[checkpoint.TaskRunID]
		if found && (old.Offset != int64(len(old.Content)) || checkpoint.Offset < old.Offset || !strings.HasPrefix(checkpoint.Content, old.Content)) {
			return Change{}, fmt.Errorf("canvas text %q violated append-only checkpoint invariant", checkpoint.TaskRunID)
		}
		if !found || checkpoint.Status != old.Status {
			change.TerminalText = true
		}
		start := int64(0)
		if found {
			start = old.Offset
		}
		if checkpoint.Offset <= start {
			continue
		}
		change.TextBytes += checkpoint.Offset - start
		delta := TextDelta{
			NodeID: checkpoint.NodeID, TaskRunID: checkpoint.TaskRunID,
			Content: checkpoint.Content[start:], StartOffset: start, EndOffset: checkpoint.Offset,
		}
		change.Event.Patches = append(change.Event.Patches, Patch{Kind: PatchTextAppend, Key: checkpoint.NodeID, NodeID: checkpoint.NodeID, VisibilityOwner: visibilityOwners[checkpoint.NodeID], TextDelta: &delta})
	}
	for _, checkpoint := range current.Texts {
		old, found := previousTexts[checkpoint.TaskRunID]
		if found && checkpoint.Status == old.Status {
			continue
		}
		status := TextStatus{NodeID: checkpoint.NodeID, TaskRunID: checkpoint.TaskRunID, Offset: checkpoint.Offset, Status: checkpoint.Status}
		change.Event.Patches = append(change.Event.Patches, Patch{Kind: PatchTextStatus, Key: checkpoint.NodeID, NodeID: checkpoint.NodeID, VisibilityOwner: visibilityOwners[checkpoint.NodeID], TextStatus: &status})
	}

	diffStrings(before.ProtectedNodeIDs, current.ProtectedNodeIDs, visibilityOwners, &change.Event.Patches)
	return change, nil
}

func canonicalProjection(state State) State {
	state.Cursor = 0
	return state
}

func withoutTexts(state State) State {
	state.Texts = nil
	return state
}

func diffKeyed[T any](before, current []T, key func(T) string, upsert func(T) Patch, remove func(T) Patch, patches *[]Patch) {
	previous := make(map[string]T, len(before))
	for _, value := range before {
		previous[key(value)] = value
	}
	for _, value := range current {
		id := key(value)
		old, found := previous[id]
		if !found || !reflect.DeepEqual(old, value) {
			*patches = append(*patches, upsert(value))
		}
		delete(previous, id)
	}
	removed := make([]string, 0, len(previous))
	for id := range previous {
		removed = append(removed, id)
	}
	sort.Strings(removed)
	for _, id := range removed {
		*patches = append(*patches, remove(previous[id]))
	}
}

func diffStrings(before, current []string, visibilityOwners map[string]string, patches *[]Patch) {
	previous := make(map[string]bool, len(before))
	for _, value := range before {
		previous[value] = true
	}
	for _, value := range current {
		if !previous[value] {
			*patches = append(*patches, Patch{Kind: PatchProtectionAdd, Key: value, NodeID: value, VisibilityOwner: visibilityOwners[value]})
		}
		delete(previous, value)
	}
	removed := make([]string, 0, len(previous))
	for value := range previous {
		removed = append(removed, value)
	}
	sort.Strings(removed)
	for _, value := range removed {
		*patches = append(*patches, Patch{Kind: PatchProtectionRemove, Key: value, NodeID: value, VisibilityOwner: visibilityOwners[value]})
	}
}

func draftFor(s State, id string) *canvas.StoryboardSession {
	if v, ok := s.Drafts[id]; ok {
		return &v
	}
	return nil
}
