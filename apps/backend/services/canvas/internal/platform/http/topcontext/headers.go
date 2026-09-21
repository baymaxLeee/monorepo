// Package topcontext defines trusted request metadata injected by IAM/TOP.
package topcontext

const (
	HeaderRequestID      = "X-Top-Request-Id"
	HeaderTenantID       = "X-Top-Tenant-Id"
	HeaderUserID         = "X-Top-User-Id"
	HeaderRegion         = "X-Top-Region"
	HeaderService        = "X-Top-Service"
	HeaderAction         = "X-Top-Action"
	HeaderVersion        = "X-Top-Version"
	HeaderRealIP         = "X-Top-Real-Ip"
	HeaderIdentityType   = "X-Top-Identity-Type"
	HeaderAcceptLanguage = "X-Top-Accept-Language"
	HeaderFilter         = "X-Top-Filter"
)
