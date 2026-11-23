-- name: ListSkills :many
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    username,
    name,
    description,
    status,
    is_enabled,
    workspace_seq,
    workspace_sha256,
    published_sha256,
    published_at,
    published_name,
    published_description,
    source_archive_asset_id,
    source_archive_revision_id,
    created_at,
    updated_at
FROM
    skills
WHERE
    workspace_id = $1
    AND tenant_id = $2
ORDER BY
    updated_at DESC;

-- name: ListSkillsByIDs :many
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    username,
    name,
    description,
    status,
    is_enabled,
    workspace_seq,
    workspace_sha256,
    published_sha256,
    published_at,
    published_name,
    published_description,
    source_archive_asset_id,
    source_archive_revision_id,
    created_at,
    updated_at
FROM
    skills
WHERE
    id = ANY(sqlc.arg(ids)::VARCHAR[])
    AND workspace_id = sqlc.arg(workspace_id)
    AND tenant_id = sqlc.arg(tenant_id)
FOR UPDATE;

-- name: GetSkill :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    username,
    name,
    description,
    status,
    is_enabled,
    workspace_seq,
    workspace_sha256,
    published_sha256,
    published_at,
    published_name,
    published_description,
    source_archive_asset_id,
    source_archive_revision_id,
    created_at,
    updated_at
FROM
    skills
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3;

-- name: GetSkillForUpdate :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    username,
    name,
    description,
    status,
    is_enabled,
    workspace_seq,
    workspace_sha256,
    published_sha256,
    published_at,
    published_name,
    published_description,
    source_archive_asset_id,
    source_archive_revision_id,
    created_at,
    updated_at
FROM
    skills
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3
FOR UPDATE;

-- name: GetSkillByName :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    username,
    name,
    description,
    status,
    is_enabled,
    workspace_seq,
    workspace_sha256,
    published_sha256,
    published_at,
    published_name,
    published_description,
    source_archive_asset_id,
    source_archive_revision_id,
    created_at,
    updated_at
FROM
    skills
WHERE
    name = $1
    AND workspace_id = $2
    AND tenant_id = $3;

-- name: CreateSkill :exec
INSERT INTO
    skills (
        id,
        user_id,
        workspace_id,
        tenant_id,
        username,
        name,
        description,
        status,
        is_enabled,
        workspace_seq,
        workspace_sha256,
        created_at,
        updated_at
    )
VALUES
    (
        sqlc.arg (id),
        sqlc.arg (user_id),
        sqlc.arg (workspace_id),
        sqlc.arg (tenant_id),
        sqlc.arg (username),
        sqlc.arg (name),
        sqlc.arg (description),
        sqlc.arg (status),
        sqlc.arg (is_enabled),
        sqlc.arg (workspace_seq)::bigint,
        sqlc.arg (workspace_sha256),
        sqlc.arg (created_at),
        sqlc.arg (updated_at)
    );

-- name: SaveSkill :exec
UPDATE skills
SET
    name = sqlc.arg (name),
    description = sqlc.arg (description),
    status = sqlc.arg (status),
    is_enabled = sqlc.arg (is_enabled),
    workspace_seq = sqlc.arg (workspace_seq)::bigint,
    workspace_sha256 = sqlc.arg (workspace_sha256),
    published_sha256 = sqlc.arg (published_sha256),
    published_at = sqlc.arg (published_at),
    published_name = sqlc.arg (published_name),
    published_description = sqlc.arg (published_description),
    source_archive_asset_id = sqlc.arg (source_archive_asset_id),
    source_archive_revision_id = sqlc.arg (source_archive_revision_id),
    updated_at = sqlc.arg (updated_at)
WHERE
    id = sqlc.arg (id);

-- name: DeleteSkill :exec
DELETE FROM skills
WHERE
    id = $1;

-- name: BulkDeleteSkills :execrows
DELETE FROM skills
WHERE
    id = ANY(sqlc.arg(ids)::VARCHAR[])
    AND workspace_id = sqlc.arg(workspace_id)
    AND tenant_id = sqlc.arg(tenant_id);

