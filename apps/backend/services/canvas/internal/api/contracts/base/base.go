package base

import (
	"fmt"
)

// TopParam 是 TOP 从可信 X-Top-* header 注入的请求上下文。
type TopParam struct {
	// RequestID 是链路请求 ID。
	RequestID string `header:"X-Top-Request-Id" json:"RequestID,required" `
	// TenantID 是当前租户 ID。
	TenantID string `header:"X-Top-Tenant-Id" json:"TenantID,required" `
	// UserID 是当前用户 ID。
	UserID *string `header:"X-Top-User-Id" json:"UserID,omitempty" `
	// DestService 是请求到达的目标服务名。
	DestService string `header:"X-Top-Service" json:"DestService,required" `
	// Region 是请求所属区域。
	Region *string `header:"X-Top-Region" json:"Region,omitempty" `
	// RealIp 是调用方真实 IP。
	RealIp *string `header:"X-Top-Real-Ip" json:"RealIp,omitempty" `
}

func NewTopParam() *TopParam {
	return &TopParam{}
}

func (p *TopParam) InitDefault() {
}

func (p *TopParam) GetRequestID() (v string) {
	return p.RequestID
}

func (p *TopParam) GetTenantID() (v string) {
	return p.TenantID
}

var TopParam_UserID_DEFAULT string

func (p *TopParam) GetUserID() (v string) {
	if !p.IsSetUserID() {
		return TopParam_UserID_DEFAULT
	}
	return *p.UserID
}

func (p *TopParam) GetDestService() (v string) {
	return p.DestService
}

var TopParam_Region_DEFAULT string

func (p *TopParam) GetRegion() (v string) {
	if !p.IsSetRegion() {
		return TopParam_Region_DEFAULT
	}
	return *p.Region
}

var TopParam_RealIp_DEFAULT string

func (p *TopParam) GetRealIp() (v string) {
	if !p.IsSetRealIp() {
		return TopParam_RealIp_DEFAULT
	}
	return *p.RealIp
}

func (p *TopParam) IsSetUserID() bool {
	return p.UserID != nil
}

func (p *TopParam) IsSetRegion() bool {
	return p.Region != nil
}

func (p *TopParam) IsSetRealIp() bool {
	return p.RealIp != nil
}

func (p *TopParam) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("TopParam(%+v)", *p)
}

// 无响应字段的方法使用该结构。
type Empty struct {
}

func NewEmpty() *Empty {
	return &Empty{}
}

func (p *Empty) InitDefault() {
}

func (p *Empty) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Empty(%+v)", *p)
}

// AgentFrame 统一错误结构。
type Error struct {
	// HTTPCode 是对应的 HTTP status code。
	HTTPCode int32 `json:"HTTPCode"`
	// Code 是稳定的公共错误码。
	Code string `json:"Code"`
	// Message 是安全的公共错误信息。
	Message string `json:"Message"`
	// BizCode 是全局唯一的数字业务错误码。
	BizCode int32 `json:"BizCode"`
	// RequestID 是 AgentFrame 错误的链路追踪 ID。
	RequestID *string `json:"RequestID,omitempty"`
}

func NewError() *Error {
	return &Error{}
}

func (p *Error) InitDefault() {
}

func (p *Error) GetHTTPCode() (v int32) {
	return p.HTTPCode
}

func (p *Error) GetCode() (v string) {
	return p.Code
}

func (p *Error) GetMessage() (v string) {
	return p.Message
}

func (p *Error) GetBizCode() (v int32) {
	return p.BizCode
}

var Error_RequestID_DEFAULT string

func (p *Error) GetRequestID() (v string) {
	if !p.IsSetRequestID() {
		return Error_RequestID_DEFAULT
	}
	return *p.RequestID
}

func (p *Error) IsSetRequestID() bool {
	return p.RequestID != nil
}

func (p *Error) String() string {
	if p == nil {
		return "<nil>"
	}
	return fmt.Sprintf("Error(%+v)", *p)
}
func (p *Error) Error() string {
	return p.String()
}
