-- name: EnsureRole :exec
INSERT INTO roles (
    id, name, description, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    updated_at = EXCLUDED.updated_at;

-- name: RoleByName :one
SELECT * FROM roles WHERE name=$1;

-- name: RoleByID :one
SELECT * FROM roles WHERE id=$1;

-- name: LockRole :one
SELECT * FROM roles WHERE id=$1 FOR UPDATE;

-- name: ListRoles :many
SELECT * FROM roles ORDER BY name;

-- name: UserRoles :many
SELECT r.* FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=$1 ORDER BY r.name;

-- name: AssignRole :exec
INSERT INTO user_roles (user_id,role_id,created_at) VALUES ($1,$2,now()) ON CONFLICT DO NOTHING;

-- name: RemoveRole :execrows
DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2;

-- name: CountUsersWithRole :one
SELECT count(*) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name=$1;

-- name: CountEnabledWithRole :one
SELECT count(*) FROM user_roles ur JOIN users u ON u.id=ur.user_id WHERE ur.role_id=$1 AND u.disabled_at IS NULL;
