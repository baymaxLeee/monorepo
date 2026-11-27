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
	appCall := object(schemas["MCPAppCallInput"])
	delete(object(appCall["properties"]), "plugins")
	object(appCall["properties"])["plugin_id"] = map[string]any{"type": "string", "minLength": 1}
	appCall["required"] = []any{"tool_call_id", "plugin_id", "name", "arguments"}
	// These are internal Chat -> Runtime orchestration fields. The browser-facing
	// contract cannot override conversation-owned plugin selection or host policy.
	agentRunProperties := object(object(schemas["AgentRunRequest"])["properties"])
	delete(agentRunProperties, "generate_title")
	delete(agentRunProperties, "plugin_activations")
	delete(agentRunProperties, "host_context")
	stringSchema := map[string]any{"type": "string"}
	pluginSelectionSchema := map[string]any{
		"type": "object", "required": []any{"plugin_id"}, "additionalProperties": false,
		"properties": map[string]any{
			"plugin_id": map[string]any{
				"type": "string", "minLength": float64(3), "maxLength": float64(129),
				"pattern": `^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`,
			},
			"bindings": map[string]any{
				"type":                 "object",
				"additionalProperties": map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(256)},
			},
		},
	}
	schemas["ConversationPluginSelection"] = pluginSelectionSchema
	schemas["CreateConversationInput"] = map[string]any{
		"type": "object", "required": []any{"request_id"}, "additionalProperties": false,
		"properties": map[string]any{
			"request_id":         map[string]any{"type": "string", "minLength": float64(8), "maxLength": float64(64)},
			"title":              map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(200)},
			"provider_id":        map[string]any{"type": "string", "maxLength": float64(32), "nullable": true},
			"reasoning_effort":   map[string]any{"$ref": "#/components/schemas/ReasoningEffort", "nullable": true},
			"approval_policy":    map[string]any{"$ref": "#/components/schemas/ApprovalPolicy", "nullable": true},
			"permission_profile": map[string]any{"$ref": "#/components/schemas/PermissionProfile", "nullable": true},
			"plugin_selections": map[string]any{
				"type": "array", "maxItems": float64(16),
				"items": map[string]any{"$ref": "#/components/schemas/ConversationPluginSelection"},
			},
		},
	}
	schemas["CreateCanvasConversationInput"] = map[string]any{
		"type": "object", "required": []any{"request_id", "project_id", "canvas_id"}, "additionalProperties": false,
		"properties": map[string]any{
			"request_id":       map[string]any{"type": "string", "minLength": float64(8), "maxLength": float64(64)},
			"title":            map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(200)},
			"provider_id":      map[string]any{"type": "string", "maxLength": float64(32), "nullable": true},
			"reasoning_effort": map[string]any{"$ref": "#/components/schemas/ReasoningEffort", "nullable": true},
			"project_id":       map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(36)},
			"canvas_id":        map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(36)},
		},
	}
	schemas["UpdateConversationInput"] = map[string]any{
		"type": "object", "required": []any{"title"}, "additionalProperties": false,
		"properties": map[string]any{"title": map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(200)}},
	}
	schemas["UpdateConversationModelInput"] = map[string]any{
		"type": "object", "required": []any{"provider_id", "reasoning_effort"}, "additionalProperties": false,
		"properties": map[string]any{
			"provider_id":      map[string]any{"type": "string", "minLength": float64(1), "maxLength": float64(32)},
			"reasoning_effort": map[string]any{"$ref": "#/components/schemas/ReasoningEffort"},
		},
	}
	schemas["Conversation"] = map[string]any{
		"type":     "object",
		"required": []any{"id", "user_id", "tenant_id", "workspace_id", "title", "plugin_selections", "created_at", "updated_at"},
		"properties": map[string]any{
			"id": stringSchema, "user_id": stringSchema, "tenant_id": stringSchema, "workspace_id": stringSchema,
			"title": stringSchema,
			"plugin_selections": map[string]any{
				"type": "array", "items": map[string]any{"$ref": "#/components/schemas/ConversationPluginSelection"},
			},
			"created_at": map[string]any{"type": "string", "format": "date-time"},
			"updated_at": map[string]any{"type": "string", "format": "date-time"},
		},
	}
	conversationDetail := object(schemas["ConversationDetail"])
	conversationDetail["required"] = append(array(conversationDetail["required"]), "title", "plugin_selections")
	detailProperties := object(conversationDetail["properties"])
	detailProperties["title"] = stringSchema
	detailProperties["plugin_selections"] = map[string]any{
		"type": "array", "items": map[string]any{"$ref": "#/components/schemas/ConversationPluginSelection"},
	}
	conversationDetail["properties"] = detailProperties
	schemas["ConversationDetail"] = conversationDetail

	localConfigPath := object(projectedPaths["/local-inference/config"])
	localConfigOperation := object(localConfigPath["post"])
	delete(localConfigOperation, "requestBody")
	localConfigOperation["operationId"] = "getLocalInferenceConfig"
	localConfigOperation["parameters"] = []any{
		map[string]any{"name": "provider_id", "in": "query", "required": true, "schema": stringSchema},
		map[string]any{"name": "reasoning_effort", "in": "query", "required": true, "schema": map[string]any{"$ref": "#/components/schemas/ReasoningEffort"}},
	}
	delete(localConfigPath, "post")
	localConfigPath["get"] = localConfigOperation
	projectedPaths["/local-inference/config"] = localConfigPath

	localStreamPath := object(projectedPaths["/local-inference/stream"])
	localStreamOperation := object(localStreamPath["post"])
	localStreamRequestBody := object(localStreamOperation["requestBody"])
	localStreamContent := object(localStreamRequestBody["content"])
	localStreamJSON := object(localStreamContent["application/json"])
	localStreamJSON["schema"] = object(object(schemas["LocalInferenceStreamRequest"])["properties"])["request"]
	localStreamContent["application/json"] = localStreamJSON
	localStreamRequestBody["content"] = localStreamContent
	localStreamOperation["requestBody"] = localStreamRequestBody
	localStreamPath["post"] = localStreamOperation
	projectedPaths["/local-inference/stream"] = localStreamPath

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
	addMemorySchemas(schemas)
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
	conversationsPath := object(projectedPaths["/conversations"])
	conversationsPath["get"] = map[string]any{
		"operationId": "listConversations",
		"responses": map[string]any{"200": map[string]any{
			"description": "conversations visible in the authenticated product scope", "content": map[string]any{
				"application/json": map[string]any{"schema": map[string]any{
					"type": "array", "items": map[string]any{"$ref": "#/components/schemas/Conversation"},
				}},
			},
		}},
	}
	projectedPaths["/conversations"] = conversationsPath
	projectedPaths["/conversations/canvas"] = map[string]any{"post": map[string]any{
		"operationId": "createCanvasConversation",
		"requestBody": map[string]any{"required": true, "content": map[string]any{
			"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/CreateCanvasConversationInput"}},
		}},
		"responses": map[string]any{"201": map[string]any{
			"description": "Canvas-bound conversation", "content": map[string]any{
				"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/CanvasConversationBinding"}},
			},
		}},
	}}
	addMemoryPaths(projectedPaths)
	return json.MarshalIndent(contract, "", "  ")
}

