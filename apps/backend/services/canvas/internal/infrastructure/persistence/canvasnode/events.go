package canvasnode

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/example/monorepo/canvas/internal/api/requestcontext"
	app "github.com/example/monorepo/canvas/internal/application/canvas"
	archive "github.com/example/monorepo/canvas/internal/application/canvasarchive"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	domain "github.com/example/monorepo/canvas/internal/domain/canvas"
	canvasrepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvas"
	archiverepo "github.com/example/monorepo/canvas/internal/infrastructure/persistence/canvasarchive"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	tx "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

type eventScope struct {
	TenantID            string
	WorkspaceID         *string
	ProjectID, CanvasID persistenceid.UUID
}
type EventJournal struct {
	db    *gorm.DB
	nodes *Repository
}

func NewEventJournal(db *gorm.DB, nodes *Repository) *EventJournal { return &EventJournal{db, nodes} }
func (j *EventJournal) collect(db *gorm.DB, s eventScope) (stream.State, error) {
	var rows []canvasnodeRow
	scope := app.Scope{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID}
	if err := scopeQuery(db, scope).Where("project_id = ? AND canvas_id = ?", s.ProjectID, s.CanvasID).Order("storyboard_rank ASC").Order("id ASC").Find(&rows).Error; err != nil {
		return stream.State{}, err
	}
	state := stream.State{Drafts: map[string]app.StoryboardSession{}, PrivateNodeOwners: map[string]string{}, Nodes: []domain.CanvasNode{}, NodeNumbers: map[string]int32{}, Tasks: []stream.TaskState{}, Texts: []stream.TextCheckpoint{}, ProtectedNodeIDs: []string{}}

	metadata, err := canvasrepo.NewRepository(db).Get(db.Statement.Context, scope, s.ProjectID.String(), s.CanvasID.String())
	if err != nil {
		return state, err
	}
	state.Canvas = &metadata
	state.Archives, _, err = archiverepo.NewRepository(db).List(db.Statement.Context, archive.ListQuery{Scope: archive.Scope{TenantID: s.TenantID, WorkspaceID: s.WorkspaceID}, ProjectID: s.ProjectID.String(), CanvasID: s.CanvasID.String(), PageSize: -1, PageNum: 1})
	if err != nil {
		return state, err
	}
	ids := []string{}
	var videoNumber int32
	for _, row := range rows {
		node, err := fromRow(row)
		if err != nil {
			return state, err
		}
		if node.Type == domain.NodeTypeStoryboardDraft {
			state.PrivateNodeOwners[node.ID] = node.CreatedBy
			var document struct {
				Payload struct {
					Session app.StoryboardSession `json:"session"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(row.NodeData, &document); err != nil {
				return state, err
			}
			state.Drafts[node.ID] = document.Payload.Session
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
	repo := NewRepository(db)
	if len(resources) > 0 {
		var err error
		primary, err = repo.BatchResolvePrimaryResourceAssets(db.Statement.Context, scope, s.ProjectID.String(), resources)
		if err != nil {
			return state, err
		}
	}
	if len(slots) > 0 {
		var err error
		looks, err = repo.BatchResolveCurrentResourceAssets(db.Statement.Context, scope, s.ProjectID.String(), slots)
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
	if err := loadSelectedOutputMetadata(db, scope, state.Nodes); err != nil {
		return state, err
	}
	if len(ids) > 0 {
		var tasks []struct {
			ID                      string
			SubjectID               string
			Status                  string
			ErrorCode, ErrorMessage string
			RunType                 string
		}
		query := db.Table("task_runs").Select("id,subject_id,status,error_code,error_message,run_type").Where("tenant_id = ? AND subject_id IN ? AND hidden_at IS NULL AND parent_task_id IS NULL", s.TenantID, ids).Order("created_at DESC,id DESC")
		if s.WorkspaceID == nil {
			query = query.Where("workspace_id IS NULL")
		} else {
			query = query.Where("workspace_id = ?", *s.WorkspaceID)
		}
		if err := query.Find(&tasks).Error; err != nil {
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
		var videoFacts []struct{ TaskRunID, ProviderStatus, RealTaskID, ProviderErrorCode string }
		if err := db.Table("canvas_node_generations").Select("task_run_id,provider_status,provider_task_id AS real_task_id,provider_error_code").Where("canvas_id = ? AND node_id IN ? AND hidden_at IS NULL", s.CanvasID, ids).Find(&videoFacts).Error; err != nil {
			return state, err
		}
		facts := map[string]struct{ status, id, code string }{}
		for _, v := range videoFacts {
			facts[v.TaskRunID] = struct{ status, id, code string }{v.ProviderStatus, v.RealTaskID, v.ProviderErrorCode}
		}
		for i := range state.Tasks {
			state.Tasks[i].ProviderStatus = facts[state.Tasks[i].TaskRunID].status
			state.Tasks[i].SeedanceTaskID = facts[state.Tasks[i].TaskRunID].id
			if state.Tasks[i].ErrorCode == "" {
				state.Tasks[i].ErrorCode = facts[state.Tasks[i].TaskRunID].code
			}
		}
		var texts []struct{ NodeID, TaskRunID, Content, Status string }
		if err := db.Table("canvas_text_generations").Select("node_id,task_run_id,content,status").Where("canvas_id = ? AND node_id IN ?", s.CanvasID, ids).Order("created_at DESC,task_run_id DESC").Find(&texts).Error; err != nil {
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
	if err := j.collectNodeReviews(db, s, &state); err != nil {
		return state, err
	}
	return state, nil
}
func (j *EventJournal) record(ctx context.Context, db *gorm.DB, s eventScope, _ bool) error {
	db = db.WithContext(ctx).Session(&gorm.Session{NewDB: true, Initialized: true}).Session(&gorm.Session{NewDB: true})
	if err := lockCanvas(db, s.TenantID, s.WorkspaceID, s.ProjectID.String(), s.CanvasID); err != nil {
		if errors.Is(readErr(err), app.ErrNotFound) {
			return nil
		}
		return readErr(err)
	}
	var head eventHeadRow
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("canvas_id = ?", s.CanvasID).First(&head).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	fresh := errors.Is(err, gorm.ErrRecordNotFound)
	state, err := j.collect(db, s)
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
	if err = db.Create(&eventRow{CanvasID: s.CanvasID, Sequence: event.Cursor, Data: payload, CreatedAt: now}).Error; err != nil {
		return err
	}
	if fresh {
		return db.Create(&eventHeadRow{CanvasID: s.CanvasID, Sequence: event.Cursor, Data: encoded, UpdatedAt: now}).Error
	}
	return db.Model(&head).Updates(map[string]any{"sequence": event.Cursor, "data": json.RawMessage(encoded), "updated_at": now}).Error
}
func (j *EventJournal) Snapshot(ctx context.Context, scope app.Scope, project, canvas string) (stream.State, error) {
	var state stream.State
	err := tx.New(j.db).WithinTransaction(ctx, func(ctx context.Context) error {
		if _, err := j.nodes.LockCanvas(ctx, scope, project, canvas); err != nil {
			return err
		}
		p, err := persistenceid.Parse(project)
		if err != nil {
			return err
		}
		c, err := persistenceid.Parse(canvas)
		if err != nil {
			return err
		}
		db := tx.DB(ctx, j.db)
		if err = j.record(ctx, db, eventScope{scope.TenantID, scope.WorkspaceID, p, c}, true); err != nil {
			return err
		}
		var head eventHeadRow
		if err = db.Where("canvas_id = ?", c).First(&head).Error; err != nil {
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
	var head struct{ Sequence int64 }
	db := tx.DB(ctx, j.db)
	// Idle subscribers only need the scoped sequence. Reading the checkpoint
	// JSON or taking graph write locks at 10 Hz would amplify I/O and contend
	// with mutations on every open canvas. ADR-0077.
	query := db.Table("canvas_event_heads AS h").
		Select("h.sequence").
		Joins("JOIN canvases AS c ON c.id = h.canvas_id AND c.deleted_at = 0").
		Joins("JOIN projects AS p ON p.id = c.project_id AND p.deleted_at = 0").
		Where("h.canvas_id = ? AND c.project_id = ?", c, p)
	query = qualifiedScopeQuery(query, "c", scope)
	query = qualifiedScopeQuery(query, "p", scope)
	if err = query.Take(&head).Error; err != nil {
		return nil, readErr(err)
	}
	if cursor > head.Sequence {
		return nil, stream.ErrCursorExpired
	}
	if cursor == head.Sequence {
		return []stream.Event{}, nil
	}
	var rows []eventRow
	if err = db.Where("canvas_id = ? AND sequence > ?", c, cursor).Order("sequence").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 && cursor < head.Sequence {
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
	read := func(db *gorm.DB) (int64, error) {
		var head struct{ Sequence int64 }
		query := db.Table("canvas_event_heads AS h").
			Select("h.sequence").
			Joins("JOIN canvases AS c ON c.id = h.canvas_id AND c.deleted_at = 0").
			Joins("JOIN projects AS p ON p.id = c.project_id AND p.deleted_at = 0").
			Where("h.canvas_id = ? AND c.project_id = ?", c, p)
		query = qualifiedScopeQuery(query, "c", scope)
		query = qualifiedScopeQuery(query, "p", scope)
		if readError := query.Take(&head).Error; readError != nil {
			return 0, readErr(readError)
		}
		return head.Sequence, nil
	}
	if cursor, readError := read(tx.DB(ctx, j.db)); readError == nil {
		return cursor, nil
	} else if !errors.Is(readError, app.ErrNotFound) {
		return 0, readError
	}

	// A Canvas is valid before its first graph Snapshot. Resource mutations may
	// request a scoped causal receipt during that window, so lazily establish
	// the durable journal checkpoint instead of conflating a missing head with
	// a missing or unauthorized Canvas.
	var cursor int64
	err = tx.New(j.db).WithinTransaction(ctx, func(ctx context.Context) error {
		if _, lockError := j.nodes.LockCanvas(ctx, scope, project, canvas); lockError != nil {
			return lockError
		}
		db := tx.DB(ctx, j.db)
		if recordError := j.record(ctx, db, eventScope{scope.TenantID, scope.WorkspaceID, p, c}, true); recordError != nil {
			return recordError
		}
		var readError error
		cursor, readError = read(db)
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
	return j.db.WithContext(ctx).Where("created_at < ?", time.Now().UTC().Add(-24*time.Hour)).Delete(&eventRow{}).Error
}
