-- name: ListBots :many
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    status,
    role_description,
    domain_description,
    audience,
    tone,
    welcome_message,
    suggested_questions,
    text_provider_id,
    image_provider_id,
    video_provider_id,
    created_at,
    updated_at
FROM
    bots
WHERE
    workspace_id = $1
    AND tenant_id = $2
ORDER BY
    created_at;

-- name: GetBot :one
SELECT
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    status,
    role_description,
    domain_description,
    audience,
    tone,
    welcome_message,
    suggested_questions,
    text_provider_id,
    image_provider_id,
    video_provider_id,
    created_at,
    updated_at
FROM
    bots
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3;

-- name: CreateBot :one
INSERT INTO
    bots (
        id,
        user_id,
        workspace_id,
        tenant_id,
        name,
        status,
        tone,
        suggested_questions,
        created_at,
        updated_at
    )
VALUES
    ($1, $2, $3, $4, $5, 'draft', 'professional', '[]', $6, $6)
RETURNING
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    status,
    role_description,
    domain_description,
    audience,
    tone,
    welcome_message,
    suggested_questions,
    text_provider_id,
    image_provider_id,
    video_provider_id,
    created_at,
    updated_at;

-- name: SaveBot :one
UPDATE bots
SET
    name = $2,
    status = $3,
    role_description = $4,
    domain_description = $5,
    audience = $6,
    tone = $7,
    welcome_message = $8,
    suggested_questions = $9,
    text_provider_id = $10,
    image_provider_id = $11,
    video_provider_id = $12,
    updated_at = now()
WHERE
    id = $1
    AND workspace_id = $13
    AND tenant_id = $14
RETURNING
    id,
    user_id,
    workspace_id,
    tenant_id,
    name,
    status,
    role_description,
    domain_description,
    audience,
    tone,
    welcome_message,
    suggested_questions,
    text_provider_id,
    image_provider_id,
    video_provider_id,
    created_at,
    updated_at;

-- name: DeleteBot :execrows
DELETE FROM bots
WHERE
    id = $1
    AND workspace_id = $2
    AND tenant_id = $3;

-- name: ListBotSkills :many
SELECT
    s.id,
    s.user_id,
    s.workspace_id,
    s.tenant_id,
    s.username,
    s.name,
    s.description,
    s.status,
    s.is_enabled,
    (s.workspace_sha256 IS DISTINCT FROM s.published_sha256)::boolean AS has_unpublished_changes,
    s.published_at,
    s.created_at,
    s.updated_at
FROM
    skills s
    JOIN bot_skills b ON b.skill_id = s.id
WHERE
    b.bot_id = $1
    AND (
        NOT sqlc.arg (active_only)::bool
        OR (
            s.status = 'published'
            AND s.is_enabled
        )
    )
ORDER BY
    b.sort,
    s.updated_at DESC;

-- name: SkillExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            skills
        WHERE
            id = $1
            AND workspace_id = $2
            AND tenant_id = $3
    );

-- name: AttachBotSkill :exec
INSERT INTO
    bot_skills (bot_id, skill_id, sort)
VALUES
    ($1, $2, 0)
ON CONFLICT DO NOTHING;

-- name: DetachBotSkill :exec
DELETE FROM bot_skills
WHERE
    bot_id = $1
    AND skill_id = $2;
