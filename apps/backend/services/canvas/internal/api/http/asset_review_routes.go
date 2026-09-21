package httpapi

import (
	"net/http"
	"reflect"

	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
)

func init() { Routes = append(Routes, assetReviewRoutes...) }

var assetReviewRoutes = []Route{
	{"GET", "/projects/{projectId}/benefit-packages", "canvasListAvailableBenefitPackages", nil, reflect.TypeFor[c.BenefitPackageChoiceList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListAvailableBenefitPackages(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"GET", "/projects/{projectId}/asset-reviews", "canvasListAssetReviews", nil, reflect.TypeFor[c.AssetReviewList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ListAssetReviews(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"POST", "/projects/{projectId}/resource-assets/{assetId}/reviews", "canvasSubmitAssetReview", reflect.TypeFor[c.SubmitAssetReview](), reflect.TypeFor[c.AssetReview](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.SubmitAssetReview
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.SubmitAssetReview(r.Context(), actor, chi.URLParam(r, "projectId"), chi.URLParam(r, "assetId"), in)
	}},
}
