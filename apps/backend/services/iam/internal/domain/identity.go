package domain

import "strings"

const RoleSuperAdmin = "super_admin"

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func NormalizeAccount(account string) string {
	return strings.ToLower(strings.TrimSpace(account))
}

func ValidEmail(email string) bool {
	local, host, ok := strings.Cut(email, "@")
	return ok && local != "" && host != "" && !strings.ContainsAny(email, " \t\r\n") && !strings.Contains(host, "@")
}

func ValidAccount(account string) bool {
	if account == "" || len(account) > 64 {
		return false
	}
	return !strings.ContainsAny(account, " \t\r\n@")
}

func Fallback(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
