package common

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
)

// SortDirection 定义列表排序方向。
type SortDirection int64

const (
	// ASC 表示升序。
	SortDirection_ASC SortDirection = 1
	// DESC 表示降序。
	SortDirection_DESC SortDirection = 2
)

func (p SortDirection) String() string {
	switch p {
	case SortDirection_ASC:
		return "ASC"
	case SortDirection_DESC:
		return "DESC"
	}
	return "<UNSET>"
}

func SortDirectionFromString(s string) (SortDirection, error) {
	switch s {
	case "ASC":
		return SortDirection_ASC, nil
	case "DESC":
		return SortDirection_DESC, nil
	}
	return SortDirection(0), fmt.Errorf("not a valid SortDirection string")
}

func SortDirectionPtr(v SortDirection) *SortDirection { return &v }
func (p *SortDirection) Scan(value interface{}) (err error) {
	var result sql.NullInt64
	err = result.Scan(value)
	*p = SortDirection(result.Int64)
	return
}

func (p *SortDirection) Value() (driver.Value, error) {
	if p == nil {
		return nil, nil
	}
	return int64(*p), nil
}

// Timestamp 是 UTC RFC3339Nano 格式的时间字符串。
type Timestamp = string

// Page 是列表请求的标准分页参数。
type Page struct {
	// PageSize 是每页返回数量。
	PageSize int32 `json:"PageSize"`
	// PageNum 是从 1 开始的页码。
	PageNum int32 `json:"PageNum"`
}

func NewPage() *Page {
	return &Page{}
}

func (p *Page) InitDefault() {
}

func (p *Page) GetPageSize() (v int32) {
	return p.PageSize
}

func (p *Page) GetPageNum() (v int32) {
	return p.PageNum
}

func (p *Page) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Page(%+v)", *p)
}

// PageOutput 是列表响应的标准分页信息。
type PageOutput struct {
	// PageSize 是请求的每页数量。
	PageSize int32 `json:"PageSize"`
	// PageNum 是请求的当前页码。
	PageNum int32 `json:"PageNum"`
	// Total 是符合条件的记录总数。
	Total int64 `json:"Total"`
	// TotalPage 是按 PageSize 计算的总页数。
	TotalPage int64 `json:"TotalPage"`
}

func NewPageOutput() *PageOutput {
	return &PageOutput{}
}

func (p *PageOutput) InitDefault() {
}

func (p *PageOutput) GetPageSize() (v int32) {
	return p.PageSize
}

func (p *PageOutput) GetPageNum() (v int32) {
	return p.PageNum
}

func (p *PageOutput) GetTotal() (v int64) {
	return p.Total
}

func (p *PageOutput) GetTotalPage() (v int64) {
	return p.TotalPage
}

func (p *PageOutput) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("PageOutput(%+v)", *p)
}
