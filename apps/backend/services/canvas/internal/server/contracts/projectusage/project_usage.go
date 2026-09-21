package projectusage

import (
	"fmt"
	"github.com/example/monorepo/canvas/internal/server/contracts/base"
	"github.com/example/monorepo/canvas/internal/server/contracts/common"
)

// DownloadProjectUsageXLSXRequest 是同步导出项目全部用量明细的请求。
type DownloadProjectUsageXLSXRequest struct {
	// WorkspaceID 限定工作空间；未传或空字符串表示无工作空间。
	WorkspaceID *string `json:"WorkspaceID,omitempty"`
	// ProjectID 是待导出用量的项目唯一标识。
	ProjectID string `json:"ProjectID"`
	// Top 由服务端使用可信 TOP 上下文覆盖，调用方无需填写。
	Top *base.TopParam `json:"Top,omitempty"`
}

func NewDownloadProjectUsageXLSXRequest() *DownloadProjectUsageXLSXRequest {
	return &DownloadProjectUsageXLSXRequest{}
}

func (p *DownloadProjectUsageXLSXRequest) InitDefault() {
}

var DownloadProjectUsageXLSXRequest_WorkspaceID_DEFAULT string

func (p *DownloadProjectUsageXLSXRequest) GetWorkspaceID() (v string) {
	if !p.IsSetWorkspaceID() {
		return DownloadProjectUsageXLSXRequest_WorkspaceID_DEFAULT
	}
	return *p.WorkspaceID
}

func (p *DownloadProjectUsageXLSXRequest) GetProjectID() (v string) {
	return p.ProjectID
}

var DownloadProjectUsageXLSXRequest_Top_DEFAULT *base.TopParam

func (p *DownloadProjectUsageXLSXRequest) GetTop() (v *base.TopParam) {
	if !p.IsSetTop() {
		return DownloadProjectUsageXLSXRequest_Top_DEFAULT
	}
	return p.Top
}

func (p *DownloadProjectUsageXLSXRequest) IsSetWorkspaceID() bool {
	return p.WorkspaceID != nil
}

func (p *DownloadProjectUsageXLSXRequest) IsSetTop() bool {
	return p.Top != nil
}

func (p *DownloadProjectUsageXLSXRequest) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DownloadProjectUsageXLSXRequest(%+v)", *p)
}

// DownloadProjectUsageXLSXResponse 返回临时 XLSX 的限时下载信息。
type DownloadProjectUsageXLSXResponse struct {
	// FileName 是浏览器下载时使用的展示文件名。
	FileName string `json:"FileName"`
	// DownloadURL 是带鉴权能力的临时下载链接，禁止记录到日志。
	DownloadURL string `json:"DownloadURL"`
	// ExpiresAt 是下载链接的 UTC RFC3339Nano 过期时间。
	ExpiresAt common.Timestamp `json:"ExpiresAt"`
	// RowCount 是 XLSX 中的项目用量明细行数，不包含表头和汇总行。
	RowCount int64 `json:"RowCount"`
	// FileSize 是 XLSX 文件的字节数。
	FileSize int64 `json:"FileSize"`
	// PendingBillingCount 是费用尚未最终确定的任务数量。
	PendingBillingCount int64 `json:"PendingBillingCount"`
}

func NewDownloadProjectUsageXLSXResponse() *DownloadProjectUsageXLSXResponse {
	return &DownloadProjectUsageXLSXResponse{}
}

func (p *DownloadProjectUsageXLSXResponse) InitDefault() {
}

func (p *DownloadProjectUsageXLSXResponse) GetFileName() (v string) {
	return p.FileName
}

func (p *DownloadProjectUsageXLSXResponse) GetDownloadURL() (v string) {
	return p.DownloadURL
}

func (p *DownloadProjectUsageXLSXResponse) GetExpiresAt() (v common.Timestamp) {
	return p.ExpiresAt
}

func (p *DownloadProjectUsageXLSXResponse) GetRowCount() (v int64) {
	return p.RowCount
}

func (p *DownloadProjectUsageXLSXResponse) GetFileSize() (v int64) {
	return p.FileSize
}

func (p *DownloadProjectUsageXLSXResponse) GetPendingBillingCount() (v int64) {
	return p.PendingBillingCount
}

func (p *DownloadProjectUsageXLSXResponse) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("DownloadProjectUsageXLSXResponse(%+v)", *p)
}
