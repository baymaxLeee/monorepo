package application

import (
	"context"
	"database/sql"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	c "github.com/example/monorepo/canvas/internal/application/contracts"
	p "github.com/example/monorepo/canvas/internal/infrastructure/persistence"
	usage "github.com/example/monorepo/canvas/internal/server/application/projectusage"
	"gorm.io/gorm"
)

type managementUsageRepository struct{ db *gorm.DB }
type usageSnapshotKey struct{}

type usageGenerationRow struct {
	ID                   string
	CreatedAt            time.Time
	TaskType             string
	ProviderID           string
	UserID               string
	Status               string
	ReservedAmountMicros int64
	UsageSettled         bool
	ModelName            string
	ModelID              string
	Currency             string
	EstimateKnown        bool
}

func (r managementUsageRepository) database(ctx context.Context) *gorm.DB {
	if tx, ok := ctx.Value(usageSnapshotKey{}).(*gorm.DB); ok {
		return tx.WithContext(ctx)
	}
	return r.db.WithContext(ctx)
}
func (r managementUsageRepository) GetProjectName(ctx context.Context, input usage.GetProjectNameInput) (string, error) {
	var row p.Project
	err := r.database(ctx).Where("id = ? AND tenant_id = ? AND workspace_id = ?", input.ProjectID, input.TenantID, input.WorkspaceID).First(&row).Error
	return row.Name, err
}
func (r managementUsageRepository) WithReadOnlySnapshot(ctx context.Context, f func(context.Context) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return f(context.WithValue(ctx, usageSnapshotKey{}, tx)) }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
}
func (r managementUsageRepository) ListExportPage(ctx context.Context, input usage.ExportPageQuery) ([]usage.ExportRow, error) {
	union := `
		SELECT id, created_at,
		  CASE task_type WHEN 'canvas-image-generation' THEN 'IMAGE_GENERATION' WHEN 'canvas-video-generation' THEN 'CANVAS_NODE_VIDEO_GENERATION' ELSE 'CANVAS_NODE_TEXT_GENERATION' END AS task_type,
		  provider_id, user_id, status, reserved_amount_micros, usage_settled
		FROM canvas_generations
		WHERE tenant_id = ? AND workspace_id = ? AND canvas_id IN (SELECT id FROM canvases WHERE project_id = ?)
		UNION ALL
		SELECT id, created_at, 'IMAGE_GENERATION', provider_id, user_id, status, reserved_amount_micros, usage_settled
		FROM resource_image_runs WHERE tenant_id = ? AND workspace_id = ? AND project_id = ?
		UNION ALL
		SELECT id, created_at, 'CANVAS_STORYBOARD_GENERATION', COALESCE(input->>'provider_id', ''), user_id, status, 0,
		  false
		FROM canvas_storyboard_sessions
		WHERE tenant_id = ? AND workspace_id = ? AND canvas_id IN (SELECT id FROM canvases WHERE project_id = ?)`
	args := []any{input.TenantID, input.WorkspaceID, input.ProjectID, input.TenantID, input.WorkspaceID, input.ProjectID, input.TenantID, input.WorkspaceID, input.ProjectID}
	query := r.database(ctx).Table("(?) AS generation_usage", gorm.Expr(union, args...)).
		Select("generation_usage.*, COALESCE(metadata.model_name, generation_usage.provider_id) AS model_name, COALESCE(metadata.model_id, generation_usage.provider_id) AS model_id, COALESCE(metadata.currency, '') AS currency, COALESCE(metadata.estimate_known, false) AS estimate_known").
		Joins("LEFT JOIN generation_usage_metadata metadata ON metadata.generation_id = generation_usage.id AND metadata.tenant_id = ? AND metadata.workspace_id = ? AND metadata.project_id = ?", input.TenantID, input.WorkspaceID, input.ProjectID)
	if input.AfterConsumedAt != nil {
		query = query.Where("(created_at, id) > (?, ?)", *input.AfterConsumedAt, input.AfterTaskRunID)
	}
	var rows []usageGenerationRow
	if err := query.Order("created_at, id").Limit(input.Limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]usage.ExportRow, 0, len(rows))
	for _, row := range rows {
		resourceType := "TEXT"
		if row.TaskType == "IMAGE_GENERATION" {
			resourceType = "IMAGE"
		} else if row.TaskType == "CANVAS_NODE_VIDEO_GENERATION" {
			resourceType = "VIDEO"
		}
		billingStatus := usage.BillingStatusPending
		var amount, currency *string
		if row.UsageSettled && row.Status == "completed" && row.EstimateKnown {
			billingStatus = usage.BillingStatusEstimated
			value := "0"
			if row.Status == "completed" {
				value = strconv.FormatInt(row.ReservedAmountMicros, 10)
				if len(value) <= 6 {
					value = strings.Repeat("0", 7-len(value)) + value
				}
				value = strings.TrimRight(strings.TrimRight(value[:len(value)-6]+"."+value[len(value)-6:], "0"), ".")
			}
			unit := row.Currency
			amount, currency = &value, &unit
		} else if row.UsageSettled && (row.Status == "failed" || row.Status == "cancelled" || row.Status == "discarded") {
			billingStatus = usage.BillingStatusReady
			value := "0"
			unit := row.Currency
			if unit == "" {
				unit = "CNY"
			}
			amount, currency = &value, &unit
		}
		result = append(result, usage.ExportRow{TaskRunID: row.ID, ConsumedAt: row.CreatedAt, TaskType: row.TaskType, ResourceType: resourceType, ModelID: row.ModelID, ModelName: row.ModelName, ModelSource: "DIRECT_PROVIDER", CreatedBy: row.UserID, BillingStatus: billingStatus, TotalAmount: amount, Currency: currency})
	}
	return result, nil
}
func NewProjectUsageExporter(db *gorm.DB) *usage.Exporter {
	return usage.NewExporter(managementUsageRepository{db: db}, nil, nil, nil)
}

