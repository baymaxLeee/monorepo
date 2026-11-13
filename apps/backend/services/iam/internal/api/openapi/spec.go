package openapi

import "encoding/json"

func JSON() ([]byte, error) {
	return json.MarshalIndent(document(), "", "  ")
}

func document() map[string]any {
	paths := map[string]any{}
	add := func(method, path, operationID string, request, response map[string]any, successStatus string, parameters ...map[string]any) {
		operation := map[string]any{
			"operationId": operationID,
			"tags":        []string{"iam"},
			"responses": map[string]any{
				successStatus: successResponse(response),
				"400":         problemResponse(),
				"401":         problemResponse(),
				"403":         problemResponse(),
				"404":         problemResponse(),
				"409":         problemResponse(),
			},
		}
		if request != nil {
			operation["requestBody"] = map[string]any{
				"required": true,
				"content":  map[string]any{"application/json": map[string]any{"schema": request}},
			}
		}
		if len(parameters) > 0 {
			values := make([]any, 0, len(parameters))
			for _, parameter := range parameters {
				values = append(values, parameter)
			}
			operation["parameters"] = values
		}
		if paths[path] == nil {
			paths[path] = map[string]any{}
		}
		paths[path].(map[string]any)[method] = operation
	}

	add("get", "/livez", "iamLivez", nil, ref("HealthStatus"), "200")
	add("get", "/readyz", "iamReadyz", nil, ref("HealthStatus"), "200")
	add("get", "/healthz", "iamHealthz", nil, ref("HealthStatus"), "200")
	add("get", "/account-availability", "checkAccountAvailability", nil, ref("AccountAvailability"), "200", query("account", true, stringSchema()))
	add("post", "/register", "register", ref("RegisterInput"), ref("AuthSession"), "201")
	add("post", "/login", "login", ref("LoginInput"), ref("AuthSession"), "200")
	add("post", "/refresh", "refreshSession", nil, ref("AuthSession"), "200")
	add("post", "/logout", "logout", nil, ref("HealthStatus"), "200")
	add("get", "/me", "fetchMe", nil, ref("AuthUser"), "200")
	add("get", "/me/memberships", "fetchMemberships", nil, array(ref("Membership")), "200")
	add("post", "/me/memberships/{workspaceID}/apply", "applyToWorkspace", nil, nil, "204", path("workspaceID"))
	add("post", "/session/active-workspace", "switchActiveWorkspace", ref("SwitchWorkspaceInput"), ref("AuthSession"), "200")
	add("get", "/tenants", "listTenants", nil, array(ref("Tenant")), "200")
	add("post", "/tenants", "createTenant", ref("CreateTenantInput"), ref("Tenant"), "201")
	add("get", "/workspaces", "fetchPublicWorkspaces", nil, array(ref("WorkspaceSummary")), "200")
	add("post", "/workspaces", "createWorkspace", ref("CreateWorkspaceInput"), ref("WorkspaceAdminView"), "201")
	add("get", "/workspaces/admin", "listWorkspacesForAdmin", nil, array(ref("WorkspaceAdminView")), "200")
	add("post", "/workspaces/{workspaceID}/admins", "createWorkspaceAdmin", ref("CreateWorkspaceAdminInput"), ref("WorkspaceMemberView"), "201", path("workspaceID"))
	add("put", "/workspaces/{workspaceID}/owner", "transferWorkspaceOwner", ref("TransferWorkspaceOwnerInput"), nil, "204", path("workspaceID"))
	add("get", "/workspaces/{workspaceID}/members", "listWorkspaceMembers", nil, array(ref("WorkspaceMemberView")), "200", path("workspaceID"), query("status", false, enum("pending", "active", "rejected")))
	add("post", "/workspaces/{workspaceID}/members/{userID}/approve", "approveMember", nil, nil, "204", path("workspaceID"), path("userID"))
	add("post", "/workspaces/{workspaceID}/members/{userID}/reject", "rejectMember", ref("RejectMemberInput"), nil, "204", path("workspaceID"), path("userID"))
	add("put", "/workspaces/{workspaceID}/members/{userID}/role", "setMemberRole", ref("SetMemberRoleInput"), nil, "204", path("workspaceID"), path("userID"))
	add("get", "/roles", "listPlatformRoles", nil, array(ref("PlatformRole")), "200")
	add("get", "/users/{userID}/roles", "listUserPlatformRoles", nil, array(ref("PlatformRole")), "200", path("userID"))
	add("post", "/users/{userID}/roles", "assignUserRole", ref("AssignUserRoleInput"), nil, "204", path("userID"))
	add("delete", "/users/{userID}/roles/{roleID}", "removeUserRole", nil, nil, "204", path("userID"), path("roleID"))

	return map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":       "IAM Server API",
			"version":     "2026-11-12",
			"description": "Identity, session, workspace membership, and platform role control plane.",
		},
		"servers":    []map[string]string{{"url": "/api/iam-server"}},
		"paths":      paths,
		"components": map[string]any{"schemas": schemas()},
	}
}

