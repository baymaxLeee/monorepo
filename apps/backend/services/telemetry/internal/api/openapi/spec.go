package openapi

import "encoding/json"

func JSON() ([]byte, error) { return json.MarshalIndent(Spec(), "", "  ") }

func Spec() map[string]any {
	return map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title": "Telemetry Service", "description": "自托管前端 RUM 采集与查询服务(PostgreSQL 后端)", "version": "0.1.0",
		},
		"paths":      paths(),
		"components": map[string]any{"schemas": schemas()},
	}
}

func paths() map[string]any {
	return map[string]any{
		"/livez": map[string]any{"get": operation("health", "Livez", "livez", nil, nil, map[string]any{
			"200": map[string]any{"description": "Successful Response", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "additionalProperties": stringSchema()}}}},
		})},
		"/readyz":  map[string]any{"get": operation("health", "Readyz", "readyz", nil, nil, objectResponse())},
		"/healthz": map[string]any{"get": operation("health", "Healthz", "healthz", nil, nil, objectResponse())},
		"/rum/batch": map[string]any{"post": operation("rum", "Ingest Rum Batch", "ingest_rum_batch", authHeaders(), ref("RumBatch"), map[string]any{
			"204": map[string]any{"description": "Successful Response"}, "422": validationResponse(),
		})},
		"/errors":            map[string]any{"get": operation("errors", "List Error Events", "list_error_events", append([]any{integerQuery("limit", 100, 1, 500)}, authHeaders()...), nil, responses(ref("ErrorListResponse")))},
		"/performance":       map[string]any{"get": operation("performance", "List Performance Events", "list_performance_events", append([]any{integerQuery("limit", 200, 1, 1000)}, authHeaders()...), nil, responses(ref("PerformanceListResponse")))},
		"/ops/observability": map[string]any{"get": operation("ops", "Observability Status", "observability_status", authHeaders(), nil, responses(ref("ObservabilityStatusResponse")))},
		"/ops/traces": map[string]any{"get": operation("ops", "Recent Traces", "recent_traces", append([]any{
			integerQuery("limit", 50, 1, 200), integerQuery("minutes", 60, 5, 1440),
		}, authHeaders()...), nil, responses(ref("TraceListResponse")))},
		"/ops/traces/{trace_id}": map[string]any{"get": operation("ops", "Trace Detail", "trace_detail", append([]any{
			map[string]any{"name": "trace_id", "in": "path", "required": true, "schema": stringSchema()},
		}, authHeaders()...), nil, responses(ref("TraceDetailResponse")))},
	}
}

func operation(tag, summary, operationID string, parameters []any, body map[string]any, responseSet map[string]any) map[string]any {
	value := map[string]any{"tags": []string{tag}, "summary": summary, "operationId": operationID, "responses": responseSet}
	if len(parameters) > 0 {
		value["parameters"] = parameters
	}
	if body != nil {
		value["requestBody"] = map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": body}}}
	}
	return value
}

func responses(schema map[string]any) map[string]any {
	return map[string]any{
		"200": map[string]any{"description": "Successful Response", "content": map[string]any{"application/json": map[string]any{"schema": schema}}},
		"422": validationResponse(),
	}
}

func objectResponse() map[string]any {
	return map[string]any{"200": map[string]any{"description": "Successful Response", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "additionalProperties": true}}}}}
}

func validationResponse() map[string]any {
	return map[string]any{"description": "Validation Error", "content": map[string]any{"application/json": map[string]any{"schema": ref("HTTPValidationError")}}}
}

func authHeaders() []any {
	result := make([]any, 0, 4)
	for _, name := range []string{"X-Auth-User-ID", "X-Auth-Name", "X-Auth-Email", "X-Auth-Roles"} {
		result = append(result, map[string]any{"name": name, "in": "header", "required": false, "schema": nullable(stringSchema())})
	}
	return result
}

func integerQuery(name string, defaultValue, minimum, maximum int) map[string]any {
	return map[string]any{"name": name, "in": "query", "required": false, "schema": map[string]any{
		"type": "integer", "minimum": minimum, "maximum": maximum, "default": defaultValue,
	}}
}

