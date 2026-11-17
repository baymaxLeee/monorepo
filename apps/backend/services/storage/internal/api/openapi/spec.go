package openapi

import "encoding/json"

func JSON() ([]byte, error) {
	return json.MarshalIndent(document(), "", "  ")
}

func document() map[string]any {
	problem := map[string]any{"type": "object", "required": []string{"title", "status"}, "properties": map[string]any{"type": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "detail": map[string]any{"type": "string"}, "status": map[string]any{"type": "integer"}}}
	return map[string]any{
		"openapi": "3.1.0",
		"info":    map[string]any{"title": "Storage Server API", "version": "2026-09-24", "description": "Platform file storage lifecycle, immutable revisions, and cross-service ownership claims."},
		"servers": []map[string]string{{"url": "/api/storage-server"}},
		"paths": map[string]any{
			"/upload-sessions/{uploadID}/content":             map[string]any{"put": map[string]any{"operationId": "storageUploadSessionContent", "summary": "Upload bytes through a domain-authorized capability", "parameters": []any{pathID("uploadID"), query("expires"), query("signature")}, "requestBody": map[string]any{"required": true, "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}, "responses": map[string]any{"201": jsonResponse(map[string]any{"$ref": "#/components/schemas/UploadResult"}), "400": problemResponse(), "403": problemResponse(), "409": problemResponse()}}},
			"/media/{assetID}/revisions/{revisionID}/content": map[string]any{"parameters": []any{pathID("assetID"), pathID("revisionID"), query("tenant_id"), query("workspace_id"), query("expires"), query("signature"), maxDimQuery()}, "get": contentOperation("storageReadCapabilityContent"), "head": contentOperation("storageHeadCapabilityContent")},
		},
		"components": map[string]any{"schemas": map[string]any{
			"Problem":      problem,
			"UploadResult": map[string]any{"type": "object", "required": []string{"asset_id", "revision_id", "filename", "media_type", "size_bytes", "sha256"}, "properties": map[string]any{"asset_id": id(), "revision_id": id(), "filename": map[string]any{"type": "string"}, "media_type": map[string]any{"type": "string"}, "size_bytes": map[string]any{"type": "integer", "format": "int64"}, "sha256": map[string]any{"type": "string", "pattern": "^[a-f0-9]{64}$"}}},
		}},
	}
}

func id() map[string]any { return map[string]any{"type": "string", "format": "uuid"} }
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
	return map[string]any{"operationId": operationID, "responses": map[string]any{"200": map[string]any{"description": "Immutable content", "headers": map[string]any{"ETag": map[string]any{"schema": map[string]any{"type": "string"}}, "Accept-Ranges": map[string]any{"schema": map[string]any{"type": "string"}}}, "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]any{"type": "string", "format": "binary"}}}}, "206": map[string]any{"description": "Partial content"}, "304": map[string]any{"description": "Not modified"}, "401": problemResponse(), "403": problemResponse(), "404": problemResponse(), "416": map[string]any{"description": "Range not satisfiable"}}}
}
func maxDimQuery() map[string]any {
	return map[string]any{"in": "query", "name": "max_dim", "required": false, "schema": map[string]any{"type": "integer", "minimum": 1, "maximum": 4096}}
}
