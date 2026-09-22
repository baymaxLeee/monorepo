package projectstatistics

import (
	"context"
	"time"
)

const refreshTimeout = 5 * time.Second

type Service struct {
	rebuilder Rebuilder
	reporter  FailureReporter
}

func NewService(rebuilder Rebuilder, reporter FailureReporter) *Service {
	return &Service{rebuilder: rebuilder, reporter: reporter}
}

func (s *Service) Refresh(ctx context.Context, scope Scope, projectID string, fields Fields) {
	fields &= AllFields
	if fields == 0 {
		return
	}
	refreshCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), refreshTimeout)
	defer cancel()
	if err := s.rebuilder.Rebuild(refreshCtx, scope, projectID, fields); err != nil && s.reporter != nil {
		s.reporter.ReportProjectStatisticsFailure(ctx, err)
	}
}
