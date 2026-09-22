package projectusage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	applicationproject "github.com/example/monorepo/canvas/internal/application/project"
	"github.com/example/monorepo/canvas/pkg/platform/errno"
)

const (
	defaultPageSize            = 1_000
	defaultGenerationTimeout   = 30 * time.Second
	defaultInstanceConcurrency = 2
	defaultFileTTL             = 24 * time.Hour
	defaultLinkTTL             = 6 * time.Hour
)

var errInvalidAmount = errors.New("project usage amount is invalid")

type BillingStatus string

const (
	BillingStatusPending     BillingStatus = "PENDING"
	BillingStatusReady       BillingStatus = "READY"
	BillingStatusNeedsReview BillingStatus = "NEEDS_REVIEW"
)

type ExportScope struct {
	TenantID    string
	WorkspaceID *string
	CallerID    string
}

type DownloadXLSXInput struct {
	Scope     ExportScope
	ProjectID string
}

type DownloadXLSXResult struct {
	FileName            string
	DownloadURL         string
	ExpiresAt           time.Time
	RowCount            int64
	FileSize            int64
	PendingBillingCount int64
}

type GetProjectNameInput struct {
	ExportScope
	ProjectID string
}

type ExportPageQuery struct {
	ExportScope
	ProjectID       string
	AfterConsumedAt *time.Time
	AfterTaskRunID  string
	Limit           int
}

type ExportRow struct {
	TaskRunID     string
	ConsumedAt    time.Time
	TaskType      string
	ResourceType  string
	ModelID       string
	ModelSource   string
	ModelName     string
	CreatedBy     string
	CreatedByName *string
	BillingStatus BillingStatus
	TotalAmount   *string
	Currency      *string
}

type ExportRepository interface {
	GetProjectName(context.Context, GetProjectNameInput) (string, error)
	WithReadOnlySnapshot(context.Context, func(context.Context) error) error
	ListExportPage(context.Context, ExportPageQuery) ([]ExportRow, error)
}

type TemporaryFileUpload struct {
	TenantID         string
	CallerID         string
	ExportID         string
	InternalFileName string
	DownloadFileName string
	SHA256           string
	Size             int64
	FileTTL          time.Duration
	LinkTTL          time.Duration
	Reader           io.Reader
}

type TemporaryFile struct {
	DownloadURL string
	ExpiresAt   time.Time
	Size        int64
}

type TemporaryFileStore interface {
	UploadTemporary(context.Context, TemporaryFileUpload) (TemporaryFile, error)
}

type IDGenerator interface{ NewID() (string, error) }
type Clock interface{ Now() time.Time }

type ExportLimits struct {
	PageSize            int
	GenerationTimeout   time.Duration
	InstanceConcurrency int
}

func defaultExportLimits() ExportLimits {
	return ExportLimits{
		PageSize: defaultPageSize, GenerationTimeout: defaultGenerationTimeout,
		InstanceConcurrency: defaultInstanceConcurrency,
	}
}

type Exporter struct {
	repository ExportRepository
	files      TemporaryFileStore
	ids        IDGenerator
	clock      Clock
	tempRoot   string
	limits     ExportLimits
	gate       *exportGate
}

func NewExporter(repository ExportRepository, files TemporaryFileStore, ids IDGenerator, clock Clock) *Exporter {
	return newExporter(repository, files, ids, clock, os.TempDir(), defaultExportLimits())
}

func newExporter(repository ExportRepository, files TemporaryFileStore, ids IDGenerator, clock Clock, tempRoot string, limits ExportLimits) *Exporter {
	return &Exporter{
		repository: repository, files: files, ids: ids, clock: clock, tempRoot: tempRoot, limits: limits,
		gate: newExportGate(limits.InstanceConcurrency),
	}
}

