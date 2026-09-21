package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

func init() { Routes = append(Routes, assetMatchingRoutes...) }

var assetMatchingRoutes = []Route{
	{"GET", "/canvases/{id}/nodes/{nodeId}/asset-matches/latest", "canvasLatestAssetMatch", nil, reflect.TypeFor[c.AssetMatchRun](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.LatestAssetMatch(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"))
	}},
	{"POST", "/canvases/{id}/nodes/{nodeId}/asset-matches", "canvasStartAssetMatch", reflect.TypeFor[c.StartAssetMatch](), reflect.TypeFor[c.AssetMatchRun](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.StartAssetMatch
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.StartAssetMatch(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), in)
	}},
	{"GET", "/canvases/{id}/nodes/{nodeId}/asset-matches/{runId}", "canvasGetAssetMatch", nil, reflect.TypeFor[c.AssetMatchRun](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.GetAssetMatch(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), chi.URLParam(r, "runId"))
	}},
	{"POST", "/canvases/{id}/nodes/{nodeId}/asset-matches/{runId}/cancel", "canvasCancelAssetMatch", nil, reflect.TypeFor[c.AssetMatchRun](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CancelAssetMatch(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), chi.URLParam(r, "runId"))
	}},
}
