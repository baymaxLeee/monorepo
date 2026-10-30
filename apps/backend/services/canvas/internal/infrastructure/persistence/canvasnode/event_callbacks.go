package canvasnode

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"

	"gorm.io/gorm"

	app "github.com/example/monorepo/canvas/internal/application/canvas"
	stream "github.com/example/monorepo/canvas/internal/application/canvasstream"
	"github.com/example/monorepo/canvas/internal/infrastructure/persistence/persistenceid"
	tx "github.com/example/monorepo/canvas/internal/infrastructure/persistence/transaction"
)

const eventScopesKey = "agentframe:canvas-event-scopes"

type projectionScopeResolver uint8

const (
	projectionScopeDirect projectionScopeResolver = iota
	projectionScopeTaskSubject
	projectionScopeResourceReferences
	projectionScopeAssetReviews
)

type projectionSource struct {
	ScopeResolver projectionScopeResolver
	Affects       []stream.ProjectionPart
}

// canvasProjectionSources is the exhaustive persistence boundary for the
// durable Canvas SSE projection. Adding a field to collect() requires adding
// its source table here with an explicit scope resolver and affected parts.
// Signed preview URLs remain delivery-time enrichment. Reviews are durable
// projection facts so replay never observes a later review (ADR-0077).
var canvasProjectionSources = map[string]projectionSource{
	"canvases":                     {ScopeResolver: projectionScopeDirect, Affects: []stream.ProjectionPart{stream.ProjectionCanvas}},
	"canvas_video_archive_exports": {ScopeResolver: projectionScopeDirect, Affects: []stream.ProjectionPart{stream.ProjectionArchives}},
	"asset_reviews":                {ScopeResolver: projectionScopeAssetReviews, Affects: []stream.ProjectionPart{stream.ProjectionNodeReviews}},
	"canvas_nodes": {
		ScopeResolver: projectionScopeDirect,
		Affects:       []stream.ProjectionPart{stream.ProjectionNodes, stream.ProjectionProtectedNodes, stream.ProjectionNodeReviews},
	},
	"canvas_node_generations": {
		ScopeResolver: projectionScopeDirect,
		Affects:       []stream.ProjectionPart{stream.ProjectionNodes, stream.ProjectionTasks, stream.ProjectionNodeReviews},
	},
	"canvas_text_generations": {
		ScopeResolver: projectionScopeDirect,
		Affects:       []stream.ProjectionPart{stream.ProjectionTexts},
	},
	"task_runs": {
		ScopeResolver: projectionScopeTaskSubject,
		Affects:       []stream.ProjectionPart{stream.ProjectionTasks, stream.ProjectionProtectedNodes},
	},
	"resources": {
		ScopeResolver: projectionScopeResourceReferences,
		Affects:       []stream.ProjectionPart{stream.ProjectionNodes, stream.ProjectionNodeReviews},
	},
	"resource_assets": {
		ScopeResolver: projectionScopeResourceReferences,
		Affects:       []stream.ProjectionPart{stream.ProjectionNodes, stream.ProjectionNodeReviews},
	},
}