func (s *Service) ProjectUsage(ctx context.Context, actor Actor, projectID string) (c.ProjectUsage, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return c.ProjectUsage{}, err
	}
	db := s.DB.WithContext(ctx)
	if _, err := manageProject(db, actor, projectID); err != nil {
		return c.ProjectUsage{}, err
	}
	var rows []struct {
		Status string
		Count  int64
	}
	union := `
		SELECT status FROM canvas_generations WHERE tenant_id = ? AND workspace_id = ? AND canvas_id IN (SELECT id FROM canvases WHERE project_id = ?)
		UNION ALL SELECT status FROM resource_image_runs WHERE tenant_id = ? AND workspace_id = ? AND project_id = ?
		UNION ALL SELECT status FROM canvas_storyboard_sessions WHERE tenant_id = ? AND workspace_id = ? AND canvas_id IN (SELECT id FROM canvases WHERE project_id = ?)`
	args := []any{actor.TenantID, actor.WorkspaceID, projectID, actor.TenantID, actor.WorkspaceID, projectID, actor.TenantID, actor.WorkspaceID, projectID}
	if err := db.Table("(?) AS generation_usage", gorm.Expr(union, args...)).Select("status, COUNT(*) AS count").Group("status").Scan(&rows).Error; err != nil {
		return c.ProjectUsage{}, err
	}
	result := c.ProjectUsage{BillingStatus: "estimated"}
	for _, row := range rows {
		result.Total += row.Count
		switch row.Status {
		case "completed", "confirmed":
			result.Completed += row.Count
		case "failed":
			result.Failed += row.Count
		case "cancelled", "discarded":
			result.Cancelled += row.Count
		default:
			result.Active += row.Count
		}
	}
	return result, nil
}

type temporaryWorkbook struct{ *os.File }

func (f temporaryWorkbook) Close() error {
	closeErr := f.File.Close()
	removeErr := os.Remove(f.Name())
	if closeErr != nil {
		return closeErr
	}
	return removeErr
}
func (s *Service) ProjectUsageWorkbook(ctx context.Context, actor Actor, projectID string) (MediaContent, error) {
	if err := requireProjectAdmin(actor); err != nil {
		return MediaContent{}, err
	}
	if _, err := manageProject(s.DB.WithContext(ctx), actor, projectID); err != nil {
		return MediaContent{}, err
	}
	file, err := os.CreateTemp("", "canvas-usage-*.xlsx")
	if err != nil {
		return MediaContent{}, err
	}
	workbook := temporaryWorkbook{file}
	exporter := s.UsageExporter
	if exporter == nil {
		workbook.Close()
		return MediaContent{}, &Error{Status: 503, Code: "export_unavailable", Message: "用量导出不可用"}
	}
	_, err = exporter.WriteWorkbook(ctx, file, usage.DownloadXLSXInput{Scope: usage.ExportScope{TenantID: actor.TenantID, WorkspaceID: &actor.WorkspaceID, CallerID: actor.UserID}, ProjectID: projectID})
	if err != nil {
		workbook.Close()
		return MediaContent{}, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		workbook.Close()
		return MediaContent{}, err
	}
	return MediaContent{Body: workbook, MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, nil
}