func (exporter *Exporter) DownloadXLSX(ctx context.Context, input DownloadXLSXInput) (DownloadXLSXResult, error) {
	if !validDownloadInput(input, exporter.limits) || exporter.repository == nil || exporter.files == nil || exporter.ids == nil || exporter.clock == nil {
		return DownloadXLSXResult{}, errno.New(errno.ErrInvalidArgument)
	}
	projectName, err := exporter.repository.GetProjectName(ctx, GetProjectNameInput{ExportScope: input.Scope, ProjectID: input.ProjectID})
	if err != nil {
		if errors.Is(err, applicationproject.ErrNotFound) {
			return DownloadXLSXResult{}, errno.Wrap(errno.ErrNotFound, err)
		}
		return DownloadXLSXResult{}, errno.Wrap(errno.ErrPersistenceError, err)
	}
	release, acquired := exporter.gate.acquire(input.Scope.CallerID)
	if !acquired {
		return DownloadXLSXResult{}, errno.New(errno.ErrTooManyRequests)
	}
	defer release()

	exportID, err := exporter.ids.NewID()
	if err != nil || strings.TrimSpace(exportID) == "" {
		return DownloadXLSXResult{}, errno.Wrap(errno.ErrInternalError, err)
	}
	tempDir, err := os.MkdirTemp(exporter.tempRoot, "canvas-project-usage-")
	if err != nil {
		return DownloadXLSXResult{}, errno.Wrap(errno.ErrInternalError, fmt.Errorf("create project usage temporary directory: %w", err))
	}
	defer os.RemoveAll(tempDir) //nolint:errcheck // Cleanup failure must not replace the export result.
	filePath := filepath.Join(tempDir, "usage.xlsx")
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return DownloadXLSXResult{}, errno.Wrap(errno.ErrInternalError, fmt.Errorf("create project usage XLSX: %w", err))
	}
	defer file.Close() //nolint:errcheck // Earlier file operations provide the actionable export error.

	generationCtx, cancel := context.WithTimeout(ctx, exporter.limits.GenerationTimeout)
	defer cancel()
	generated, err := exporter.generateXLSX(generationCtx, file, input)
	if err != nil {
		if generationCtx.Err() != nil {
			return DownloadXLSXResult{}, errno.Wrap(errno.ErrRequestTimeout, err)
		}
		return DownloadXLSXResult{}, errno.Ensure(errno.ErrInternalError, fmt.Errorf("generate project usage XLSX: %w", err))
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return DownloadXLSXResult{}, errno.Wrap(errno.ErrInternalError, fmt.Errorf("rewind project usage XLSX: %w", err))
	}
	now := exporter.clock.Now().UTC()
	downloadName := exportFileName(projectName, input.ProjectID, now)
	uploaded, err := exporter.files.UploadTemporary(ctx, TemporaryFileUpload{
		TenantID: input.Scope.TenantID, CallerID: input.Scope.CallerID, ExportID: exportID,
		InternalFileName: "project-usage-" + safeASCIIIdentifier(exportID) + ".xlsx",
		DownloadFileName: downloadName, SHA256: generated.sha256, Size: generated.size,
		FileTTL: defaultFileTTL, LinkTTL: defaultLinkTTL, Reader: file,
	})
	if err != nil {
		return DownloadXLSXResult{}, errno.Wrap(errno.ErrObjectStorageDependencyError, err)
	}
	if strings.TrimSpace(uploaded.DownloadURL) == "" || uploaded.ExpiresAt.IsZero() {
		return DownloadXLSXResult{}, errno.New(errno.ErrObjectStorageDependencyError)
	}
	return DownloadXLSXResult{
		FileName: downloadName, DownloadURL: uploaded.DownloadURL, ExpiresAt: uploaded.ExpiresAt,
		RowCount: generated.rows, FileSize: generated.size, PendingBillingCount: generated.pending,
	}, nil
}

func taskTypeLabel(value string) string {
	switch value {
	case "CANVAS_STORYBOARD_GENERATION":
		return "剧本拆分"
	case "CANVAS_NODE_VIDEO_GENERATION":
		return "视频生成"
	case "IMAGE_GENERATION":
		return "图片生成"
	case "CANVAS_NODE_TEXT_GENERATION":
		return "文本生成"
	default:
		return value
	}
}

func resourceTypeLabel(value string) string {
	switch value {
	case "TEXT":
		return "文本"
	case "IMAGE":
		return "图片"
	case "VIDEO":
		return "视频"
	default:
		return value
	}
}

func modelSourceLabel(value string) string {
	switch value {
	case "SYSTEM_PRESET":
		return "系统预置"
	case "SYSTEM_DISTRIBUTED":
		return "系统分发"
	default:
		return value
	}
}

func validDownloadInput(input DownloadXLSXInput, limits ExportLimits) bool {
	return strings.TrimSpace(input.Scope.TenantID) != "" && strings.TrimSpace(input.Scope.CallerID) != "" &&
		strings.TrimSpace(input.ProjectID) != "" && limits.PageSize > 0 &&
		limits.GenerationTimeout > 0 && limits.InstanceConcurrency > 0
}

func validateCursorProgress(after *time.Time, afterID string, row ExportRow) error {
	if strings.TrimSpace(row.TaskRunID) == "" || row.ConsumedAt.IsZero() {
		return errors.New("project usage export row has an incomplete cursor")
	}
	if after == nil {
		return nil
	}
	consumedAt := row.ConsumedAt.UTC()
	if consumedAt.Before(*after) || consumedAt.Equal(*after) && row.TaskRunID <= afterID {
		return errors.New("project usage export cursor did not advance")
	}
	return nil
}

