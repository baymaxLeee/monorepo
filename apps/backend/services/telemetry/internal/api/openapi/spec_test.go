package openapi

import "testing"

func TestSpecPreservesPublicOperationsAndModels(t *testing.T) {
	spec := Spec()
	paths := spec["paths"].(map[string]any)
	expected := map[string]string{
		"/livez": "livez", "/readyz": "readyz", "/healthz": "healthz", "/rum/batch": "ingest_rum_batch",
		"/errors": "list_error_events", "/performance": "list_performance_events", "/ops/observability": "observability_status",
		"/ops/traces": "recent_traces", "/ops/traces/{trace_id}": "trace_detail",
	}
	for path, operationID := range expected {
		pathItem, ok := paths[path].(map[string]any)
		if !ok {
			t.Fatalf("missing path %s", path)
		}
		var operation map[string]any
		for _, method := range []string{"get", "post"} {
			if value, exists := pathItem[method]; exists {
				operation = value.(map[string]any)
			}
		}
		if operation["operationId"] != operationID {
			t.Fatalf("%s operation id = %v", path, operation["operationId"])
		}
	}
	schemaSet := spec["components"].(map[string]any)["schemas"].(map[string]any)
	for _, name := range []string{"RumBatch", "ErrorEvent", "PerformanceEvent", "ObservabilityStatusResponse", "TraceSummary", "TraceSpan"} {
		if _, ok := schemaSet[name]; !ok {
			t.Fatalf("missing schema %s", name)
		}
	}
}
