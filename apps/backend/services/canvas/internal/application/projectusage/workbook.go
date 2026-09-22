package projectusage

import (
	"context"
	"fmt"
	"os"
)

// WorkbookResult is the synchronous transport result used while the monorepo
// HTTP boundary is being replaced by AgentFrame's temporary-file download API.
type WorkbookResult struct {
	RowCount            int64
	PendingBillingCount int64
}

// WriteWorkbook keeps file delivery in the transport adapter; billing rows and
// workbook generation continue to use the AgentFrame implementation.
func (exporter *Exporter) WriteWorkbook(ctx context.Context, file *os.File, input DownloadXLSXInput) (WorkbookResult, error) {
	if !validDownloadInput(input, exporter.limits) || exporter.repository == nil {
		return WorkbookResult{}, fmt.Errorf("invalid usage export request")
	}
	release, acquired := exporter.gate.acquire(input.Scope.CallerID)
	if !acquired {
		return WorkbookResult{}, fmt.Errorf("usage export is already running")
	}
	defer release()
	ctx, cancel := context.WithTimeout(ctx, exporter.limits.GenerationTimeout)
	defer cancel()
	result, err := exporter.generateXLSX(ctx, file, input)
	return WorkbookResult{RowCount: result.rows, PendingBillingCount: result.pending}, err
}