// Register observes every repository producer at the persistence boundary.
// The journal flush belongs to the same transaction as the original mutation;
// callbacks never contact a model, IAM or object store. ADR-0077.
func (j *EventJournal) Register() error {
	before := func(db *gorm.DB) {
		if _, watched := canvasProjectionSources[db.Statement.Table]; db.Error != nil || !watched {
			return
		}
		scopes, err := j.changedScopes(db)
		if err != nil {
			db.Error = db.AddError(err)
			return
		}
		for _, s := range scopes {
			if err = lockCanvas(db.Session(&gorm.Session{NewDB: true, Initialized: true}).Session(&gorm.Session{NewDB: true}), s.TenantID, s.WorkspaceID, s.ProjectID.String(), s.CanvasID); err != nil {
				if errors.Is(readErr(err), app.ErrNotFound) {
					continue
				}
				db.Error = db.AddError(readErr(err))
				return
			}
		}
		db.InstanceSet(eventScopesKey, scopes)
	}
	after := func(db *gorm.DB) {
		if _, watched := canvasProjectionSources[db.Statement.Table]; db.Error != nil || !watched {
			return
		}
		value, ok := db.InstanceGet(eventScopesKey)
		if !ok {
			return
		}
		scopes, ok := value.([]eventScope)
		if !ok {
			db.Error = db.AddError(fmt.Errorf("invalid canvas event scope state"))
			return
		}
		for _, scope := range scopes {
			s := scope
			fn := func(ctx context.Context) error {
				return j.record(ctx, tx.DB(ctx, db.Session(&gorm.Session{NewDB: true, Initialized: true}).Session(&gorm.Session{NewDB: true})), s, false)
			}
			if !tx.BeforeCommit(db.Statement.Context, "canvas-events:"+s.CanvasID.String(), fn) {
				if err := fn(db.Statement.Context); err != nil {
					db.Error = db.AddError(err)
					return
				}
			}
		}
	}
	if err := j.db.Callback().Create().Before("gorm:create").Register("agentframe:canvas-events-before", before); err != nil {
		return err
	}
	if err := j.db.Callback().Create().After("gorm:create").Before("gorm:commit_or_rollback_transaction").Register("agentframe:canvas-events-after", after); err != nil {
		return err
	}
	if err := j.db.Callback().Update().Before("gorm:update").Register("agentframe:canvas-events-before", before); err != nil {
		return err
	}
	if err := j.db.Callback().Update().After("gorm:update").Before("gorm:commit_or_rollback_transaction").Register("agentframe:canvas-events-after", after); err != nil {
		return err
	}
	if err := j.db.Callback().Delete().Before("gorm:delete").Register("agentframe:canvas-events-before", before); err != nil {
		return err
	}
	return j.db.Callback().Delete().After("gorm:delete").Before("gorm:commit_or_rollback_transaction").Register("agentframe:canvas-events-after", after)
}
func (j *EventJournal) changedScopes(db *gorm.DB) ([]eventScope, error) {
	table := db.Statement.Table
	source, watched := canvasProjectionSources[table]
	if !watched {
		return nil, nil
	}
	fresh := db.Session(&gorm.Session{NewDB: true, Initialized: true}).Session(&gorm.Session{NewDB: true})
	scopes := []eventScope{}
	// Struct models carry their scope before GORM builds INSERT SQL. Preserve
	// every element: a bulk producer may touch more than one Canvas.
	valueSets := statementValueSets(db)
	query := fresh.Table(table)
	where, hasWhere := db.Statement.Clauses["WHERE"]
	if hasWhere {
		query = query.Clauses(where.Expression)
	}
	for _, pk := range []string{"id", "task_run_id"} {
		values := make([]any, 0, len(valueSets))
		for _, fields := range valueSets {
			if value, ok := fields[pk]; ok {
				values = append(values, value)
			}
		}
		if len(values) > 0 {
			query = query.Where(pk+" IN ?", values)
			hasWhere = true
			break
		}
	}
	switch source.ScopeResolver {
	case projectionScopeAssetReviews:
		return j.reviewChangedScopes(db, query, valueSets, hasWhere)
	case projectionScopeResourceReferences:
		ids := make([]persistenceid.UUID, 0, len(valueSets))
		for _, fields := range valueSets {
			if id, ok := fields["id"].(persistenceid.UUID); ok {
				ids = append(ids, id)
			}
		}
		var persistedIDs []persistenceid.UUID
		if err := query.Pluck("id", &persistedIDs).Error; err != nil {
			return nil, err
		}
		ids = append(ids, persistedIDs...)
		if len(ids) == 0 {
			return nil, nil
		}
		nodes := fresh.Table("canvas_nodes").Where("deleted_at = 0")
		if table == "resources" {
			nodes = nodes.Where("resource_id IN ? OR resource_asset_id IN (?)", ids, fresh.Table("resource_assets").Select("id").Where("resource_id IN ?", ids))
		} else {
			nodes = nodes.Where("resource_asset_id IN ? OR resource_id IN (?)", ids, fresh.Table("resources").Select("id").Where("primary_resource_asset_id IN ?", ids))
		}
		if err := nodes.Distinct("tenant_id, workspace_id, project_id, canvas_id").Find(&scopes).Error; err != nil {
			return nil, err
		}
		sort.Slice(scopes, func(i, k int) bool { return scopes[i].CanvasID.String() < scopes[k].CanvasID.String() })
		return scopes, nil
	case projectionScopeTaskSubject:
		type subject struct {
			TenantID    string
			WorkspaceID *string
			SubjectID   string
			SubjectType string
		}
		subjects := []subject{}
		for _, values := range valueSets {
			id, ok := values["subject_id"].(string)
			if !ok {
				continue
			}
			tenant, tenantOK := values["tenant_id"].(string)
			if !tenantOK {
				return nil, fmt.Errorf("invalid task tenant scope")
			}
			kind := fmt.Sprint(values["subject_type"])
			var workspace *string
			if value, exists := values["workspace_id"]; exists {
				var valid bool
				workspace, valid = value.(*string)
				if !valid {
					return nil, fmt.Errorf("invalid task workspace scope")
				}
			}
			subjects = append(subjects, subject{tenant, workspace, id, kind})
		}
		if hasWhere {
			var persisted []subject
			if err := query.Select("tenant_id,workspace_id,subject_id,subject_type").Find(&persisted).Error; err != nil {
				return nil, err
			}
			subjects = append(subjects, persisted...)
		}
		for _, s := range subjects {
			if s.SubjectType != "CANVAS_NODE" && s.SubjectType != "IMAGE_GENERATION" {
				continue
			}
			id, err := persistenceid.Parse(s.SubjectID)
			if err != nil {
				continue
			}
			var node canvasnodeRow
			if err = fresh.Where("id = ? AND tenant_id = ?", id, s.TenantID).Find(&node).Error; err != nil {
				return nil, err
			}
			if node.ID.String() != "00000000-0000-0000-0000-000000000000" {
				scopes = append(scopes, eventScope{node.TenantID, node.WorkspaceID, node.ProjectID, node.CanvasID})
			}
		}
	case projectionScopeDirect:
		for _, values := range valueSets {
			tenant, ok := values["tenant_id"].(string)
			if !ok {
				continue
			}
			project, pok := values["project_id"].(persistenceid.UUID)
			canvas, cok := values["canvas_id"].(persistenceid.UUID)
			if table == "canvases" {
				canvas, cok = values["id"].(persistenceid.UUID)
			}
			workspace, workspaceOK := values["workspace_id"].(*string)
			if !workspaceOK && values["workspace_id"] != nil {
				return nil, fmt.Errorf("invalid node workspace scope")
			}
			if pok && cok {
				scopes = append(scopes, eventScope{tenant, workspace, project, canvas})
			}
		}
		if hasWhere {
			var read []eventScope
			columns := "tenant_id,workspace_id,project_id,canvas_id"
			if table == "canvases" {
				columns = "tenant_id,workspace_id,project_id,id AS canvas_id"
			}
			if err := query.Select(columns).Find(&read).Error; err != nil {
				return nil, err
			}
			scopes = append(scopes, read...)
		}
	default:
		return nil, fmt.Errorf("unsupported canvas projection scope resolver for %s", table)
	}
	out := []eventScope{}
	seen := map[string]bool{}
	for _, s := range scopes {
		key := s.CanvasID.String()
		if !seen[key] {
			out = append(out, s)
			seen[key] = true
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CanvasID.String() < out[j].CanvasID.String() })
	return out, nil
}

