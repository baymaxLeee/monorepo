package securityadapter

import (
	"github.com/example/monorepo/iam/internal/application"
	"github.com/example/monorepo/iam/internal/infrastructure/security"
)

type Service struct{}

func (Service) HashPassword(password string) (string, error) { return security.HashPassword(password) }
func (Service) VerifyPassword(hash, password string) bool {
	return security.VerifyPassword(hash, password)
}
func (Service) NewOpaqueToken() (string, string, error) { return security.NewOpaqueToken() }
func (Service) DigestToken(token string) string         { return security.DigestToken(token) }
func (Service) SignAccessToken(secret string, value application.TokenClaims) (string, error) {
	return security.SignAccessToken(secret, security.Claims{
		TenantID: value.TenantID, Subject: value.Subject, Email: value.Email, Name: value.Name,
		WorkspaceID: value.WorkspaceID, WorkspaceRole: value.WorkspaceRole, Roles: value.Roles,
		Issued: value.Issued, Expiry: value.Expiry,
	})
}
