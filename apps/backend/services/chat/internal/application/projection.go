package application

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

func ProjectRuntimeValue(product Conversation, value any) any {
	switch typed := value.(type) {
	case []any:
		projected := make([]any, len(typed))
		for index, item := range typed {
			projected[index] = ProjectRuntimeValue(product, item)
		}
		return projected
	case map[string]any:
		projected := make(map[string]any, len(typed))
		_, hasNumericTokens := numericValue(typed["tokens"])
		for key, child := range typed {
			projectedKey := strings.ReplaceAll(strings.ReplaceAll(key, "sessionId", "conversationId"), "session_id", "conversation_id")
			switch {
			case key == "id" && child == "session" && hasNumericTokens:
				projected[projectedKey] = "conversation"
			case child == product.RuntimeSessionID:
				projected[projectedKey] = product.ID
			default:
				projected[projectedKey] = ProjectRuntimeValue(product, child)
			}
		}
		return projected
	case string:
		runtimePath := "/sessions/" + url.PathEscape(product.RuntimeSessionID)
		productPath := "/conversations/" + url.PathEscape(product.ID)
		return strings.ReplaceAll(typed, runtimePath, productPath)
	default:
		return value
	}
}

func ProjectConversation(product Conversation, runtimeValue any) map[string]any {
	projected, _ := ProjectRuntimeValue(product, runtimeValue).(map[string]any)
	if projected == nil {
		projected = map[string]any{}
	}
	projected["id"] = product.ID
	projected["user_id"] = product.UserID
	projected["tenant_id"] = product.TenantID
	projected["workspace_id"] = product.WorkspaceID
	projected["title"] = product.Title
	projected["project_id"] = product.ProjectID
	projected["canvas_id"] = product.CanvasID
	projected["created_at"] = isoMilliseconds(product.CreatedAt)
	projected["updated_at"] = isoMilliseconds(product.UpdatedAt)
	return projected
}

func RuntimeRunBody(product Conversation, body map[string]any) (map[string]any, error) {
	if value, exists := body["id"]; exists && value != product.ID {
		return nil, BadRequest("chat request id does not match the route conversation")
	}
	result := make(map[string]any, len(body)+1)
	for key, value := range body {
		result[key] = value
	}
	result["id"] = product.RuntimeSessionID
	result["generate_title"] = isAutoNamableTitle(product.Title)
	if product.ProjectID != nil && product.CanvasID != nil {
		result["host_context"] = map[string]any{"project_id": *product.ProjectID, "canvas_id": *product.CanvasID}
	}
	return result, nil
}

func isAutoNamableTitle(title string) bool {
	trimmed := strings.TrimSpace(title)
	return trimmed == "" || trimmed == "新对话"
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case fmt.Stringer:
		return 0, false
	default:
		return 0, false
	}
}
