package application

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"regexp"
	"slices"
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
			case child == product.RuntimeThreadID:
				projected[projectedKey] = product.ID
			default:
				projected[projectedKey] = ProjectRuntimeValue(product, child)
			}
		}
		return projected
	case string:
		runtimePath := "/sessions/" + url.PathEscape(product.RuntimeThreadID)
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
	projected["plugin_selections"] = clonePluginSelections(product.PluginSelections)
	projected["created_at"] = isoMilliseconds(product.CreatedAt)
	projected["updated_at"] = isoMilliseconds(product.UpdatedAt)
	return projected
}

func RuntimeRunBody(product Conversation, body map[string]any, capabilities TurnCapabilities) (map[string]any, error) {
	if value, exists := body["id"]; exists && value != product.ID {
		return nil, BadRequest("chat request id does not match the route conversation")
	}
	result := make(map[string]any, len(body)+1)
	for key, value := range body {
		result[key] = value
	}
	if message, ok := result["message"].(map[string]any); ok && message["role"] == "user" {
		projected, err := runtimeUserAttachments(product, message)
		if err != nil {
			return nil, err
		}
		result["message"] = projected
	}
	delete(result, "host_context")
	delete(result, "capabilities")
	delete(result, "plugin_activations")
	result["id"] = product.RuntimeThreadID
	result["generate_title"] = isAutoNamableTitle(product.Title)
	result["capabilities"] = capabilities
	return result, nil
}

// Only the attachment URL crosses namespaces. Text and tool data are opaque.
func runtimeUserAttachments(product Conversation, message map[string]any) (map[string]any, error) {
	parts, ok := message["parts"].([]any)
	if !ok {
		return message, nil
	}
	projected := slices.Clone(parts)
	for i, value := range parts {
		part, ok := value.(map[string]any)
		if !ok || part["type"] != "file" {
			continue
		}
		raw, _ := part["url"].(string)
		canonical, err := runtimeFileURL(product, raw)
		if err != nil {
			return nil, err
		}
		projectedPart := maps.Clone(part)
		projectedPart["url"] = canonical
		projected[i] = projectedPart
	}
	result := maps.Clone(message)
	result["parts"] = projected
	return result, nil
}

func runtimeFileURL(product Conversation, raw string) (string, error) {
	prefix := "/api/chat-server/conversations/" + url.PathEscape(product.ID) + "/files/"
	tail, inConversation := strings.CutPrefix(raw, prefix)
	id, content := strings.CutSuffix(tail, "/content")
	if !inConversation || !content || !validFileID.MatchString(id) {
		return "", BadRequest("file attachments must reference a file in this conversation")
	}
	return "/api/chat-server/sessions/" + url.PathEscape(product.RuntimeThreadID) + "/files/" + id + "/content", nil
}

var validFileID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

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
