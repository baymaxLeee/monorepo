package httpapi

import (
	"crypto/subtle"
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

var archiveRoutes = []Route{
	{"GET", "/canvases/{id}/generation-status", "canvasGenerationStatus", nil, reflect.TypeFor[c.GenerationStateList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CanvasGenerationStatus(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"POST", "/canvases/{id}/generations", "canvasStartAllVideoGenerations", reflect.TypeFor[c.StartCanvasGeneration](), reflect.TypeFor[c.CanvasGenerationBatch](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var input c.StartCanvasGeneration
		if err := decode(r, &input); err != nil {
			return nil, err
		}
		return s.StartCanvasGeneration(r.Context(), actor, chi.URLParam(r, "id"), input)
	}},
	{"POST", "/canvases/{id}/archives", "canvasCreateArchive", nil, reflect.TypeFor[c.Archive](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CreateArchive(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"GET", "/canvases/{id}/archives", "canvasListArchives", nil, reflect.TypeFor[c.ArchiveList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListArchives(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"POST", "/canvases/{id}/archives/{archiveId}/cancel", "canvasCancelArchive", nil, reflect.TypeFor[c.Deleted](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CancelArchive(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "archiveId"))
	}},
	{"GET", "/canvases/{id}/archives/{archiveId}/content", "canvasArchiveContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ArchiveContent(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "archiveId"))
	}},
}
var workerRoutes = []Route{
	{"POST", "/worker/archives/{archiveId}/execute", "canvasExecuteArchive", nil, reflect.TypeFor[c.Archive](), func(s *a.Service, _ a.Actor, r *http.Request) (any, error) {
		return s.ExecuteArchive(r.Context(), chi.URLParam(r, "archiveId"))
	}},
}

func registerWorkerRoutes(r chi.Router, s *a.Service, token string) {
	for _, route := range workerRoutes {
		r.MethodFunc(route.Method, "/internal"+route.Path, func(w http.ResponseWriter, r *http.Request) {
			if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Internal-Token")), []byte(token)) != 1 || r.Header.Get("X-Caller-Service") != "executor" {
				writeError(w, &a.Error{Status: 401, Code: "unauthorized", Message: "invalid service identity"})
				return
			}
			value, err := route.Handle(s, a.Actor{}, r)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, 200, value)
		})
	}
}
