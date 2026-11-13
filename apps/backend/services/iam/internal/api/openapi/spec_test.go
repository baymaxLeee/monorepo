package openapi

import "testing"

func TestDocumentHasStableOperations(t *testing.T) {
	doc := document()
	paths := doc["paths"].(map[string]any)
	seen := map[string]bool{}
	for route, methods := range paths {
		for method, raw := range methods.(map[string]any) {
			operation := raw.(map[string]any)
			id, ok := operation["operationId"].(string)
			if !ok || id == "" {
				t.Fatalf("%s %s has no operationId", method, route)
			}
			if seen[id] {
				t.Fatalf("duplicate operationId %q", id)
			}
			seen[id] = true
		}
	}
	if len(seen) != 27 {
		t.Fatalf("got %d operations, want 27", len(seen))
	}
}
