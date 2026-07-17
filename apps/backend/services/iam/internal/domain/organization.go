package domain

import "strings"

func NormalizeSlug(slug string) string {
	return strings.ToLower(strings.TrimSpace(slug))
}

func ValidSlug(slug string) bool {
	if slug == "" || len(slug) > 64 {
		return false
	}
	return !strings.ContainsAny(slug, " \t\r\n@")
}

func ValidMemberRole(role string) bool {
	return role == "org_admin" || role == "member"
}
