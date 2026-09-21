package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

func init() { Routes = append(Routes, managementRoutes...) }

var managementRoutes = []Route{
	{"GET", "/projects/{projectId}/management", "canvasProjectManagement", nil, reflect.TypeFor[c.ProjectManagement](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ProjectManagement(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"PUT", "/projects/{projectId}/members", "canvasUpdateProjectMembers", reflect.TypeFor[c.UpdateProjectMembers](), reflect.TypeFor[c.ProjectManagement](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateProjectMembers
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateProjectMembers(r.Context(), actor, chi.URLParam(r, "projectId"), in, r.Header.Get("Authorization"))
	}},
	{"PUT", "/projects/{projectId}/models", "canvasUpdateProjectModels", reflect.TypeFor[c.UpdateProjectModels](), reflect.TypeFor[c.ProjectManagement](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateProjectModels
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateProjectModels(r.Context(), actor, chi.URLParam(r, "projectId"), in)
	}},
	{"GET", "/projects/{projectId}/models", "canvasProjectProviders", nil, reflect.TypeFor[c.ProjectProviderList](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ProjectProviders(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"PUT", "/projects/{projectId}/usage-limit", "canvasUpdateProjectUsageLimit", reflect.TypeFor[c.UpdateProjectUsageLimit](), reflect.TypeFor[c.ProjectManagement](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.UpdateProjectUsageLimit
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.UpdateProjectUsageLimit(r.Context(), actor, chi.URLParam(r, "projectId"), in)
	}},
	{"GET", "/projects/{projectId}/usage", "canvasProjectUsage", nil, reflect.TypeFor[c.ProjectUsage](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ProjectUsage(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
	{"GET", "/projects/{projectId}/usage.xlsx", "canvasProjectUsageWorkbook", nil, reflect.TypeFor[string](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.ProjectUsageWorkbook(r.Context(), actor, chi.URLParam(r, "projectId"))
	}},
}
