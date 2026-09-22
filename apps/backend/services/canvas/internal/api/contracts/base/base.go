package base

import (
	"fmt"
)

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

// Canvas 统一错误结构。
type Error struct {
	// HTTPCode 是对应的 HTTP status code。
	HTTPCode int32 `json:"HTTPCode"`
	// Code 是稳定的公共错误码。
	Code string `json:"Code"`
	// Message 是安全的公共错误信息。
	Message string `json:"Message"`
	// BizCode 是全局唯一的数字业务错误码。
	BizCode int32 `json:"BizCode"`
	// RequestID 是 Canvas 错误的链路追踪 ID。
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
