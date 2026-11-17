package main

import (
	"bytes"
	"testing"

	adminapi "github.com/example/monorepo/admin/internal/api/generated/adminapi"
)

func TestRestoreOperationIDs(t *testing.T) {
	spec, err := adminapi.GetSwagger()
	if err != nil {
		t.Fatalf("load generated Admin spec: %v", err)
	}
	operation := spec.Paths.Find("/bot").Get
	if operation.OperationID != "ListBots" {
		t.Fatalf("expected oapi-codegen operation name before restore, got %q", operation.OperationID)
	}

	restoreOperationIDs(spec)

	if operation.OperationID != "list_bots" {
		t.Fatalf("restored operationId = %q", operation.OperationID)
	}
	if _, exists := operation.Extensions["x-original-operation-id"]; exists {
		t.Fatal("temporary operationId extension leaked into exported contract")
	}
	for path := range spec.Paths.Map() {
		if len(path) >= len("/internal") && path[:len("/internal")] == "/internal" {
			t.Fatalf("legacy internal HTTP route remains in Admin OpenAPI: %s", path)
		}
	}
}

func TestReadCanonicalDocumentRejectsStaleBinding(t *testing.T) {
	spec, err := adminapi.GetSwagger()
	if err != nil {
		t.Fatalf("load generated Admin spec: %v", err)
	}
	path := "../../../../../../schemas/openapi/admin-server.json"
	want, err := readCanonicalDocument(path, spec)
	if err != nil {
		t.Fatalf("validate current generated binding: %v", err)
	}
	if !bytes.Contains(want, []byte(`"openapi": "3.1.0"`)) {
		t.Fatal("canonical Admin document is not OpenAPI 3.1.0")
	}

	spec.Extensions["x-canonical-sha256"] = "stale"
	if _, err := readCanonicalDocument(path, spec); err == nil {
		t.Fatal("stale generated binding was accepted")
	}
}