func schemas() map[string]any {
	return map[string]any{
		"Problem": object([]string{"title", "status"}, map[string]any{
			"type": stringSchema(), "title": stringSchema(), "detail": stringSchema(),
			"status": map[string]any{"type": "integer"}, "code": stringSchema(), "message": stringSchema(),
		}),
		"HealthStatus": object([]string{"status"}, map[string]any{"status": stringSchema()}),
		"AccountAvailability": object([]string{"account", "available"}, map[string]any{
			"account": stringSchema(), "available": map[string]any{"type": "boolean"},
		}),
		"LoginInput": object([]string{"account", "password"}, map[string]any{
			"account": stringSchema(), "password": stringSchema(),
		}),
		"RegisterInput": object([]string{"account", "email", "password"}, map[string]any{
			"account": stringSchema(), "email": stringSchema(), "password": stringSchema(),
			"displayName": stringSchema(), "avatarUrl": stringSchema(), "phoneNumber": stringSchema(),
			"locale": stringSchema(), "timezone": stringSchema(), "workspaceId": stringSchema(),
		}),
		"Membership": object([]string{"tenantId", "workspaceId", "workspaceName", "role", "status"}, map[string]any{
			"tenantId": stringSchema(), "workspaceId": stringSchema(), "workspaceName": stringSchema(),
			"role": enum("workspace_admin", "member"), "status": enum("pending", "active", "rejected"),
		}),
		"AuthUser": object([]string{"id", "account", "email", "displayName", "avatarUrl", "locale", "timezone", "theme", "marketingOptIn", "emailVerified", "roles", "activeWorkspace", "memberships"}, map[string]any{
			"id": stringSchema(), "account": stringSchema(), "email": stringSchema(), "displayName": stringSchema(),
			"avatarUrl": stringSchema(), "locale": stringSchema(), "timezone": stringSchema(), "theme": stringSchema(),
			"marketingOptIn": map[string]any{"type": "boolean"}, "emailVerified": map[string]any{"type": "boolean"},
			"roles": array(stringSchema()), "activeWorkspace": nullable(ref("Membership")), "memberships": array(ref("Membership")),
		}),
		"AuthSession": object([]string{"accessToken", "expiresAt", "user"}, map[string]any{
			"accessToken": stringSchema(), "expiresAt": map[string]any{"type": "string", "format": "date-time"}, "user": ref("AuthUser"),
		}),
		"SwitchWorkspaceInput": object([]string{"workspaceId"}, map[string]any{"workspaceId": stringSchema()}),
		"Tenant":               object([]string{"id", "name", "slug"}, map[string]any{"id": stringSchema(), "name": stringSchema(), "slug": stringSchema()}),
		"CreateTenantInput":    object([]string{"name", "slug"}, map[string]any{"name": stringSchema(), "slug": stringSchema()}),
		"WorkspaceSummary":     object([]string{"tenantId", "id", "name"}, map[string]any{"tenantId": stringSchema(), "id": stringSchema(), "name": stringSchema()}),
		"WorkspaceAdminView": object([]string{"tenantId", "id", "name", "slug", "ownerUserId", "systemManaged", "joinPolicy", "memberCount", "createdAt"}, map[string]any{
			"tenantId": stringSchema(), "id": stringSchema(), "name": stringSchema(), "slug": stringSchema(), "ownerUserId": stringSchema(),
			"systemManaged": map[string]any{"type": "boolean"}, "joinPolicy": enum("open", "approval"),
			"memberCount": map[string]any{"type": "integer", "format": "int64"}, "createdAt": stringSchema(),
		}),
		"WorkspaceMemberView": object([]string{"userId", "account", "displayName", "email", "role", "status", "createdAt"}, map[string]any{
			"userId": stringSchema(), "account": stringSchema(), "displayName": stringSchema(), "email": stringSchema(),
			"role": enum("workspace_admin", "member"), "status": enum("pending", "active", "rejected"),
			"reviewedBy": nullable(stringSchema()), "reviewedAt": nullable(stringSchema()), "rejectionReason": nullable(stringSchema()), "createdAt": stringSchema(),
		}),
		"CreateWorkspaceInput": object([]string{"tenantId", "name", "slug"}, map[string]any{
			"tenantId": stringSchema(), "name": stringSchema(), "slug": stringSchema(), "ownerUserId": stringSchema(),
			"ownerAccount": stringSchema(), "ownerEmail": stringSchema(), "ownerPassword": stringSchema(), "ownerDisplayName": stringSchema(),
		}),
		"CreateWorkspaceAdminInput": object([]string{"account", "email", "password"}, map[string]any{
			"account": stringSchema(), "email": stringSchema(), "password": stringSchema(), "displayName": stringSchema(),
		}),
		"TransferWorkspaceOwnerInput": object([]string{"newOwnerUserId"}, map[string]any{"newOwnerUserId": stringSchema()}),
		"RejectMemberInput":           object(nil, map[string]any{"reason": stringSchema()}),
		"SetMemberRoleInput":          object([]string{"role"}, map[string]any{"role": enum("workspace_admin", "member")}),
		"PlatformRole": object([]string{"id", "name", "description", "createdAt"}, map[string]any{
			"id": stringSchema(), "name": stringSchema(), "description": stringSchema(), "createdAt": stringSchema(),
		}),
		"AssignUserRoleInput": object([]string{"roleId"}, map[string]any{"roleId": stringSchema()}),
	}
}

