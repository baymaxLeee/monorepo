package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"reflect"
	"strings"

	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
)

type Route struct {
	Method, Path, OperationID string
	Input, Output             reflect.Type
	Handle                    func(*a.Service, a.Actor, *http.Request) (any, error)
}

var Routes = []Route{
	{"GET", "/projects/{projectId}/resources", "canvasListResources", nil, reflect.TypeFor[c.ResourceList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListResources(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"POST", "/projects/{projectId}/resources", "canvasCreateResource", reflect.TypeFor[c.ResourceInput](), reflect.TypeFor[c.Resource](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ResourceInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.SaveResource(r.Context(), actor, chi.URLParam(r, "projectId"), "", in)
	}},
	{"PATCH", "/projects/{projectId}/resources/{resourceId}", "canvasUpdateResource", reflect.TypeFor[c.ResourceInput](), reflect.TypeFor[c.Resource](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ResourceInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.SaveResource(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "resourceId"), in)
	}},
	{"DELETE", "/projects/{projectId}/resources/{resourceId}", "canvasDeleteResource", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Deleted](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.DeleteResource(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "resourceId"), in)
	}},
	{"GET", "/projects/{projectId}/resources/{resourceId}/assets", "canvasListResourceAssets", nil, reflect.TypeFor[c.ResourceAssetList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListResourceAssets(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "resourceId"))
	}},
	{"POST", "/projects/{projectId}/resources/{resourceId}/uploads/{assetId}", "canvasUploadResourceAsset", nil, reflect.TypeFor[c.ResourceAsset](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.UploadResourceAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "resourceId"), chi.URLParam(r, "assetId"), r.URL.Query().Get("name"), r.Body)
	}},
	{"GET", "/projects/{projectId}/resource-assets/{assetId}/content", "canvasResourceContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ResourceContent(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	}},
	{"POST", "/canvases/{id}/resource-copies", "canvasCopyResourceToCanvas", reflect.TypeFor[c.MaterializeResource](), reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.MaterializeResource
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CopyResourceToCanvas(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},

	{"POST", "/canvases/{id}/uploads/{nodeId}", "canvasUploadNode", nil, reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.UploadNode(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), r.URL.Query().Get("name"), r.Body)
	}},
	{"GET", "/canvases/{id}/nodes/{nodeId}/content", "canvasNodeContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.NodeContent(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"))
	}},
	{"POST", "/canvases/{id}/nodes/{nodeId}/generations", "canvasStartGeneration", reflect.TypeFor[c.StartGeneration](), reflect.TypeFor[c.Generation](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.StartGeneration
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.StartGeneration(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), in)
	}},
	{"GET", "/canvases/{id}/nodes/{nodeId}/generations", "canvasListGenerations", nil, reflect.TypeFor[c.GenerationList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListGenerations(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"))
	}},
	{"POST", "/canvases/{id}/generations/{generationId}/cancel", "canvasCancelGeneration", nil, reflect.TypeFor[c.Generation](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CancelGeneration(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "generationId"))
	}},
	{"POST", "/canvases/{id}/generations/{generationId}/apply", "canvasApplyGeneration", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.ApplyGeneration(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "generationId"), in)
	}},

	{"GET", "/projects/{projectId}", "canvasGetProject", nil, reflect.TypeFor[c.Project](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.GetProject(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"PATCH", "/projects/{projectId}", "canvasUpdateProject", reflect.TypeFor[c.UpdateProject](), reflect.TypeFor[c.Project](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateProject
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateProject(r.Context(), actor, chi.URLParam(r, "projectId"), in)
	}},
	{"DELETE", "/projects/{projectId}", "canvasDeleteProject", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Deleted](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.DeleteProject(r.Context(), actor, chi.URLParam(r, "projectId"), in)
	}},
	{"PATCH", "/canvases/{id}", "canvasUpdateBoard", reflect.TypeFor[c.UpdateBoard](), reflect.TypeFor[c.Board](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateBoard
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateBoard(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
	{"DELETE", "/canvases/{id}", "canvasDeleteBoard", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Deleted](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.DeleteBoard(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},

	{"GET", "/projects", "canvasListProjects", nil, reflect.TypeFor[c.ProjectList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListProjects(r.Context(), actor)
	}},
	{"POST", "/projects", "canvasCreateProject", reflect.TypeFor[c.CreateProject](), reflect.TypeFor[c.Project](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.CreateProject
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CreateProject(r.Context(), actor, in)
	}},
	{"GET", "/projects/{projectId}/canvases", "canvasListBoards", nil, reflect.TypeFor[c.BoardList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListBoards(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"POST", "/projects/{projectId}/canvases", "canvasCreateBoard", reflect.TypeFor[c.CreateBoard](), reflect.TypeFor[c.Board](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.CreateBoard
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CreateBoard(r.Context(), actor, chi.URLParam(r, "projectId"), in)
	}},
	{"GET", "/canvases/{id}/graph", "canvasGetGraph", nil, reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.Graph(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"POST", "/canvases/{id}/mutations", "canvasMutateGraph", reflect.TypeFor[c.Mutation](), reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.Mutation
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.Mutate(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
}

func decode(r *http.Request, v any) error {
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return a.Invalid("invalid request body")
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return a.Invalid("request must contain one JSON object")
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Warn("response write failed", "error", err)
	}
}
func writeError(w http.ResponseWriter, err error) {
	status, code, message := 500, "internal_error", "internal service error"
	var e *a.Error
	if errors.As(err, &e) {
		status, code, message = e.Status, e.Code, e.Message
	} else {
		slog.Error("canvas request failed", "error", err)
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": http.StatusText(status), "status": status, "code": code, "detail": message})
}
func Router(s *a.Service, token string) http.Handler {
	r := chi.NewRouter()
	r.Get("/livez", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	ready := func(w http.ResponseWriter, r *http.Request) {
		db, err := s.DB.DB()
		if err == nil {
			err = db.PingContext(r.Context())
		}
		if err != nil {
			writeJSON(w, 503, map[string]string{"status": "degraded"})
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
	r.Get("/readyz", ready)
	r.Get("/healthz", ready)
	register := func(router chi.Router, internal bool) {
		for _, route := range Routes {
			router.MethodFunc(route.Method, route.Path, func(w http.ResponseWriter, r *http.Request) {
				if internal && (subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Internal-Token")), []byte(token)) != 1 || r.Header.Get("X-Caller-Service") != "chat") {
					writeError(w, &a.Error{Status: 401, Code: "unauthorized", Message: "invalid service identity"})
					return
				}
				actor := a.Actor{UserID: r.Header.Get("X-Auth-User-ID"), TenantID: r.Header.Get("X-Auth-Tenant-ID"), WorkspaceID: r.Header.Get("X-Auth-Workspace-ID"), WorkspaceRole: r.Header.Get("X-Auth-Workspace-Role")}
				if actor.UserID == "" || actor.TenantID == "" || actor.WorkspaceID == "" {
					writeError(w, &a.Error{Status: 401, Code: "unauthorized", Message: "missing authenticated identity"})
					return
				}
				limit := int64(8 << 20)
				if route.OperationID == "canvasUploadNode" || route.OperationID == "canvasUploadResourceAsset" {
					limit = 512 << 20
				}
				r.Body = http.MaxBytesReader(w, r.Body, limit)
				value, err := route.Handle(s, actor, r)
				if err != nil {
					writeError(w, err)
					return
				}
				if content, ok := value.(a.MediaContent); ok {
					defer content.Body.Close()
					w.Header().Set("Content-Type", content.MIME)
					w.Header().Set("X-Content-Type-Options", "nosniff")
					w.Header().Set("Cache-Control", "private, no-store")
					if _, err := io.Copy(w, content.Body); err != nil {
						slog.Warn("media response interrupted", "error", err)
					}
					return
				}
				writeJSON(w, 200, value)
			})
		}
	}
	register(r, false)
	r.Route("/internal", func(inner chi.Router) { register(inner, true) })
	return r
}
func OpenAPI() map[string]any {
	schemas := map[string]any{}
	var schema func(reflect.Type) map[string]any
	schema = func(t reflect.Type) map[string]any {
		switch t.Kind() {
		case reflect.String:
			return map[string]any{"type": "string"}
		case reflect.Bool:
			return map[string]any{"type": "boolean"}
		case reflect.Float32, reflect.Float64:
			return map[string]any{"type": "number"}
		case reflect.Int, reflect.Int16, reflect.Int32, reflect.Int64:
			return map[string]any{"type": "integer"}
		case reflect.Slice:
			return map[string]any{"type": "array", "items": schema(t.Elem())}
		case reflect.Struct:
			name := "Canvas" + t.Name()
			if _, ok := schemas[name]; !ok {
				props := map[string]any{}
				required := []string{}
				schemas[name] = map[string]any{}
				for i := 0; i < t.NumField(); i++ {
					f := t.Field(i)
					key := strings.Split(f.Tag.Get("json"), ",")[0]
					if key == "" || key == "-" {
						continue
					}
					props[key] = schema(f.Type)
					required = append(required, key)
				}
				schemas[name] = map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
			}
			return map[string]any{"$ref": "#/components/schemas/" + name}
		}
		panic("unsupported OpenAPI type: " + t.String())
	}
	paths := map[string]any{}
	for _, r := range Routes {
		op := map[string]any{"operationId": r.OperationID, "tags": []string{"canvas"}, "responses": map[string]any{"200": map[string]any{"description": "Success", "content": map[string]any{"application/json": map[string]any{"schema": schema(r.Output)}}}, "400": map[string]any{"description": "Invalid input"}, "401": map[string]any{"description": "Authentication required"}, "404": map[string]any{"description": "Missing or inaccessible resource"}, "409": map[string]any{"description": "Revision conflict"}}}
		params := []any{}
		for _, part := range strings.Split(r.Path, "/") {
			if strings.HasPrefix(part, "{") {
				params = append(params, map[string]any{"name": strings.Trim(part, "{}"), "in": "path", "required": true, "schema": map[string]any{"type": "string"}})
			}
		}
		if r.OperationID == "canvasUploadNode" || r.OperationID == "canvasUploadResourceAsset" {
			params = append(params, map[string]any{"name": "name", "in": "query", "required": true, "schema": map[string]any{"type": "string"}})
			op["requestBody"] = map[string]any{"required": true, "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}
		}
		if r.OperationID == "canvasNodeContent" || r.OperationID == "canvasResourceContent" {
			op["responses"].(map[string]any)["200"] = map[string]any{"description": "Media content", "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}
		}
		if len(params) > 0 {
			op["parameters"] = params
		}
		if r.Input != nil {
			op["requestBody"] = map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": schema(r.Input)}}}
		}
		if _, ok := paths[r.Path]; !ok {
			paths[r.Path] = map[string]any{}
		}
		paths[r.Path].(map[string]any)[strings.ToLower(r.Method)] = op
	}
	return map[string]any{"openapi": "3.0.3", "info": map[string]any{"title": "Canvas Service", "version": "1.0.0"}, "paths": paths, "components": map[string]any{"schemas": schemas}}
}
