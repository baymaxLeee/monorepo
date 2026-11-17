package application

type TokenClaims struct {
	TenantID      string
	Subject       string
	Email         string
	Name          string
	WorkspaceID   string
	WorkspaceRole string
	Roles         []string
	Issued        int64
	Expiry        int64
}

type Security interface {
	HashPassword(string) (string, error)
	VerifyPassword(string, string) bool
	NewOpaqueToken() (string, string, error)
	DigestToken(string) string
	SignAccessToken(string, TokenClaims) (string, error)
}
