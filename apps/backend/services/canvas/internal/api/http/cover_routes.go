package httpapi

import (
	"net/http"
	"reflect"
	"strconv"

	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
)

func init() { Routes = append(Routes, coverRoutes...) }

func expectedRevision(r *http.Request) (int64, error) {
	revision, err := strconv.ParseInt(r.URL.Query().Get("expected_revision"), 10, 64)
	if err != nil || revision < 1 {
		return 0, a.Invalid("expected revision is required")
	}
	return revision, nil
}

var coverRoutes = []Route{
	{"PUT", "/projects/{projectId}/cover", "canvasUploadProjectCover", nil, reflect.TypeFor[c.Project](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		revision, err := expectedRevision(r)
		if err != nil {
			return nil, err
		}
		return s.UploadProjectCover(r.Context(), actor, chi.URLParam(r, "projectId"), revision, r.Body)
	}},
	{"DELETE", "/projects/{projectId}/cover", "canvasClearProjectCover", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Project](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.ClearProjectCover(r.Context(), actor, chi.URLParam(r, "projectId"), in)
	}},
	{"GET", "/projects/{projectId}/cover/content", "canvasProjectCoverContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ProjectCoverContent(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"PUT", "/canvases/{id}/cover", "canvasUploadBoardCover", nil, reflect.TypeFor[c.Board](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		revision, err := expectedRevision(r)
		if err != nil {
			return nil, err
		}
		return s.UploadBoardCover(r.Context(), actor, chi.URLParam(r, "id"), revision, r.Body)
	}},
	{"DELETE", "/canvases/{id}/cover", "canvasClearBoardCover", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Board](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.ClearBoardCover(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
	{"GET", "/canvases/{id}/cover/content", "canvasBoardCoverContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.BoardCoverContent(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"PATCH", "/canvases/{id}/view", "canvasUpdateCanvasView", reflect.TypeFor[c.UpdateCanvasView](), reflect.TypeFor[c.Board](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateCanvasView
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateCanvasView(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
}
