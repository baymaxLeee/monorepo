package httpapi

import (
	a "github.com/example/monorepo/canvas/internal/application"
	"github.com/go-chi/chi/v5"
	"net/http"
	"reflect"
)

func init() {
	workerRoutes = append(workerRoutes, Route{"POST", "/worker/frames/{taskRunId}/execute", "canvasExecuteFrames", nil, reflect.TypeFor[a.FrameExecutionResult](), func(s *a.Service, _ a.Actor, r *http.Request) (any, error) {
		return s.ExecuteFrames(r.Context(), chi.URLParam(r, "taskRunId"))
	}})
}
