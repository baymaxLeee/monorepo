package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
	"strconv"
)

var resourceRoutes = []Route{
	{"POST", "/projects/{projectId}/resource-assets/{assetId}/uploads/{revision}", "canvasReplaceResourceAsset", nil, reflect.TypeFor[c.ResourceAsset](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		revision, err := strconv.ParseInt(chi.URLParam(r, "revision"), 10, 64)
		if err != nil {
			return nil, a.Invalid("invalid revision")
		}
		return s.ReplaceResourceAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), revision, r.Body)
	}},
	{"GET", "/projects/{projectId}/resource-assets/{assetId}/versions", "canvasListResourceVersions", nil, reflect.TypeFor[c.ResourceVersionList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListResourceVersions(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	}},
	{"GET", "/projects/{projectId}/resource-assets/{assetId}/versions/{revision}/content", "canvasResourceVersionContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		revision, err := strconv.ParseInt(chi.URLParam(r, "revision"), 10, 64)
		if err != nil {
			return nil, a.Invalid("invalid revision")
		}
		return s.ResourceVersionContent(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), revision)
	}},
	{"PATCH", "/projects/{projectId}/resource-assets/{assetId}", "canvasUpdateResourceAsset", reflect.TypeFor[c.ResourceAssetUpdate](), reflect.TypeFor[c.ResourceAsset](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ResourceAssetUpdate
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateResourceAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
	{"POST", "/projects/{projectId}/resource-assets/{assetId}/primary", "canvasSetPrimaryResourceAsset", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Resource](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.SetPrimaryResourceAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
	{"DELETE", "/projects/{projectId}/resource-assets/{assetId}", "canvasDeleteResourceAsset", reflect.TypeFor[c.ExpectedRevision](), reflect.TypeFor[c.Deleted](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ExpectedRevision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.DeleteResourceAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
}
