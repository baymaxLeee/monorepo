package artifactnamespace

import (
	"errors"
	"strings"
	"testing"
)

func TestNamespaceUsesCanvasPrefixAndCompleteScope(t *testing.T) {
	workspaceID := "workspace-1"
	projectID := "project-1"
	scope := Scope{TenantID: "tenant-1", WorkspaceID: &workspaceID, ProjectID: &projectID}

	got, err := scope.Namespace()
	if err != nil {
		t.Fatalf("Namespace() returned error: %v", err)
	}
	if !strings.HasPrefix(got, "canvas:") || len(got) != len("canvas:")+32 {
		t.Fatalf("Namespace() = %q, want fixed-width canvas namespace", got)
	}

	otherProjectID := "project-2"
	other, err := (Scope{TenantID: "tenant-1", WorkspaceID: &workspaceID, ProjectID: &otherProjectID}).Namespace()
	if err != nil {
		t.Fatalf("Namespace() for other project returned error: %v", err)
	}
	if other == got {
		t.Fatal("different project scopes must not share a namespace")
	}
}

func TestNamespaceNormalizesOptionalScopeAndRejectsEmptyTenant(t *testing.T) {
	blank := "  "
	withoutOptional, err := (Scope{TenantID: " tenant-1 "}).Namespace()
	if err != nil {
		t.Fatalf("Namespace() returned error: %v", err)
	}
	withBlankOptional, err := (Scope{TenantID: "tenant-1", WorkspaceID: &blank, ProjectID: &blank}).Namespace()
	if err != nil {
		t.Fatalf("Namespace() with blank optional scope returned error: %v", err)
	}
	if withBlankOptional != withoutOptional {
		t.Fatalf("blank optional scope changed namespace: %q != %q", withBlankOptional, withoutOptional)
	}
	if _, err := (Scope{TenantID: blank}).Namespace(); !errors.Is(err, ErrEmptyTenantID) {
		t.Fatalf("Namespace() error = %v, want %v", err, ErrEmptyTenantID)
	}
}
