package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	c "github.com/example/monorepo/canvas/internal/application/contracts"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

func init() { Routes = append(Routes, creativeRoutes...) }

var creativeRoutes = []Route{
	{"POST", "/canvases/{id}/nodes/{nodeId}/copies", "canvasCopyNode", reflect.TypeFor[c.CopyNode](), reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.CopyNode
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CopyCanvasNode(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), in)
	}},
	{"POST", "/canvases/{id}/nodes/{nodeId}/resource", "canvasResourceFromNode", reflect.TypeFor[c.ResourceFromNode](), reflect.TypeFor[c.Resource](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.ResourceFromNode
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.ResourceFromNode(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"), in)
	}},
	{"GET", "/canvases/{id}/view", "canvasGetView", nil, reflect.TypeFor[c.CanvasView](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.GetCanvasView(r.Context(), actor, chi.URLParam(r, "id"))
	}},
	{"PUT", "/canvases/{id}/view", "canvasSaveView", reflect.TypeFor[c.CanvasView](), reflect.TypeFor[c.CanvasView](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.CanvasView
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.SaveCanvasView(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
	{"POST", "/canvases/{id}/asset-copies", "canvasCopyAsset", reflect.TypeFor[c.CopyAsset](), reflect.TypeFor[c.Graph](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		var in c.CopyAsset
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return s.CopyCanvasAsset(r.Context(), actor, chi.URLParam(r, "id"), in)
	}},
	{"GET", "/canvases/{id}/nodes/{nodeId}/frames", "canvasNodeFrames", nil, reflect.TypeFor[c.NodeFrames](), func(s *a.Service, actor a.Actor, r *http.Request) (any, error) {
		return s.CanvasNodeFrames(r.Context(), actor, chi.URLParam(r, "id"), chi.URLParam(r, "nodeId"))
	}},
}
