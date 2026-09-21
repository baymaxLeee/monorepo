package httpapi

import (
	"net/http"
	"reflect"

	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
)

func init() { Routes = append(Routes, projectAssetRoutes...) }

var projectAssetRoutes = []Route{
	{"POST", "/projects/{projectId}/assets/{clientId}", "canvasUploadProjectAsset", nil, reflect.TypeFor[c.ProjectAsset](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.UploadProjectAsset(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "clientId"), r.URL.Query().Get("name"), r.Body)
	}},
	{"GET", "/projects/{projectId}/assets/{assetId}/content", "canvasProjectAssetContent", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ProjectAssetContent(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"))
	}},
	{"POST", "/projects/{projectId}/assets/{assetId}/reviews", "canvasSubmitProjectAssetReview", reflect.TypeFor[c.SubmitAssetReview](), reflect.TypeFor[c.AssetReview](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.SubmitAssetReview
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.SubmitProjectAssetReview(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
}
