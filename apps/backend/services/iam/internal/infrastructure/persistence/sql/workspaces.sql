-- name: CreateTenant :exec
INSERT INTO tenants (
    id, name, slug, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5
);

-- name: EnsureTenant :exec
INSERT INTO tenants (
    id, name, slug, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    updated_at = EXCLUDED.updated_at;

-- name: TenantByID :one
SELECT * FROM tenants WHERE id=$1;

-- name: ListTenants :many
SELECT * FROM tenants ORDER BY name;

-- name: CreateWorkspace :exec
INSERT INTO workspaces (
    id, name, slug, owner_user_id, created_at, updated_at, system_managed, system_key, join_policy, tenant_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
);

-- name: EnsureWorkspace :exec
INSERT INTO workspaces (
    id, name, slug, owner_user_id, created_at, updated_at, system_managed, system_key, join_policy, tenant_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    owner_user_id = EXCLUDED.owner_user_id,
    system_managed = EXCLUDED.system_managed,
    system_key = EXCLUDED.system_key,
    join_policy = EXCLUDED.join_policy,
    updated_at = EXCLUDED.updated_at;

-- name: LockWorkspace :one
SELECT * FROM workspaces WHERE id=$1 FOR UPDATE;

-- name: WorkspaceByID :one
SELECT * FROM workspaces WHERE id=$1;

-- name: ListWorkspaces :many
SELECT * FROM workspaces WHERE NOT system_managed AND join_policy='approval' ORDER BY name;

-- name: ListWorkspacesForAdmin :many
SELECT w.tenant_id,w.id,w.name,w.slug,w.owner_user_id,w.join_policy,w.system_managed,
       (SELECT count(*) FROM workspace_members m WHERE m.workspace_id=w.id AND m.status='active') AS member_count,w.created_at
FROM workspaces w ORDER BY w.created_at DESC;

-- name: SetOwner :exec
UPDATE workspaces SET owner_user_id=$2,updated_at=now() WHERE id=$1;
