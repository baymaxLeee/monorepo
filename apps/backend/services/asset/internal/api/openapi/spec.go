package openapi

import "encoding/json"

func JSON() ([]byte, error) {
	return json.MarshalIndent(document(), "", "  ")
}

func document() map[string]any {
	problem := map[string]any{"type": "object", "required": []string{"title", "status"}, "properties": map[string]any{"type": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "detail": map[string]any{"type": "string"}, "status": map[string]any{"type": "integer"}}}
	claim := map[string]any{"type": "object", "required": []string{"claim_id", "asset_id", "kind", "status", "generation"}, "properties": map[string]any{"claim_id": id(), "asset_id": id(), "revision_id": id(), "kind": map[string]any{"type": "string", "enum": []string{"strong", "snapshot", "lease", "weak"}}, "status": map[string]any{"type": "string", "enum": []string{"pending", "active", "released"}}, "generation": map[string]any{"type": "integer", "format": "int64"}, "expires_at": map[string]any{"type": []string{"string", "null"}, "format": "date-time"}}}
	deliveryItem := map[string]any{"type": "object", "required": []string{"tenant_id", "workspace_id", "asset_id", "revision_id"}, "properties": map[string]any{"tenant_id": map[string]any{"type": "string"}, "workspace_id": map[string]any{"type": "string"}, "asset_id": id(), "revision_id": id()}}
	uploadSession := map[string]any{"type": "object", "required": []string{"upload_session_id", "intent_id", "state", "user_id", "category", "filename", "media_type", "size_bytes", "expires_at", "upload_url"}, "properties": map[string]any{"upload_session_id": id(), "intent_id": map[string]any{"type": "string"}, "state": map[string]any{"type": "string", "enum": []string{"pending", "uploading", "completed", "failed", "aborted"}}, "user_id": map[string]any{"type": "string"}, "category": map[string]any{"type": "string"}, "filename": map[string]any{"type": "string"}, "media_type": map[string]any{"type": "string"}, "size_bytes": map[string]any{"type": "integer", "format": "int64", "minimum": 0}, "expires_at": map[string]any{"type": "string", "format": "date-time"}, "upload_url": map[string]any{"type": "string"}, "asset_id": id(), "revision_id": id()}}
	return map[string]any{
		"openapi": "3.1.0",
		"info":    map[string]any{"title": "Asset Server API", "version": "2026-09-24", "description": "Platform asset lifecycle, immutable revisions, and cross-service ownership claims."},
		"servers": []map[string]string{{"url": "/api/asset-server"}},
		"paths": map[string]any{
			"/upload-sessions/{uploadID}/content":                       map[string]any{"put": map[string]any{"operationId": "assetUploadSessionContent", "summary": "Upload bytes through a domain-authorized capability", "parameters": []any{pathID("uploadID"), query("expires"), query("signature")}, "requestBody": map[string]any{"required": true, "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}, "responses": map[string]any{"201": jsonResponse(map[string]any{"$ref": "#/components/schemas/UploadResult"}), "400": problemResponse(), "403": problemResponse(), "409": problemResponse()}}},
			"/assets/{assetID}/revisions/{revisionID}/content":          map[string]any{"parameters": []any{pathID("assetID"), pathID("revisionID"), header("X-Auth-Tenant-ID"), header("X-Auth-Workspace-ID"), header("X-Auth-User-ID")}, "get": contentOperation("assetReadContent"), "head": contentOperation("assetHeadContent")},
			"/media/{assetID}/revisions/{revisionID}/content":           map[string]any{"parameters": []any{pathID("assetID"), pathID("revisionID"), query("tenant_id"), query("workspace_id"), query("expires"), query("signature")}, "get": contentOperation("assetReadCapabilityContent"), "head": contentOperation("assetHeadCapabilityContent")},
			"/internal/assets/{assetID}/revisions/{revisionID}/content": map[string]any{"parameters": []any{pathID("assetID"), pathID("revisionID"), header("X-Caller-Service"), header("X-Internal-Token"), query("tenant_id"), query("workspace_id")}, "get": contentOperation("assetReadContentInternal"), "head": contentOperation("assetHeadContentInternal")},
			"/internal/assets/{assetID}/revisions/{revisionID}":         map[string]any{"parameters": []any{pathID("assetID"), pathID("revisionID"), header("X-Caller-Service"), header("X-Internal-Token"), query("tenant_id"), query("workspace_id")}, "get": map[string]any{"operationId": "assetDescribeRevisionInternal", "responses": map[string]any{"200": jsonResponse(map[string]any{"$ref": "#/components/schemas/RevisionMetadata"}), "403": problemResponse(), "404": problemResponse()}}},
			"/internal/assets":                     map[string]any{"post": map[string]any{"operationId": "assetUploadInternal", "summary": "Idempotently stream service-produced bytes into an immutable Asset revision", "parameters": []any{header("X-Caller-Service"), header("X-Internal-Token"), query("tenant_id"), query("workspace_id"), query("user_id"), query("filename"), query("category"), query("idempotency_key")}, "requestBody": map[string]any{"required": true, "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}, "responses": map[string]any{"201": jsonResponse(map[string]any{"$ref": "#/components/schemas/UploadResult"}), "400": problemResponse(), "403": problemResponse(), "409": problemResponse()}}},
			"/internal/upload-sessions":            map[string]any{"post": map[string]any{"operationId": "assetCreateUploadSessionInternal", "summary": "Create or recover a domain-authorized browser upload session", "parameters": []any{header("X-Caller-Service"), header("X-Internal-Token")}, "requestBody": map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/CreateUploadSessionRequest"}}}}, "responses": map[string]any{"200": jsonResponse(map[string]any{"$ref": "#/components/schemas/UploadSession"}), "400": problemResponse(), "403": problemResponse(), "409": problemResponse()}}},
			"/internal/upload-sessions/{uploadID}": map[string]any{"get": map[string]any{"operationId": "assetDescribeUploadSessionInternal", "summary": "Resolve an upload session in the creating service scope", "parameters": []any{pathID("uploadID"), header("X-Caller-Service"), header("X-Internal-Token"), query("tenant_id"), query("workspace_id")}, "responses": map[string]any{"200": jsonResponse(map[string]any{"$ref": "#/components/schemas/UploadSession"}), "400": problemResponse(), "403": problemResponse(), "404": problemResponse()}}},
			"/internal/claims:prepare":             map[string]any{"post": claimOperation("assetPrepareClaim", "PrepareClaimRequest", claim)},
			"/internal/claims:activate":            map[string]any{"post": claimOperation("assetActivateClaim", "MutateClaimRequest", claim)},
			"/internal/claims:release":             map[string]any{"post": claimOperation("assetReleaseClaim", "MutateClaimRequest", claim)},
			"/internal/delivery-capabilities:mint": map[string]any{"post": map[string]any{"operationId": "assetMintDeliveryCapabilities", "parameters": []any{header("X-Caller-Service"), header("X-Internal-Token")}, "requestBody": map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "required": []string{"items"}, "properties": map[string]any{"items": map[string]any{"type": "array", "minItems": 1, "maxItems": 200, "items": deliveryItem}}}}}}, "responses": map[string]any{"200": jsonResponse(map[string]any{"$ref": "#/components/schemas/DeliveryCapabilityResponse"}), "400": problemResponse(), "403": problemResponse()}}},
		},
		"components": map[string]any{"schemas": map[string]any{
			"Problem": problem, "Claim": claim,
			"CreateUploadSessionRequest": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"tenant_id", "workspace_id", "user_id", "intent_id", "filename", "media_type", "category", "size_bytes"}, "properties": map[string]any{"tenant_id": map[string]any{"type": "string"}, "workspace_id": map[string]any{"type": "string"}, "user_id": map[string]any{"type": "string"}, "intent_id": map[string]any{"type": "string", "minLength": 1, "maxLength": 255}, "filename": map[string]any{"type": "string"}, "media_type": map[string]any{"type": "string"}, "category": map[string]any{"type": "string"}, "size_bytes": map[string]any{"type": "integer", "format": "int64", "minimum": 0}}},
			"UploadSession":              uploadSession,
			"UploadResult":               map[string]any{"type": "object", "required": []string{"asset_id", "revision_id", "filename", "media_type", "size_bytes", "sha256", "url"}, "properties": map[string]any{"asset_id": id(), "revision_id": id(), "filename": map[string]any{"type": "string"}, "media_type": map[string]any{"type": "string"}, "size_bytes": map[string]any{"type": "integer", "format": "int64"}, "sha256": map[string]any{"type": "string", "pattern": "^[a-f0-9]{64}$"}, "url": map[string]any{"type": "string"}}},
			"RevisionMetadata":           map[string]any{"type": "object", "required": []string{"asset_id", "revision_id", "category", "filename", "media_type", "size_bytes", "sha256", "created_by"}, "properties": map[string]any{"asset_id": id(), "revision_id": id(), "category": map[string]any{"type": "string"}, "filename": map[string]any{"type": "string"}, "media_type": map[string]any{"type": "string"}, "size_bytes": map[string]any{"type": "integer", "format": "int64"}, "sha256": map[string]any{"type": "string"}, "created_by": map[string]any{"type": "string"}}},
			"PrepareClaimRequest":        claimRequest(true), "MutateClaimRequest": claimRequest(false),
			"DeliveryCapabilityResponse": map[string]any{"type": "object", "required": []string{"items"}, "properties": map[string]any{"items": map[string]any{"type": "array", "items": map[string]any{"type": "object", "required": []string{"asset_id", "revision_id", "url", "expires_at"}, "properties": map[string]any{"asset_id": id(), "revision_id": id(), "url": map[string]any{"type": "string"}, "expires_at": map[string]any{"type": "string", "format": "date-time"}}}}}},
		}},
	}
}

func id() map[string]any { return map[string]any{"type": "string", "format": "uuid"} }
func header(name string) map[string]any {
	return map[string]any{"in": "header", "name": name, "required": true, "schema": map[string]any{"type": "string"}}
}
func query(name string) map[string]any {
	return map[string]any{"in": "query", "name": name, "required": true, "schema": map[string]any{"type": "string"}}
}
func pathID(name string) map[string]any {
	return map[string]any{"in": "path", "name": name, "required": true, "schema": id()}
}
func jsonResponse(schema map[string]any) map[string]any {
	return map[string]any{"description": "Success", "content": map[string]any{"application/json": map[string]any{"schema": schema}}}
}
func problemResponse() map[string]any {
	return map[string]any{"description": "Problem", "content": map[string]any{"application/problem+json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Problem"}}}}
}
func contentOperation(operationID string) map[string]any {
	return map[string]any{"operationId": operationID, "responses": map[string]any{"200": map[string]any{"description": "Immutable content", "headers": map[string]any{"ETag": map[string]any{"schema": map[string]any{"type": "string"}}, "Accept-Ranges": map[string]any{"schema": map[string]any{"type": "string"}}}, "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}, "206": map[string]any{"description": "Partial content"}, "401": problemResponse(), "404": problemResponse()}}
}
func claimOperation(operationID, schemaName string, _ map[string]any) map[string]any {
	return map[string]any{"operationId": operationID, "parameters": []any{header("X-Caller-Service"), header("X-Internal-Token")}, "requestBody": map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/" + schemaName}}}}, "responses": map[string]any{"200": jsonResponse(map[string]any{"$ref": "#/components/schemas/Claim"}), "400": problemResponse(), "403": problemResponse(), "409": problemResponse()}}
}
func claimRequest(prepare bool) map[string]any {
	properties := map[string]any{"tenant_id": map[string]any{"type": "string"}, "workspace_id": map[string]any{"type": "string"}, "owner_type": map[string]any{"type": "string"}, "owner_id": map[string]any{"type": "string"}, "slot": map[string]any{"type": "string"}, "generation": map[string]any{"type": "integer", "format": "int64", "minimum": 1}}
	required := []string{"tenant_id", "workspace_id", "owner_type", "owner_id", "slot", "generation"}
	if prepare {
		properties["asset_id"] = id()
		properties["revision_id"] = id()
		properties["kind"] = map[string]any{"type": "string", "enum": []string{"strong", "snapshot", "lease", "weak"}}
		properties["expires_at"] = map[string]any{"type": []string{"string", "null"}, "format": "date-time"}
		required = append(required, "asset_id", "kind")
	}
	return map[string]any{"type": "object", "additionalProperties": false, "required": required, "properties": properties}
}