func addMemorySchemas(schemas map[string]any) {
	ref := func(name string) map[string]any { return map[string]any{"$ref": "#/components/schemas/" + name} }
	schemas["MemoryCategory"] = map[string]any{
		"type": "string", "enum": []any{"preference", "profile", "project", "instruction"},
	}
	schemas["UserMemory"] = map[string]any{
		"type": "object", "required": []any{"id", "category", "content", "confidence"},
		"properties": map[string]any{
			"id": map[string]any{"type": "string"}, "category": ref("MemoryCategory"),
			"content": map[string]any{"type": "string"}, "confidence": map[string]any{"type": "integer"},
		},
	}
	schemas["MemoryCandidate"] = map[string]any{
		"type": "object", "required": []any{"id", "category", "content", "reason", "supersedesId", "createdAt"},
		"properties": map[string]any{
			"id": map[string]any{"type": "string"}, "category": ref("MemoryCategory"),
			"content": map[string]any{"type": "string"}, "reason": map[string]any{"type": "string", "nullable": true},
			"supersedesId": map[string]any{"type": "string", "nullable": true},
			"createdAt":    map[string]any{"type": "string", "format": "date-time"},
		},
	}
	schemas["UserMemoryList"] = objectListSchema("memories", ref("UserMemory"))
	schemas["MemoryCandidateList"] = objectListSchema("candidates", ref("MemoryCandidate"))
	schemas["UpdateMemoryCandidate"] = map[string]any{
		"type": "object", "minProperties": float64(1),
		"properties": map[string]any{
			"category": ref("MemoryCategory"),
			"content":  map[string]any{"type": "string", "minLength": float64(5), "maxLength": float64(500)},
		},
	}
	schemas["UpdatedMemoryCandidate"] = objectPropertySchema("candidate", ref("MemoryCandidate"))
	schemas["ApprovedMemory"] = objectPropertySchema("memory", ref("UserMemory"))
	schemas["RejectedMemory"] = objectPropertySchema("rejected", map[string]any{"type": "boolean"})
	schemas["DeletedMemory"] = objectPropertySchema("deleted", map[string]any{"type": "boolean"})
}

