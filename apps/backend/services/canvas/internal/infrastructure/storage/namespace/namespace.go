package artifactnamespace

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

const prefix = "canvas:"

var ErrEmptyTenantID = errors.New("artifact namespace requires a tenant ID")

// Scope identifies every stable business boundary that owns an Artifact.
// Optional empty values are omitted so nil and blank nullable scopes remain equivalent.
type Scope struct {
	TenantID    string
	WorkspaceID *string
	ProjectID   *string
}

// Namespace returns a fixed-width Artifact namespace derived from the complete
// scope. The first 128 bits of SHA-256 keep the value below artifact storage's
// 64-character limit while retaining ample collision resistance for scope IDs.
func (scope Scope) Namespace() (string, error) {
	tenantID := strings.TrimSpace(scope.TenantID)
	if tenantID == "" {
		return "", ErrEmptyTenantID
	}
	payload := make([]byte, 0, len(tenantID)+64)
	payload = appendComponent(payload, "tenant", tenantID)
	if workspaceID := optionalValue(scope.WorkspaceID); workspaceID != "" {
		payload = appendComponent(payload, "workspace", workspaceID)
	}
	if projectID := optionalValue(scope.ProjectID); projectID != "" {
		payload = appendComponent(payload, "project", projectID)
	}
	digest := sha256.Sum256(payload)
	return prefix + hex.EncodeToString(digest[:16]), nil
}

func appendComponent(payload []byte, label, value string) []byte {
	payload = append(payload, label...)
	payload = append(payload, 0)
	payload = append(payload, value...)
	return append(payload, 0)
}

func optionalValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