func exportAmount(row ExportRow, totals map[string]*decimalTotal) (string, bool, error) {
	switch row.BillingStatus {
	case BillingStatusPending, BillingStatusNeedsReview:
		return "", true, nil
	case BillingStatusReady:
		if row.TotalAmount == nil || strings.TrimSpace(*row.TotalAmount) == "" {
			return "", false, errors.New("READY project usage row has no amount")
		}
		currency := ""
		if row.Currency != nil {
			currency = strings.TrimSpace(*row.Currency)
		}
		amount := strings.TrimSpace(*row.TotalAmount)
		if currency == "" {
			unitless := &decimalTotal{}
			if err := unitless.add(amount); err != nil {
				return "", false, err
			}
			if unitless.value.Sign() == 0 {
				// NOT_SENT, confirmed cancellation and explicit provider non-billing
				// facts contribute zero without creating a separate summary unit.
				return formatAmount(amount, currency), false, nil
			}
			total := totals[currency]
			if total == nil {
				total = &decimalTotal{}
				totals[currency] = total
			}
			if err := total.add(amount); err != nil {
				return "", false, err
			}
			return formatAmount(amount, currency), false, nil
		}
		total := totals[currency]
		if total == nil {
			total = &decimalTotal{}
			totals[currency] = total
		}
		if err := total.add(amount); err != nil {
			return "", false, err
		}
		return formatAmount(amount, currency), false, nil
	default:
		return "", false, fmt.Errorf("unknown project usage billing status %q", row.BillingStatus)
	}
}

func formatAmount(amount, currency string) string {
	if currency == "" {
		return amount
	}
	return amount + " " + currency
}

type decimalTotal struct {
	value    big.Rat
	maxScale int
	set      bool
}

func (total *decimalTotal) add(raw string) error {
	scale, valid := decimalScale(raw)
	if !valid {
		return fmt.Errorf("%w: %q", errInvalidAmount, raw)
	}
	value, ok := new(big.Rat).SetString(raw)
	if !ok {
		return fmt.Errorf("%w: %q", errInvalidAmount, raw)
	}
	total.value.Add(&total.value, value)
	total.maxScale = max(total.maxScale, scale)
	total.set = true
	return nil
}

func (total *decimalTotal) String() string {
	if !total.set {
		return "0"
	}
	return total.value.FloatString(total.maxScale)
}

func decimalScale(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	if value[0] == '+' || value[0] == '-' {
		value = value[1:]
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, false
	}
	for _, part := range parts {
		if part == "" {
			return 0, false
		}
		for _, digit := range part {
			if digit < '0' || digit > '9' {
				return 0, false
			}
		}
	}
	if len(parts) == 2 {
		return len(parts[1]), true
	}
	return 0, true
}

func exportFileName(projectName, projectID string, now time.Time) string {
	base := sanitizeFileName(projectName)
	if base == "" {
		base = sanitizeFileName(projectID)
	}
	if base == "" {
		base = "project"
	}
	return base + "-用量明细-" + now.UTC().Format("20060102150405") + ".xlsx"
}

func sanitizeFileName(value string) string {
	value = strings.TrimSpace(value)
	var result []rune
	for _, current := range value {
		if len(result) >= 80 {
			break
		}
		if unicode.IsControl(current) || strings.ContainsRune(`/\\:*?"<>|`, current) {
			current = '_'
		}
		result = append(result, current)
	}
	return strings.Trim(strings.TrimSpace(string(result)), ".")
}

func safeASCIIIdentifier(value string) string {
	var result strings.Builder
	for _, current := range value {
		if current >= 'a' && current <= 'z' || current >= 'A' && current <= 'Z' || current >= '0' && current <= '9' || current == '-' || current == '_' {
			result.WriteRune(current)
		} else {
			result.WriteByte('-')
		}
	}
	if result.Len() == 0 {
		return "export"
	}
	return result.String()
}

type exportGate struct {
	global chan struct{}
	mu     sync.Mutex
	users  map[string]struct{}
}

func newExportGate(limit int) *exportGate {
	if limit < 1 {
		limit = 1
	}
	return &exportGate{global: make(chan struct{}, limit), users: make(map[string]struct{})}
}

func (gate *exportGate) acquire(userID string) (func(), bool) {
	select {
	case gate.global <- struct{}{}:
	default:
		return nil, false
	}
	gate.mu.Lock()
	if _, exists := gate.users[userID]; exists {
		gate.mu.Unlock()
		<-gate.global
		return nil, false
	}
	gate.users[userID] = struct{}{}
	gate.mu.Unlock()
	return func() {
		gate.mu.Lock()
		delete(gate.users, userID)
		gate.mu.Unlock()
		<-gate.global
	}, true
}
