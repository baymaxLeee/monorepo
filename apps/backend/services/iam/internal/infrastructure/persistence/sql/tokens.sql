-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (
    id, user_id, token_hash, user_agent, ip_address, expires_at, revoked_at, created_at, last_used_at, replaced_by_token_id, active_workspace_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
);

-- name: LockToken :one
SELECT * FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE;

-- name: ReplaceToken :exec
UPDATE refresh_tokens SET replaced_by_token_id=$2,last_used_at=now(),revoked_at=now() WHERE id=$1;

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL;

-- name: RevokeUserRefreshTokens :exec
UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL;
