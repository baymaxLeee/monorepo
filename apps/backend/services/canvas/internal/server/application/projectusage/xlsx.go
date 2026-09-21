package projectusage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

const usageSheetName = "项目用量明细"

// XLSX cells have no timezone metadata, so convert UTC facts to the product-facing Beijing wall clock before writing.
var beijingTime = time.FixedZone("CST", 8*60*60)

type generatedWorkbook struct {
	sha256  string
	size    int64
	rows    int64
	pending int64
}

type usageWorkbookStyles struct {
	header      int
	date        int
	text        int
	amount      int
	totalLabel  int
	totalAmount int
	totalText   int
}

func (exporter *Exporter) generateXLSX(
	ctx context.Context,
	file *os.File,
	input DownloadXLSXInput,
) (generated generatedWorkbook, resultErr error) {
	workbook := excelize.NewFile()
	defer func() {
		if err := workbook.Close(); resultErr == nil && err != nil {
			resultErr = err
		}
	}()
	if err := workbook.SetSheetName("Sheet1", usageSheetName); err != nil {
		return generatedWorkbook{}, err
	}
	styles, err := newUsageWorkbookStyles(workbook)
	if err != nil {
		return generatedWorkbook{}, err
	}
	writer, err := workbook.NewStreamWriter(usageSheetName)
	if err != nil {
		return generatedWorkbook{}, err
	}
	if err = configureUsageSheet(writer); err != nil {
		return generatedWorkbook{}, err
	}
	if err = writer.SetRow("A1", styledRow(styles.header,
		"消耗时间", "任务类型", "资源类型", "模型来源", "模型名称", "发起者", "消耗费用",
	), excelize.RowOpts{Height: 24}); err != nil {
		return generatedWorkbook{}, err
	}

	totals := make(map[string]*decimalTotal)
	nextRow := 2
	err = exporter.repository.WithReadOnlySnapshot(ctx, func(snapshotCtx context.Context) error {
		var afterTime *time.Time
		var afterID string
		for {
			if err := snapshotCtx.Err(); err != nil {
				return err
			}
			page, pageErr := exporter.repository.ListExportPage(snapshotCtx, ExportPageQuery{
				ExportScope: input.Scope, ProjectID: input.ProjectID,
				AfterConsumedAt: afterTime, AfterTaskRunID: afterID, Limit: exporter.limits.PageSize,
			})
			if pageErr != nil {
				return pageErr
			}
			if len(page) > exporter.limits.PageSize {
				return errors.New("project usage repository returned more rows than requested")
			}
			for index := range page {
				row := page[index]
				if err := validateCursorProgress(afterTime, afterID, row); err != nil {
					return err
				}
				amount, pending, amountErr := exportAmount(row, totals)
				if amountErr != nil {
					return amountErr
				}
				after := row.ConsumedAt.UTC()
				afterTime, afterID = &after, row.TaskRunID
				if pending {
					generated.pending++
					continue
				}
				if nextRow >= excelize.TotalRows {
					return errors.New("project usage XLSX exceeds the worksheet row limit")
				}
				initiator := row.CreatedBy
				if row.CreatedByName != nil && strings.TrimSpace(*row.CreatedByName) != "" {
					initiator = *row.CreatedByName
				}
				axis, axisErr := excelize.CoordinatesToCellName(1, nextRow)
				if axisErr != nil {
					return axisErr
				}
				if err := writer.SetRow(axis, []interface{}{
					excelize.Cell{StyleID: styles.date, Value: row.ConsumedAt.In(beijingTime)},
					excelize.Cell{StyleID: styles.text, Value: taskTypeLabel(row.TaskType)},
					excelize.Cell{StyleID: styles.text, Value: resourceTypeLabel(row.ResourceType)},
					excelize.Cell{StyleID: styles.text, Value: modelSourceLabel(row.ModelSource)},
					excelize.Cell{StyleID: styles.text, Value: row.ModelName},
					excelize.Cell{StyleID: styles.text, Value: initiator},
					excelize.Cell{StyleID: styles.amount, Value: workbookAmountValue(amount, row.Currency)},
				}, excelize.RowOpts{Height: 22}); err != nil {
					return err
				}
				generated.rows++
				nextRow++
			}
			if len(page) < exporter.limits.PageSize {
				return nil
			}
		}
	})
	if err != nil {
		return generatedWorkbook{}, err
	}
	if err = writeWorkbookTotal(writer, nextRow, generated.rows, totals, styles); err != nil {
		return generatedWorkbook{}, err
	}
	if err = writer.Flush(); err != nil {
		return generatedWorkbook{}, err
	}
	if err = workbook.Write(file); err != nil {
		return generatedWorkbook{}, err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return generatedWorkbook{}, err
	}
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return generatedWorkbook{}, err
	}
	generated.size = size
	generated.sha256 = hex.EncodeToString(hash.Sum(nil))
	return generated, nil
}

func configureUsageSheet(writer *excelize.StreamWriter) error {
	for _, width := range []struct {
		column int
		width  float64
	}{
		{column: 1, width: 21},
		{column: 2, width: 14},
		{column: 3, width: 14},
		{column: 4, width: 16},
		{column: 5, width: 30},
		{column: 6, width: 20},
		{column: 7, width: 16},
	} {
		if err := writer.SetColWidth(width.column, width.column, width.width); err != nil {
			return err
		}
	}
	return writer.SetPanes(&excelize.Panes{
		Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft",
		Selection: []excelize.Selection{{SQRef: "A2", ActiveCell: "A2", Pane: "bottomLeft"}},
	})
}

