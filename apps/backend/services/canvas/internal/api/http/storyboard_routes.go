package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

var storyboardRoutes = []Route{
	{"GET", "/canvases/{id}/storyboards/{draftId}", "canvasGetStoryboard", nil, reflect.TypeFor[c.StoryboardDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.GetStoryboard(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "draftId"))
	}},
	{"GET", "/canvases/{id}/storyboards/{draftId}/stream", "canvasStreamStoryboard", nil, reflect.TypeFor[c.StoryboardDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.StreamStoryboard(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "draftId"))
	}},
	{"PATCH", "/canvases/{id}/storyboards/{draftId}", "canvasUpdateStoryboard", reflect.TypeFor[c.StoryboardDraftUpdate](), reflect.TypeFor[c.StoryboardDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.StoryboardDraftUpdate
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateStoryboard(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "draftId"), in)
	}},
	{"POST", "/canvases/{id}/storyboards", "canvasStartStoryboard", reflect.TypeFor[c.StoryboardDraftInput](), reflect.TypeFor[c.StoryboardDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.StoryboardDraftInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.StartStoryboard(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
	{"GET", "/canvases/{id}/storyboards", "canvasListStoryboards", nil, reflect.TypeFor[c.StoryboardDraftList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListStoryboards(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"POST", "/canvases/{id}/storyboards/{draftId}/cancel", "canvasCancelStoryboard", nil, reflect.TypeFor[c.StoryboardDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CancelStoryboard(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "draftId"))
	}},
	{"POST", "/canvases/{id}/storyboards/{draftId}/confirm", "canvasConfirmStoryboard", reflect.TypeFor[c.StoryboardConfirm](), reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.StoryboardConfirm
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.ConfirmStoryboard(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "draftId"), in)
	}},
}

var storyboardWorkerRoutes = []Route{
	{"POST", "/worker/storyboards/{draftId}/progress", "canvasCommitStoryboardProgress", reflect.TypeFor[c.StoryboardProgress](), reflect.TypeFor[c.StoryboardDraft](), func(s *a.Service, _ a.Actor, r *http.Request) (any, error) {
		var in c.StoryboardProgress
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CommitStoryboardProgress(r.Context(), chi.URLParam(r, "draftId"), in)
	}},
}

func init() { workerRoutes = append(workerRoutes, storyboardWorkerRoutes...) }
