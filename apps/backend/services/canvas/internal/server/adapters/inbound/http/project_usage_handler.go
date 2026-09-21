package http

import (
	"context"

	"github.com/example/monorepo/canvas/internal/platform/http/topcontext"
	applicationprojectusage "github.com/example/monorepo/canvas/internal/server/application/projectusage"
	contractprojectusage "github.com/example/monorepo/canvas/internal/server/contracts/projectusage"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

type projectUsageExporter interface {
	DownloadXLSX(context.Context, applicationprojectusage.DownloadXLSXInput) (applicationprojectusage.DownloadXLSXResult, error)
}

// ProjectUsageHandler adapts the public project usage export Action to the
// synchronous exporter.
type ProjectUsageHandler struct {
	exporter projectUsageExporter
}

func NewProjectUsageHandler(exporter *applicationprojectusage.Exporter) *ProjectUsageHandler {
	return newProjectUsageHandler(exporter)
}

func newProjectUsageHandler(exporter projectUsageExporter) *ProjectUsageHandler {
	return &ProjectUsageHandler{exporter: exporter}
}

func (handler *ProjectUsageHandler) DownloadProjectUsageXLSX(
	ctx context.Context,
	request *contractprojectusage.DownloadProjectUsageXLSXRequest,
) (*contractprojectusage.DownloadProjectUsageXLSXResponse, error) {
	if err := requireAction(ctx, "DownloadProjectUsageXLSX"); err != nil {
		return nil, err
	}
	if request == nil || handler.exporter == nil {
		return nil, errno.New(errno.ErrInvalidArgument)
	}
	request.Top = topParam(ctx)
	metadata, _ := topcontext.MetadataFromContext(ctx)
	result, err := handler.exporter.DownloadXLSX(ctx, applicationprojectusage.DownloadXLSXInput{
		Scope: applicationprojectusage.ExportScope{
			TenantID: metadata.TenantID, WorkspaceID: nullableWorkspaceID(request.WorkspaceID), CallerID: metadata.UserID,
		},
		ProjectID: request.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	return &contractprojectusage.DownloadProjectUsageXLSXResponse{
		FileName:            result.FileName,
		DownloadURL:         result.DownloadURL,
		ExpiresAt:           timestamp(result.ExpiresAt),
		RowCount:            result.RowCount,
		FileSize:            result.FileSize,
		PendingBillingCount: result.PendingBillingCount,
	}, nil
}
