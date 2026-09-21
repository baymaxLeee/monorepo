package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

func init() { Routes = append(Routes, resourceGenerationRoutes...) }

var resourceGenerationRoutes = []Route{
	{"POST", "/projects/{projectId}/resources/{resourceId}/generated-assets", "canvasCreateGeneratedResourceAsset", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.ResourceAsset](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CreateGeneratedResourceAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "resourceId"), in)
	}},
	{"GET", "/projects/{projectId}/resource-assets/{assetId}/generation", "canvasGetResourceGeneration", nil, reflect.TypeFor[c.ResourceGenerationDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.GetResourceGeneration(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	}},
	{"PUT", "/projects/{projectId}/resource-assets/{assetId}/generation", "canvasUpdateResourceGeneration", reflect.TypeFor[c.UpdateResourceGeneration](), reflect.TypeFor[c.ResourceGenerationDraft](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateResourceGeneration
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateResourceGeneration(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
	{"POST", "/projects/{projectId}/resource-assets/{assetId}/generation/runs", "canvasStartResourceGeneration", reflect.TypeFor[c.StartGeneration](), reflect.TypeFor[c.Generation](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.StartGeneration
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.StartResourceGeneration(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
	{"GET", "/projects/{projectId}/resource-assets/{assetId}/generation/runs", "canvasListResourceGenerationRuns", nil, reflect.TypeFor[c.GenerationList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListResourceGenerationRuns(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	}},
	{"POST", "/projects/{projectId}/resource-assets/{assetId}/generation/runs/{runId}/cancel", "canvasCancelResourceGeneration", nil, reflect.TypeFor[c.Generation](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CancelResourceGeneration(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), chi.URLParam(r, "runId"))
	}},
}
