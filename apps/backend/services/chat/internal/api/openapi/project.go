package openapi

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"regexp"
	"strings"
)

var sessionPath = regexp.MustCompile(`^/(?:v1/)?sessions`)

func Project(runtimeDocument []byte) ([]byte, error) {
	var runtimeContract any
	if err := json.Unmarshal(runtimeDocument, &runtimeContract); err != nil {
		return nil, err
	}
	contract, ok := projectRuntimeContract(runtimeContract).(map[string]any)
	if !ok {
		return nil, errors.New("Runtime OpenAPI document must be an object")
	}
	paths := object(contract["paths"])
	projectedPaths := make(map[string]any, len(paths)+1)
	for path, operation := range paths {
		projectedPaths[sessionPath.ReplaceAllString(path, "/conversations")] = operation
	}
	contract["paths"] = projectedPaths
	info := object(contract["info"])
	info["title"] = "Chat Product API"
	info["description"] = "Thin Web conversation product facade over Runtime"
	contract["info"] = info

	health := object(object(projectedPaths["/healthz"])["get"])
	health["operationId"] = "chatHealthz"
	object(projectedPaths["/healthz"])["get"] = health

	components := object(contract["components"])
	schemas := object(components["schemas"])
	stringSchema := map[string]any{"type": "string"}
	schemas["CreateConversationInput"] = map[string]any{
		"type": "object", "required": []any{"request_id"}, "additionalProperties": false,
		"properties": map[string]any{
			"request_id":  map[string]any{"type": "string", "minLength": float64(8), "maxLength": float64(64)},
			"title":       map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(200)},
			"provider_id": map[string]any{"type": "string", "maxLength": float64(32), "nullable": true},
			"project_id":  map[string]any{"type": "string", "maxLength": float64(36)},
			"canvas_id":   map[string]any{"type": "string", "maxLength": float64(36)},
		},
	}
	schemas["UpdateConversationInput"] = map[string]any{
		"type": "object", "required": []any{"title"}, "additionalProperties": false,
		"properties": map[string]any{"title": map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(200)}},
	}
	schemas["Conversation"] = map[string]any{
		"type":     "object",
		"required": []any{"id", "user_id", "tenant_id", "workspace_id", "title", "project_id", "canvas_id", "created_at", "updated_at"},
		"properties": map[string]any{
			"id": stringSchema, "user_id": stringSchema, "tenant_id": stringSchema, "workspace_id": stringSchema,
			"title": stringSchema, "project_id": map[string]any{"type": "string", "nullable": true},
			"canvas_id":  map[string]any{"type": "string", "nullable": true},
			"created_at": map[string]any{"type": "string", "format": "date-time"},
			"updated_at": map[string]any{"type": "string", "format": "date-time"},
		},
	}
	conversationDetail := object(schemas["ConversationDetail"])
	conversationDetail["required"] = append(array(conversationDetail["required"]), "title")
	detailProperties := object(conversationDetail["properties"])
	detailProperties["title"] = stringSchema
	detailProperties["project_id"] = map[string]any{"type": "string", "nullable": true}
	detailProperties["canvas_id"] = map[string]any{"type": "string", "nullable": true}
	conversationDetail["properties"] = detailProperties
	schemas["ConversationDetail"] = conversationDetail

	contextCategory := object(schemas["ConversationContextCategory"])
	contextProperties := object(contextCategory["properties"])
	contextID := object(contextProperties["id"])
	values := array(contextID["enum"])
	for index, value := range values {
		if value == "session" {
			values[index] = "conversation"
		}
	}
	contextID["enum"] = values
	contextProperties["id"] = contextID
	contextCategory["properties"] = contextProperties
	schemas["ConversationContextCategory"] = contextCategory
	schemas["CanvasConversationBinding"] = map[string]any{
		"type": "object", "required": []any{"id", "project_id", "canvas_id"},
		"properties": map[string]any{"id": stringSchema, "project_id": stringSchema, "canvas_id": stringSchema},
	}
	components["schemas"] = schemas
	contract["components"] = components

	conversationPath := object(projectedPaths["/conversations/{conversation_id}"])
	conversationPath["patch"] = map[string]any{
		"operationId": "updateConversation",
		"parameters":  []any{map[string]any{"name": "conversation_id", "in": "path", "required": true, "schema": stringSchema}},
		"requestBody": map[string]any{"required": true, "content": map[string]any{
			"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/UpdateConversationInput"}},
		}},
		"responses": map[string]any{"200": map[string]any{
			"description": "updated conversation metadata", "content": map[string]any{
				"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Conversation"}},
			},
		}},
	}
	projectedPaths["/conversations/{conversation_id}"] = conversationPath
	projectedPaths["/conversations/canvas"] = map[string]any{"post": map[string]any{
		"operationId": "createCanvasConversation",
		"requestBody": map[string]any{"required": true, "content": map[string]any{
			"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/CreateConversationInput"}},
		}},
		"responses": map[string]any{"201": map[string]any{
			"description": "Canvas-bound conversation", "content": map[string]any{
				"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/CanvasConversationBinding"}},
			},
		}},
	}}
	return json.MarshalIndent(contract, "", "  ")
}

func ProjectFile(path string) ([]byte, error) {
	document, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Project(document)
}

func Equivalent(left, right []byte) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func productName(value string) string {
	value = strings.ReplaceAll(value, "Sessions", "Conversations")
	value = strings.ReplaceAll(value, "Session", "Conversation")
	value = strings.ReplaceAll(value, "sessionId", "conversationId")
	return strings.ReplaceAll(value, "session_id", "conversation_id")
}

func projectRuntimeContract(value any) any {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = projectRuntimeContract(child)
		}
		return result
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, child := range typed {
			result[productName(key)] = projectRuntimeContract(child)
		}
		return result
	case string:
		return productName(typed)
	default:
		return value
	}
}

func object(value any) map[string]any {
	result, _ := value.(map[string]any)
	if result == nil {
		return map[string]any{}
	}
	return result
}

func array(value any) []any {
	result, _ := value.([]any)
	return result
}