func schemas() map[string]any {
	commonEvent := map[string]any{
		"ts_server": dateTimeSchema(), "app": stringSchema(), "release": stringSchema(), "user_id": nullable(stringSchema()),
		"username": nullable(stringSchema()), "is_admin": boolSchema(), "device_id": stringSchema(), "session_id": stringSchema(),
		"trace_id": nullable(stringSchema()), "route": stringSchema(),
	}
	errorProperties := clone(commonEvent)
	for key, value := range map[string]any{
		"fingerprint": stringSchema(), "name": stringSchema(), "message": stringSchema(), "stack": stringSchema(), "payload": objectSchema(),
	} {
		errorProperties[key] = value
	}
	performanceProperties := clone(commonEvent)
	for key, value := range map[string]any{"metric": stringSchema(), "value": numberSchema(), "payload": objectSchema()} {
		performanceProperties[key] = value
	}
	return map[string]any{
		"RumBatch": object([]string{"app", "device_id", "session_id", "events"}, map[string]any{
			"app":        enum("platform", "mfe-admin"),
			"release":    with(stringSchema(), "maxLength", 128, "default", ""),
			"device_id":  with(stringSchema(), "minLength", 1, "maxLength", 128),
			"session_id": with(stringSchema(), "minLength", 1, "maxLength", 128),
			"user_agent": with(stringSchema(), "maxLength", 512, "default", ""),
			"events":     with(array(ref("RumEvent")), "minItems", 1, "maxItems", 100),
		}),
		"RumEvent": object([]string{"type"}, map[string]any{
			"type": enum("perform", "error", "warning", "event"), "ts_client": nullable(integerSchema()),
			"trace_id": nullable(stringSchema()), "route": with(stringSchema(), "maxLength", 256, "default", ""), "payload": objectSchema(),
		}),
		"ErrorEvent":              object(keys(errorProperties), errorProperties),
		"ErrorListResponse":       object([]string{"items"}, map[string]any{"items": array(ref("ErrorEvent"))}),
		"PerformanceEvent":        object(keys(performanceProperties), performanceProperties),
		"PerformanceListResponse": object([]string{"items"}, map[string]any{"items": array(ref("PerformanceEvent"))}),
		"ClickHouseStatus": object([]string{"configured", "healthy", "spans_last_hour"}, map[string]any{
			"configured": boolSchema(), "healthy": boolSchema(), "spans_last_hour": integerSchema(),
			"latest_span_at": nullable(stringSchema()), "error": nullable(stringSchema()),
		}),
		"ObservabilityCapability": object([]string{"key", "label", "status", "detail"}, map[string]any{
			"key": stringSchema(), "label": stringSchema(), "status": stringSchema(), "detail": stringSchema(),
		}),
		"ObservabilityStatusResponse": object([]string{"otlp_endpoint", "trace_retention_days", "clickhouse", "capabilities"}, map[string]any{
			"otlp_endpoint": nullable(stringSchema()), "trace_retention_days": integerSchema(), "clickhouse": ref("ClickHouseStatus"),
			"capabilities": array(ref("ObservabilityCapability")),
		}),
		"TraceSummary": object([]string{"trace_id", "started_at", "ended_at", "duration_ms", "span_count", "error_count", "services"}, map[string]any{
			"trace_id": stringSchema(), "started_at": stringSchema(), "ended_at": stringSchema(), "duration_ms": integerSchema(),
			"span_count": integerSchema(), "error_count": integerSchema(), "services": array(stringSchema()),
			"root_span_name": nullable(stringSchema()), "run_id": nullable(stringSchema()),
		}),
		"TraceListResponse": object([]string{"items"}, map[string]any{"items": array(ref("TraceSummary"))}),
		"TraceSpan": object([]string{"trace_id", "span_id", "parent_span_id", "timestamp", "span_name", "span_kind", "service_name", "duration_ms", "status_code", "status_message", "span_attributes"}, map[string]any{
			"trace_id": stringSchema(), "span_id": stringSchema(), "parent_span_id": stringSchema(), "timestamp": stringSchema(),
			"span_name": stringSchema(), "span_kind": stringSchema(), "service_name": stringSchema(), "duration_ms": numberSchema(),
			"status_code": stringSchema(), "status_message": stringSchema(), "span_attributes": map[string]any{"type": "object", "additionalProperties": stringSchema()},
		}),
		"TraceDetailResponse": object([]string{"trace_id", "spans"}, map[string]any{"trace_id": stringSchema(), "spans": array(ref("TraceSpan"))}),
		"HTTPValidationError": object(nil, map[string]any{"detail": array(ref("ValidationError"))}),
		"ValidationError": object([]string{"loc", "msg", "type"}, map[string]any{
			"loc": array(map[string]any{"anyOf": []any{stringSchema(), integerSchema()}}), "msg": stringSchema(), "type": stringSchema(),
			"input": map[string]any{}, "ctx": map[string]any{"type": "object"},
		}),
	}
}

func object(required []string, properties map[string]any) map[string]any {
	value := map[string]any{"type": "object", "properties": properties}
	if len(required) > 0 {
		value["required"] = required
	}
	return value
}

func clone(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func keys(source map[string]any) []string {
	preferred := []string{"ts_server", "app", "release", "user_id", "username", "is_admin", "device_id", "session_id", "trace_id", "route", "fingerprint", "name", "message", "stack", "metric", "value", "payload"}
	result := make([]string, 0, len(source))
	for _, key := range preferred {
		if _, ok := source[key]; ok {
			result = append(result, key)
		}
	}
	return result
}

func with(schema map[string]any, pairs ...any) map[string]any {
	for index := 0; index < len(pairs); index += 2 {
		schema[pairs[index].(string)] = pairs[index+1]
	}
	return schema
}

func ref(name string) map[string]any { return map[string]any{"$ref": "#/components/schemas/" + name} }
func stringSchema() map[string]any   { return map[string]any{"type": "string"} }
func dateTimeSchema() map[string]any { return map[string]any{"type": "string", "format": "date-time"} }
func integerSchema() map[string]any  { return map[string]any{"type": "integer"} }
func numberSchema() map[string]any   { return map[string]any{"type": "number"} }
func boolSchema() map[string]any     { return map[string]any{"type": "boolean"} }
func objectSchema() map[string]any {
	return map[string]any{"type": "object", "additionalProperties": true}
}
func array(items map[string]any) map[string]any {
	return map[string]any{"type": "array", "items": items}
}
func nullable(schema map[string]any) map[string]any {
	return map[string]any{"anyOf": []any{schema, map[string]any{"type": "null"}}}
}
func enum(values ...string) map[string]any { return map[string]any{"type": "string", "enum": values} }