-- name: ListSkillNodes :many
SELECT
    id,
    skill_id,
    parent_id,
    name,
    node_type,
    mime_type,
    content,
    storage_kind,
    asset_id,
    revision_id,
    size_bytes,
    sha256,
    sort_order,
    created_at,
    updated_at
FROM
    skill_nodes
WHERE
    skill_id = $1
ORDER BY
    sort_order,
    name,
    id;

-- name: GetSkillNode :one
SELECT
    id,
    skill_id,
    parent_id,
    name,
    node_type,
    mime_type,
    content,
    storage_kind,
    asset_id,
    revision_id,
    size_bytes,
    sha256,
    sort_order,
    created_at,
    updated_at
FROM
    skill_nodes
WHERE
    skill_id = $1
    AND id = $2;

-- name: CreateSkillNode :exec
INSERT INTO
    skill_nodes (
        id,
        skill_id,
        parent_id,
        name,
        node_type,
        mime_type,
        content,
        storage_kind,
        asset_id,
        revision_id,
        size_bytes,
        sha256,
        sort_order,
        created_at,
        updated_at
    )
VALUES
    (
        sqlc.arg (id),
        sqlc.arg (skill_id),
        sqlc.arg (parent_id),
        sqlc.arg (name),
        sqlc.arg (node_type),
        sqlc.arg (mime_type),
        sqlc.arg (content),
        sqlc.arg (storage_kind),
        sqlc.arg (asset_id),
        sqlc.arg (revision_id),
        sqlc.arg (size_bytes),
        sqlc.arg (sha256),
        sqlc.arg (sort_order)::bigint,
        sqlc.arg (created_at),
        sqlc.arg (updated_at)
    );

-- name: SaveSkillNode :exec
UPDATE skill_nodes
SET
    parent_id = sqlc.arg (parent_id),
    name = sqlc.arg (name),
    node_type = sqlc.arg (node_type),
    mime_type = sqlc.arg (mime_type),
    content = sqlc.arg (content),
    storage_kind = sqlc.arg (storage_kind),
    asset_id = sqlc.arg (asset_id),
    revision_id = sqlc.arg (revision_id),
    size_bytes = sqlc.arg (size_bytes),
    sha256 = sqlc.arg (sha256),
    sort_order = sqlc.arg (sort_order)::bigint,
    updated_at = sqlc.arg (updated_at)
WHERE
    skill_id = sqlc.arg (skill_id)
    AND id = sqlc.arg (id);

-- name: DeleteSkillNode :exec
DELETE FROM skill_nodes
WHERE
    skill_id = $1
    AND id = $2;

-- name: DeleteAllSkillNodes :exec
DELETE FROM skill_nodes
WHERE
    skill_id = $1;

-- name: SiblingNameExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            skill_nodes
        WHERE
            skill_id = $1
            AND parent_id IS NOT DISTINCT FROM sqlc.narg (parent_id)::varchar
            AND name = sqlc.arg (name)
            AND (
                sqlc.arg (excluding_id)::varchar = ''
                OR id <> sqlc.arg (excluding_id)::varchar
            )
    );

-- name: ListPublishedSkillNodes :many
SELECT
    skill_id,
    node_id,
    parent_node_id,
    name,
    node_type,
    mime_type,
    content,
    storage_kind,
    asset_id,
    revision_id,
    size_bytes,
    sha256,
    sort_order
FROM
    skill_published_nodes
WHERE
    skill_id = $1
ORDER BY
    sort_order,
    name,
    node_id;

-- name: ClearPublishedSkillNodes :exec
DELETE FROM skill_published_nodes
WHERE
    skill_id = $1;

-- name: CopyPublishedSkillNodes :exec
INSERT INTO
    skill_published_nodes (
        skill_id,
        node_id,
        parent_node_id,
        name,
        node_type,
        mime_type,
        content,
        storage_kind,
        asset_id,
        revision_id,
        size_bytes,
        sha256,
        sort_order
    )
SELECT
    skill_id,
    id,
    parent_id,
    name,
    node_type,
    mime_type,
    content,
    storage_kind,
    asset_id,
    revision_id,
    size_bytes,
    sha256,
    sort_order
FROM
    skill_nodes
WHERE
    skill_nodes.skill_id = $1;