func object(required []string, properties map[string]any) map[string]any {
	schema := map[string]any{"type": "object", "additionalProperties": false, "properties": properties}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func ref(name string) map[string]any       { return map[string]any{"$ref": "#/components/schemas/" + name} }
func stringSchema() map[string]any         { return map[string]any{"type": "string"} }
func enum(values ...string) map[string]any { return map[string]any{"type": "string", "enum": values} }
func array(items map[string]any) map[string]any {
	return map[string]any{"type": "array", "items": items}
}
func nullable(schema map[string]any) map[string]any {
	return map[string]any{"anyOf": []any{schema, map[string]any{"type": "null"}}}
}

func path(name string) map[string]any {
	return map[string]any{"name": name, "in": "path", "required": true, "schema": stringSchema()}
}

func query(name string, required bool, schema map[string]any) map[string]any {
	return map[string]any{"name": name, "in": "query", "required": required, "schema": schema}
}

func successResponse(schema map[string]any) map[string]any {
	if schema == nil {
		return map[string]any{"description": "No content"}
	}
	return map[string]any{"description": "Success", "content": map[string]any{"application/json": map[string]any{"schema": schema}}}
}

func problemResponse() map[string]any {
	return map[string]any{"description": "Problem", "content": map[string]any{"application/problem+json": map[string]any{"schema": ref("Problem")}}}
}
