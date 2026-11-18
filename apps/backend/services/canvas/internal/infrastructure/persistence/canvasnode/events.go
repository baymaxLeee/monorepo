package canvasnode

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	app "github.com/example/monorepo/canvas/internal/application/canvas"
	archive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	"github.com/example/monorepo/canvas/internal/application/requestcontext"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	canvasrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvas"
	archiverepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	tx "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type eventScope struct {
	TenantID            string
	WorkspaceID         *string
	ProjectID, CanvasID string
}
type EventJournal struct {
	db    *tx.Store
	nodes *Repository
}

func NewEventJournal(db *tx.Store, nodes *Repository) *EventJournal { return &EventJournal{db, nodes} }
func (j *EventJournal) collect(ctx context.Context, s eventScope) (stream.State, error) {
	q := j.db.Queries(ctx)
	scope := app.Scope{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID}
	state := stream.State{Drafts: map[string]app.StoryboardSession{}, PrivateNodeOwners: map[string]string{}, Nodes: []domain.CanvasNode{}, NodeNumbers: map[string]int32{}, Tasks: []stream.TaskState{}, Texts: []stream.TextCheckpoint{}, ProtectedNodeIDs: []string{}}

	metadata, err := canvasrepo.NewRepository(j.db).Get(ctx, scope, s.ProjectID, s.CanvasID)
	if err != nil {
		return state, err
	}
	state.Canvas = &metadata
	state.Archives, _, err = archiverepo.NewRepository(j.db).List(ctx, archive.ListQuery{Scope: archive.Scope{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID}, ProjectID: s.ProjectID, CanvasID: s.CanvasID, PageSize: -1, PageNum: 1})
	if err != nil {
		return state, err
	}
	ids := []string{}
	var videoNumber int32
	rows, err := q.NodeList(ctx, sqlc.NodeListParams{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID, ProjectID: s.ProjectID, CanvasID: s.CanvasID})
	if err != nil {
		return state, err
	}
	for _, row := range rows {
		node, err := fromRow(row)
		if err != nil {
			return state, err
		}
		if node.Type == domain.NodeTypeStoryboardDraft {
			var document struct {
				Payload struct {
					Session app.StoryboardSession `json:"session"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(row.NodeData, &document); err != nil {
				return state, err
			}
			state.Drafts[row.ID] = document.Payload.Session
			state.PrivateNodeOwners[node.ID] = node.CreatedBy
		}
		if node.Type == domain.NodeTypeVideoGeneration {
			videoNumber++
			state.NodeNumbers[node.ID] = videoNumber
		}
		state.Nodes = append(state.Nodes, node)
		ids = append(ids, node.ID)
	}
	resources := []string{}
	slots := []string{}
	for _, n := range state.Nodes {
		if n.ResourceID != "" {
			resources = append(resources, n.ResourceID)
		} else if n.ResourceAssetID != "" {
			slots = append(slots, n.ResourceAssetID)
		}
	}
	primary := map[string]app.CanvasResourceAssetReference{}
	looks := map[string]app.CanvasResourceAssetReference{}
	repo := j.nodes
	if len(resources) > 0 {
		var err error
		primary, err = repo.BatchResolvePrimaryResourceAssets(ctx, scope, s.ProjectID, resources)
		if err != nil {
			return state, err
		}
	}
	if len(slots) > 0 {
		var err error
		looks, err = repo.BatchResolveCurrentResourceAssets(ctx, scope, s.ProjectID, slots)
		if err != nil {
			return state, err
		}
	}
	for i := range state.Nodes {
		n := &state.Nodes[i]
		var ref app.CanvasResourceAssetReference
		var found bool
		if n.ResourceID != "" {
			ref, found = primary[n.ResourceID]
		} else if n.ResourceAssetID != "" {
			ref, found = looks[n.ResourceAssetID]
		} else {
			continue
		}
		if !found {
			n.ReferenceStatus = domain.ReferenceStatusDeleted
			continue
		}
		n.ReferenceStatus = domain.ReferenceStatusActive
		if !n.HasPersistedName {
			name, err := app.CanvasNodeNameFromSource(ref.Name, n.Type)
			if err != nil {
				return state, err
			}
			n.Name = name
		}
		n.CurrentAssetID, n.ResourceAssetID, n.ResourceAssetRevision, n.ResourceAssetIsPrimary = ref.Asset.ID, ref.ResourceAssetID, ref.Revision, ref.IsPrimary
	}
	if err := loadSelectedOutputMetadata(ctx, q, scope, state.Nodes); err != nil {
		return state, err
	}
	if len(ids) > 0 {
		tasks, err := q.JournalTasks(ctx, sqlc.JournalTasksParams{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID, NodeIds: ids})
		if err != nil {
			return state, err
		}
		seen := map[string]bool{}
		for _, t := range tasks {
			key := t.SubjectID
			if t.RunType == "CANVAS_NODE_ASSETS_MATCH" {
				key += ":match"
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			state.Tasks = append(state.Tasks, stream.TaskState{NodeID: t.SubjectID, TaskRunID: t.ID, Status: t.Status, ErrorCode: t.ErrorCode, ErrorMessage: t.ErrorMessage, TaskType: t.RunType})
		}
		videoFacts, err := q.JournalVideoFacts(ctx, sqlc.JournalVideoFactsParams{CanvasID: s.CanvasID, NodeIds: ids})
		if err != nil {
			return state, err
		}
		facts := map[string]struct{ status, id, code string }{}
		for _, v := range videoFacts {
			facts[v.TaskRunID] = struct{ status, id, code string }{v.ProviderStatus, v.ProviderTaskID, v.ProviderErrorCode}
		}
		for i := range state.Tasks {
			state.Tasks[i].ProviderStatus = facts[state.Tasks[i].TaskRunID].status
			state.Tasks[i].SeedanceTaskID = facts[state.Tasks[i].TaskRunID].id
			if state.Tasks[i].ErrorCode == "" {
				state.Tasks[i].ErrorCode = facts[state.Tasks[i].TaskRunID].code
			}
		}
		texts, err := q.JournalTexts(ctx, sqlc.JournalTextsParams{CanvasID: s.CanvasID, NodeIds: ids})
		if err != nil {
			return state, err
		}
		seen = map[string]bool{}
		for _, text := range texts {
			if seen[text.NodeID] {
				continue
			}
			seen[text.NodeID] = true
			state.Texts = append(state.Texts, stream.TextCheckpoint{NodeID: text.NodeID, TaskRunID: text.TaskRunID, Content: text.Content, Status: text.Status, Offset: int64(len(text.Content))})
		}
	}
	protected := map[string]bool{}
	for _, node := range state.Nodes {
		if node.ActiveTaskRunID != "" {
			protected[node.ID] = true
		}
	}
	for _, task := range state.Tasks {
		if task.Status == "queued" || task.Status == "running" {
			protected[task.NodeID] = true
		}
	}
	for id := range protected {
		state.ProtectedNodeIDs = append(state.ProtectedNodeIDs, id)
	}
	sort.Strings(state.ProtectedNodeIDs)
	if err := j.collectNodeReviews(ctx, s, &state); err != nil {
		return state, err
	}
	return state, nil
}

// record writes the checkpoint while its caller holds the scoped canvas lock.
func (j *EventJournal) record(ctx context.Context, s eventScope) error {
	q := j.db.Queries(ctx)
	head, err := q.LockEventHead(ctx, s.CanvasID)
	fresh := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !fresh {
		return err
	}
	state, err := j.collect(ctx, s)
	if err != nil {
		return err
	}
	var before stream.State
	if !fresh {
		if err = json.Unmarshal(head.Data, &before); err != nil {
			return err
		}
	}
	state = stream.StabilizeReviewTimestamps(before, state)
	encoded, err := json.Marshal(state)
	if err != nil {
		return err
	}
	change, err := stream.Diff(before, state)
	if err != nil {
		return err
	}
	if !change.Changed && !fresh {
		return nil
	}
	event := change.Event
	event.ProtocolVersion = stream.PatchProtocolVersion
	event.BaseCursor = head.Sequence
	event.Cursor = head.Sequence + 1
	now := time.Now().UTC()
	event.RecordedAt = now
	event.RequestID, _ = requestcontext.RequestIDFromContext(ctx)
	event.Action, _ = requestcontext.ActionFromContext(ctx)
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	stamp := pgtype.Timestamptz{Time: now, Valid: true}
	if err = q.InsertCanvasEvent(ctx, sqlc.InsertCanvasEventParams{CanvasID: s.CanvasID, Sequence: event.Cursor, Data: payload, CreatedAt: stamp}); err != nil {
		return err
	}
	return q.SaveEventHead(ctx, sqlc.SaveEventHeadParams{CanvasID: s.CanvasID, Sequence: event.Cursor, Data: encoded, UpdatedAt: stamp})
}
func (j *EventJournal) Snapshot(ctx context.Context, scope app.Scope, project, canvas string) (stream.State, error) {
	var state stream.State
	p, err := parseID(project)
	if err != nil {
		return state, app.ErrNotFound
	}
	c, err := parseID(canvas)
	if err != nil {
		return state, app.ErrNotFound
	}
	project, canvas = p, c
	err = j.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := j.nodes.LockCanvas(ctx, scope, project, canvas); err != nil {
			return err
		}
		if err := j.record(ctx, eventScope{scope.TenantID, scope.WorkspaceID, project, canvas}); err != nil {
			return err
		}
		head, err := j.db.Queries(ctx).GetEventHead(ctx, canvas)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(head.Data, &state); err != nil {
			return err
		}
		state.Cursor = head.Sequence
		filterState(&state, scope.CallerID)
		return nil
	})
	return state, err
}
func (j *EventJournal) Events(ctx context.Context, scope app.Scope, project, canvas string, cursor int64, limit int) ([]stream.Event, error) {
	p, err := persistenceid.Parse(project)
	if err != nil {
		return nil, app.ErrNotFound
	}
	c, err := persistenceid.Parse(canvas)
	if err != nil {
		return nil, app.ErrNotFound
	}
	q := j.db.Queries(ctx)
	head, err := q.ScopedEventCursor(ctx, sqlc.ScopedEventCursorParams{CanvasID: c.String(), ProjectID: p.String(), TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID})
	if err != nil {
		return nil, readErr(err)
	}
	if cursor > head {
		return nil, stream.ErrCursorExpired
	}
	if cursor == head {
		return []stream.Event{}, nil
	}
	rows, err := q.ListCanvasEvents(ctx, sqlc.ListCanvasEventsParams{CanvasID: c.String(), Sequence: cursor, PageSize: int64(limit)})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, stream.ErrCursorExpired
	}
	result := []stream.Event{}
	expected := cursor + 1
	for _, row := range rows {
		if row.Sequence != expected {
			return nil, stream.ErrCursorExpired
		}
		var event stream.Event
		if err = json.Unmarshal(row.Data, &event); err != nil {
			return nil, err
		}
		if event.ProtocolVersion != stream.PatchProtocolVersion || event.BaseCursor != row.Sequence-1 || event.Cursor != row.Sequence {
			return nil, stream.ErrCursorExpired
		}
		filterEvent(&event, scope.CallerID)
		result = append(result, event)
		expected++
	}
	return result, nil
}

func (j *EventJournal) Cursor(ctx context.Context, scope app.Scope, project, canvas string) (int64, error) {
	p, err := persistenceid.Parse(project)
	if err != nil {
		return 0, app.ErrNotFound
	}
	c, err := persistenceid.Parse(canvas)
	if err != nil {
		return 0, app.ErrNotFound
	}
	read := func(ctx context.Context) (int64, error) {
		value, err := j.db.Queries(ctx).ScopedEventCursor(ctx, sqlc.ScopedEventCursorParams{CanvasID: c.String(), ProjectID: p.String(), TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID})
		return value, readErr(err)
	}
	if cursor, readError := read(ctx); readError == nil {
		return cursor, nil
	} else if !errors.Is(readError, app.ErrNotFound) {
		return 0, readError
	}

	// A Canvas is valid before its first graph Snapshot. Resource mutations may
	// request a scoped causal receipt during that window, so lazily establish
	// the durable journal checkpoint instead of conflating a missing head with
	// a missing or unauthorized Canvas.
	var cursor int64
	err = j.db.WithinTransaction(ctx, func(ctx context.Context) error {
		if _, lockError := j.nodes.LockCanvas(ctx, scope, project, canvas); lockError != nil {
			return lockError
		}
		if recordError := j.record(ctx, eventScope{scope.TenantID, scope.WorkspaceID, p.String(), c.String()}); recordError != nil {
			return recordError
		}
		var readError error
		cursor, readError = read(ctx)
		return readError
	})
	if err != nil {
		return 0, err
	}
	return cursor, nil
}
func filterState(state *stream.State, user string) {
	hidden := map[string]bool{}
	for id, owner := range state.PrivateNodeOwners {
		if owner != user {
			hidden[id] = true
		}
	}
	state.PrivateNodeOwners = nil
	for id := range hidden {
		delete(state.Drafts, id)
	}
	nodes := []domain.CanvasNode{}
	for _, n := range state.Nodes {
		if n.Type == domain.NodeTypeStoryboardDraft && n.CreatedBy != user {
			hidden[n.ID] = true
			continue
		}
		nodes = append(nodes, n)
	}
	state.Nodes = nodes
	numbers := map[string]int32{}
	for id, number := range state.NodeNumbers {
		if !hidden[id] {
			numbers[id] = number
		}
	}
	state.NodeNumbers = numbers
	tasks := state.Tasks[:0]
	for _, t := range state.Tasks {
		if !hidden[t.NodeID] {
			tasks = append(tasks, t)
		}
	}
	state.Tasks = tasks
	reviews := state.NodeReviews[:0]
	for _, item := range state.NodeReviews {
		if !hidden[item.NodeID] {
			reviews = append(reviews, item)
		}
	}
	state.NodeReviews = reviews
	protected := state.ProtectedNodeIDs[:0]
	for _, id := range state.ProtectedNodeIDs {
		if !hidden[id] {
			protected = append(protected, id)
		}
	}
	state.ProtectedNodeIDs = protected
	texts := state.Texts[:0]
	for _, t := range state.Texts {
		if !hidden[t.NodeID] {
			texts = append(texts, t)
		}
	}
	state.Texts = texts
}

func filterEvent(event *stream.Event, user string) {
	visible := event.Patches[:0]
	for _, patch := range event.Patches {
		if patch.VisibilityOwner != "" && patch.VisibilityOwner != user {
			continue
		}
		patch.VisibilityOwner = ""
		if patch.Kind == stream.PatchNodeRemove {
			patch.Node = nil
		}
		visible = append(visible, patch)
	}
	event.Patches = visible
}

// Events are a bounded replay journal. The latest checkpoint remains durable;
// clients older than the retained range receive a fresh snapshot.
func (j *EventJournal) Prune(ctx context.Context) error {
	return j.db.Queries(ctx).PruneCanvasEvents(ctx, pgtype.Timestamptz{Time: time.Now().UTC().Add(-24 * time.Hour), Valid: true})
}