-- name: UpsertAssetClaim :exec
INSERT INTO
    asset_claim_intents (
        tenant_id,
        workspace_id,
        owner_type,
        owner_id,
        slot,
        asset_id,
        revision_id,
        kind,
        generation,
        desired_state,
        next_attempt_at,
        state_version,
        created_at,
        updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, 1, $10, $10)
ON CONFLICT (tenant_id, workspace_id, owner_type, owner_id, slot) DO UPDATE
SET
    asset_id = EXCLUDED.asset_id,
    revision_id = EXCLUDED.revision_id,
    kind = EXCLUDED.kind,
    generation = CASE
        WHEN asset_claim_intents.asset_id IS DISTINCT FROM EXCLUDED.asset_id
          OR asset_claim_intents.revision_id IS DISTINCT FROM EXCLUDED.revision_id
          OR asset_claim_intents.kind IS DISTINCT FROM EXCLUDED.kind
          OR (asset_claim_intents.desired_state = 'released' AND EXCLUDED.desired_state = 'active')
        THEN asset_claim_intents.generation + 1
        ELSE asset_claim_intents.generation
    END,
    desired_state = EXCLUDED.desired_state,
    delivered_at = NULL,
    attempt_count = 0,
    next_attempt_at = EXCLUDED.next_attempt_at,
    lease_until = NULL,
    state_version = asset_claim_intents.state_version + 1,
    last_error = NULL,
    updated_at = EXCLUDED.updated_at
WHERE asset_claim_intents.asset_id IS DISTINCT FROM EXCLUDED.asset_id
   OR asset_claim_intents.revision_id IS DISTINCT FROM EXCLUDED.revision_id
   OR asset_claim_intents.kind IS DISTINCT FROM EXCLUDED.kind
   OR asset_claim_intents.desired_state IS DISTINCT FROM EXCLUDED.desired_state;

-- name: ClaimDueAssetClaims :many
WITH due AS (
    SELECT tenant_id, workspace_id, owner_type, owner_id, slot
    FROM asset_claim_intents
    WHERE delivered_at IS NULL
      AND next_attempt_at <= @now::pg_catalog.timestamptz
      AND (lease_until IS NULL OR lease_until <= @now)
    ORDER BY next_attempt_at, updated_at, tenant_id, workspace_id, owner_type, owner_id, slot
    LIMIT @page_size::bigint
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE asset_claim_intents i
    SET lease_until = @lease::pg_catalog.timestamptz,
        state_version = i.state_version + 1
    FROM due
    WHERE (i.tenant_id, i.workspace_id, i.owner_type, i.owner_id, i.slot) =
          (due.tenant_id, due.workspace_id, due.owner_type, due.owner_id, due.slot)
    RETURNING i.tenant_id, i.workspace_id, i.owner_type, i.owner_id, i.slot,
              i.asset_id, i.revision_id, i.kind, i.generation, i.desired_state,
              i.state_version, i.attempt_count
)
SELECT * FROM claimed
ORDER BY tenant_id, workspace_id, owner_type, owner_id, slot;

-- name: MarkAssetClaimDelivered :execrows
UPDATE asset_claim_intents
SET delivered_at = @now::pg_catalog.timestamptz,
    lease_until = NULL,
    state_version = state_version + 1,
    last_error = NULL,
    updated_at = @now
WHERE tenant_id = @tenant_id
  AND workspace_id = @workspace_id
  AND owner_type = @owner_type
  AND owner_id = @owner_id
  AND slot = @slot
  AND generation = @generation
  AND desired_state = @desired_state
  AND state_version = @state_version
  AND delivered_at IS NULL
  AND lease_until > @now;

-- name: RescheduleAssetClaim :execrows
UPDATE asset_claim_intents
SET next_attempt_at = @next_attempt_at,
    lease_until = NULL,
    state_version = state_version + 1,
    attempt_count = attempt_count + 1,
    last_error = @message,
    updated_at = @now
WHERE tenant_id = @tenant_id
  AND workspace_id = @workspace_id
  AND owner_type = @owner_type
  AND owner_id = @owner_id
  AND slot = @slot
  AND generation = @generation
  AND desired_state = @desired_state
  AND state_version = @state_version
  AND delivered_at IS NULL
  AND lease_until > @now;