func newUsageWorkbookStyles(workbook *excelize.File) (usageWorkbookStyles, error) {
	border := []excelize.Border{
		{Type: "left", Color: "000000", Style: 1},
		{Type: "top", Color: "000000", Style: 1},
		{Type: "bottom", Color: "000000", Style: 1},
		{Type: "right", Color: "000000", Style: 1},
	}
	base := func() *excelize.Style {
		return &excelize.Style{
			Border:    border,
			Font:      &excelize.Font{Size: 11, Color: "000000"},
			Alignment: &excelize.Alignment{Horizontal: "left", Vertical: "center", ShrinkToFit: true},
		}
	}
	styles := usageWorkbookStyles{}
	var err error
	header := base()
	header.Font.Bold = true
	if styles.header, err = workbook.NewStyle(header); err != nil {
		return usageWorkbookStyles{}, err
	}
	date := base()
	date.CustomNumFmt = stringPointer("yyyy-mm-dd hh:mm:ss")
	if styles.date, err = workbook.NewStyle(date); err != nil {
		return usageWorkbookStyles{}, err
	}
	if styles.text, err = workbook.NewStyle(base()); err != nil {
		return usageWorkbookStyles{}, err
	}
	amount := base()
	amount.Alignment.Horizontal = "right"
	amount.CustomNumFmt = stringPointer("0.##################")
	if styles.amount, err = workbook.NewStyle(amount); err != nil {
		return usageWorkbookStyles{}, err
	}
	totalLabel := base()
	totalLabel.Font.Bold = true
	if styles.totalLabel, err = workbook.NewStyle(totalLabel); err != nil {
		return usageWorkbookStyles{}, err
	}
	totalAmount := base()
	totalAmount.Font.Bold = true
	totalAmount.Alignment.Horizontal = "right"
	totalAmount.CustomNumFmt = stringPointer("0.##################")
	if styles.totalAmount, err = workbook.NewStyle(totalAmount); err != nil {
		return usageWorkbookStyles{}, err
	}
	totalText := base()
	totalText.Font.Bold = true
	totalText.Alignment.Horizontal = "right"
	if styles.totalText, err = workbook.NewStyle(totalText); err != nil {
		return usageWorkbookStyles{}, err
	}
	return styles, nil
}

func styledRow(styleID int, values ...string) []interface{} {
	result := make([]interface{}, len(values))
	for index := range values {
		result[index] = excelize.Cell{StyleID: styleID, Value: values[index]}
	}
	return result
}

func workbookAmountValue(amount string, currency *string) interface{} {
	if strings.TrimSpace(amount) == "" {
		return ""
	}
	unit := ""
	if currency != nil {
		unit = strings.TrimSpace(*currency)
	}
	if unit != "" {
		// exportAmount already appends the explicit currency. Keep it as text so
		// Excel does not silently discard or reinterpret the billing unit.
		return amount
	}
	value, err := strconv.ParseFloat(amount, 64)
	if err != nil {
		return amount
	}
	return value
}

func writeWorkbookTotal(
	writer *excelize.StreamWriter,
	row int,
	detailRows int64,
	totals map[string]*decimalTotal,
	styles usageWorkbookStyles,
) error {
	value, numeric := workbookTotalValue(totals)
	amountStyle := styles.totalText
	if numeric {
		amountStyle = styles.totalAmount
	}
	values := []interface{}{excelize.Cell{StyleID: styles.totalLabel, Value: "总消耗（账单可能有1-2小时的延迟）"}}
	for index := 0; index < 5; index++ {
		values = append(values, excelize.Cell{StyleID: styles.totalLabel, Value: ""})
	}
	amountCell := excelize.Cell{StyleID: amountStyle, Value: value}
	if numeric && detailRows > 0 {
		amountCell.Formula = fmt.Sprintf("SUM(G2:G%d)", detailRows+1)
	}
	values = append(values, amountCell)
	axis, err := excelize.CoordinatesToCellName(1, row)
	if err != nil {
		return err
	}
	if err = writer.SetRow(axis, values, excelize.RowOpts{Height: 24}); err != nil {
		return err
	}
	return writer.MergeCell(axis, fmt.Sprintf("F%d", row))
}

func workbookTotalValue(totals map[string]*decimalTotal) (interface{}, bool) {
	if len(totals) == 0 {
		return float64(0), true
	}
	if total, exists := totals[""]; exists && len(totals) == 1 {
		value, err := strconv.ParseFloat(total.String(), 64)
		if err == nil {
			return value, true
		}
	}
	currencies := make([]string, 0, len(totals))
	for currency := range totals {
		currencies = append(currencies, currency)
	}
	sort.Strings(currencies)
	parts := make([]string, 0, len(currencies))
	for _, currency := range currencies {
		parts = append(parts, formatAmount(totals[currency].String(), currency))
	}
	return strings.Join(parts, " / "), false
}

func stringPointer(value string) *string { return &value }
