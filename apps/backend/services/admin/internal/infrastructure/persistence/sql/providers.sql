-- name: ListProviders :many
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at
FROM
    model_providers
WHERE
    workspace_id = $1
    AND tenant_id = $2
ORDER BY
    is_default DESC,
    updated_at DESC;

-- name: GetProvider :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at
FROM
    model_providers
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3;

-- name: GetDefaultProvider :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at
FROM
    model_providers
WHERE
    workspace_id = $1
    AND tenant_id = $2
    AND provider_kind = 'chat'
    AND is_default
    AND is_enabled
ORDER BY
    updated_at DESC
LIMIT
    1;

-- name: GetProviderByKind :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at
FROM
    model_providers
WHERE
    workspace_id = $1
    AND tenant_id = $2
    AND provider_kind = $3
    AND is_enabled
ORDER BY
    updated_at DESC
LIMIT
    1;

-- name: LockProviderDefaults :exec
SELECT
    pg_advisory_xact_lock(hashtextextended (sqlc.arg (lock_key)::text, 0));

-- name: ClearDefaultProvider :exec
UPDATE model_providers
SET
    is_default = FALSE,
    updated_at = now()
WHERE
    workspace_id = $1
    AND tenant_id = $2
    AND is_default;

-- name: CreateProvider :one
INSERT INTO
    model_providers (
        id,
        user_id,
        workspace_id,
        tenant_id,
        name,
        model,
        provider_kind,
        responses_dialect,
        base_url,
        api_key_enc,
        extra_body,
        pricing_json,
        context_window,
        max_output_tokens,
        supports_image_input,
        is_default,
        is_enabled,
        created_at,
        updated_at
    )
VALUES
    (
        sqlc.arg (id),
        sqlc.arg (user_id),
        sqlc.arg (workspace_id),
        sqlc.arg (tenant_id),
        sqlc.arg (name),
        sqlc.arg (model),
        sqlc.arg (provider_kind),
        sqlc.arg (responses_dialect),
        sqlc.arg (base_url),
        sqlc.arg (api_key_enc),
        sqlc.arg (extra_body),
        sqlc.arg (pricing_json),
        sqlc.arg (context_window)::bigint,
        sqlc.arg (max_output_tokens)::bigint,
        sqlc.arg (supports_image_input),
        sqlc.arg (is_default),
        sqlc.arg (is_enabled),
        sqlc.arg (created_at),
        sqlc.arg (updated_at)
    )
RETURNING
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at;

-- name: DeleteProvider :execrows
DELETE FROM model_providers
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3;

-- name: DeleteProviders :execrows
DELETE FROM model_providers
WHERE
    id = ANY(sqlc.arg(ids)::VARCHAR[])
    AND workspace_id = sqlc.arg(workspace_id)
    AND tenant_id = sqlc.arg(tenant_id);

-- name: SaveProvider :one
UPDATE model_providers
SET
    name = sqlc.arg (name),
    model = sqlc.arg (model),
    provider_kind = sqlc.arg (provider_kind),
    responses_dialect = sqlc.arg (responses_dialect),
    base_url = sqlc.arg (base_url),
    api_key_enc = sqlc.arg (api_key_enc),
    extra_body = sqlc.arg (extra_body),
    pricing_json = sqlc.arg (pricing_json),
    context_window = sqlc.arg (context_window)::bigint,
    max_output_tokens = sqlc.arg (max_output_tokens)::bigint,
    supports_image_input = sqlc.arg (supports_image_input),
    is_default = sqlc.arg (is_default),
    is_enabled = sqlc.arg (is_enabled),
    updated_at = now()
WHERE
    id = sqlc.arg (id)
    AND workspace_id = sqlc.arg (workspace_id)
    AND tenant_id = sqlc.arg (tenant_id)
RETURNING
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at;

-- name: LockProvider :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at
FROM
    model_providers
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3
FOR UPDATE;

-- name: SetDefaultProvider :one
UPDATE model_providers
SET
    is_default = TRUE,
    updated_at = now()
WHERE
    id = $1
RETURNING
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    model,
    provider_kind,
    responses_dialect,
    base_url,
    api_key_enc,
    extra_body,
    pricing_json,
    context_window,
    max_output_tokens,
    supports_image_input,
    is_default,
    is_enabled,
    created_at,
    updated_at;