func statementValueSets(db *gorm.DB) []map[string]any {
	if !db.Statement.ReflectValue.IsValid() {
		return nil
	}
	root := db.Statement.ReflectValue
	for root.Kind() == reflect.Pointer {
		if root.IsNil() {
			return nil
		}
		root = root.Elem()
	}
	values := make([]map[string]any, 0, 1)
	appendValue := func(value reflect.Value) {
		for value.Kind() == reflect.Pointer {
			if value.IsNil() {
				return
			}
			value = value.Elem()
		}
		if value.Kind() == reflect.Map && value.Type().Key().Kind() == reflect.String {
			fields := map[string]any{}
			for _, key := range value.MapKeys() {
				fields[key.String()] = value.MapIndex(key).Interface()
			}
			values = append(values, fields)
			return
		}
		if value.Kind() != reflect.Struct || db.Statement.Schema == nil {
			return
		}
		fields := map[string]any{}
		for _, field := range db.Statement.Schema.Fields {
			fieldValue, zero := field.ValueOf(db.Statement.Context, value)
			if !zero {
				fields[field.DBName] = fieldValue
			}
		}
		values = append(values, fields)
	}
	if root.Kind() == reflect.Slice || root.Kind() == reflect.Array {
		for index := 0; index < root.Len(); index++ {
			appendValue(root.Index(index))
		}
		return values
	}
	appendValue(root)
	return values
}
