package canvas

import (
	"context"
	"time"

	"github.com/example/monorepo/canvas/internal/platform/logcontext"
)

const canvasStatisticsRefreshTimeout = 5 * time.Second

type CanvasStatisticsService struct {
	rebuilder CanvasStatisticsRebuilder
	reporter  CanvasStatisticsFailureReporter
}

func NewCanvasStatisticsService(
	rebuilder CanvasStatisticsRebuilder,
	reporter CanvasStatisticsFailureReporter,
) *CanvasStatisticsService {
	return &CanvasStatisticsService{rebuilder: rebuilder, reporter: reporter}
}

// Refresh runs outside the owning business transaction so a reconstructable
// projection can never introduce Canvas-after-Node lock inversion.
func (s *CanvasStatisticsService) Refresh(ctx context.Context, scope Scope, projectID, canvasID string) {
	refreshCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), canvasStatisticsRefreshTimeout)
	defer cancel()
	if err := s.rebuilder.Rebuild(refreshCtx, scope, projectID, canvasID); err != nil && s.reporter != nil {
		reportCtx := logcontext.WithBusiness(ctx, logcontext.Business{
			TenantID: scope.TenantID, WorkspaceID: scope.WorkspaceID, ProjectID: projectID, CanvasID: canvasID,
		})
		s.reporter.ReportCanvasStatisticsFailure(reportCtx, err)
	}
}

type noopCanvasStatisticsProjector struct{}

func (noopCanvasStatisticsProjector) Refresh(context.Context, Scope, string, string) {}
