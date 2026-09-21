package projectstatistics

import "context"

type Scope struct {
	TenantID    string
	WorkspaceID *string
}

type Fields uint8

const (
	CanvasCountField Fields = 1 << iota
	SelectedVideoDurationField
	ResourceCountField
	AllFields = CanvasCountField | SelectedVideoDurationField | ResourceCountField
)

func (f Fields) Has(field Fields) bool { return f&field != 0 }

type Rebuilder interface {
	Rebuild(context.Context, Scope, string, Fields) error
}

type FailureReporter interface {
	ReportProjectStatisticsFailure(context.Context, error)
}

type Projector interface {
	Refresh(context.Context, Scope, string, Fields)
}