func addMemoryPaths(paths map[string]any) {
	response := func(description, schema string) map[string]any {
		return map[string]any{"200": map[string]any{
			"description": description,
			"content": map[string]any{"application/json": map[string]any{
				"schema": map[string]any{"$ref": "#/components/schemas/" + schema},
			}},
		}}
	}
	idParameter := []any{map[string]any{
		"name": "id", "in": "path", "required": true, "schema": map[string]any{"type": "string"},
	}}
	paths["/memories"] = map[string]any{"get": map[string]any{
		"operationId": "listActiveMemories", "responses": response("list active user memories", "UserMemoryList"),
	}}
	paths["/memories/candidates"] = map[string]any{"get": map[string]any{
		"operationId": "listMemoryCandidates", "responses": response("list pending memory candidates", "MemoryCandidateList"),
	}}
	paths["/memories/candidates/{id}"] = map[string]any{"patch": map[string]any{
		"operationId": "updateMemoryCandidate", "parameters": idParameter,
		"requestBody": map[string]any{"required": true, "content": map[string]any{
			"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/UpdateMemoryCandidate"}},
		}},
		"responses": response("edit a pending memory candidate before approval", "UpdatedMemoryCandidate"),
	}}
	paths["/memories/candidates/{id}/approve"] = map[string]any{"post": map[string]any{
		"operationId": "approveMemoryCandidate", "parameters": idParameter,
		"responses": response("approve a memory candidate into active memory", "ApprovedMemory"),
	}}
	paths["/memories/candidates/{id}/reject"] = map[string]any{"post": map[string]any{
		"operationId": "rejectMemoryCandidate", "parameters": idParameter,
		"responses": response("reject a memory candidate", "RejectedMemory"),
	}}
	paths["/memories/{id}"] = map[string]any{"delete": map[string]any{
		"operationId": "deleteMemory", "parameters": idParameter,
		"responses": response("delete a stored memory", "DeletedMemory"),
	}}
}

func objectListSchema(name string, item map[string]any) map[string]any {
	return map[string]any{
		"type": "object", "required": []any{name},
		"properties": map[string]any{name: map[string]any{"type": "array", "items": item}},
	}
}

func objectPropertySchema(name string, property map[string]any) map[string]any {
	return map[string]any{
		"type": "object", "required": []any{name}, "properties": map[string]any{name: property},
	}
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
