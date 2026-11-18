-- name: CreateUser :exec
INSERT INTO users (
    id, account, email, email_normalized, display_name, avatar_url, phone, locale, timezone, theme, marketing_opt_in, email_verified_at, disabled_at, last_login_at, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
);

-- name: UpsertUser :exec
INSERT INTO users (
    id, account, email, email_normalized, display_name, avatar_url, phone, locale, timezone, theme, marketing_opt_in, email_verified_at, disabled_at, last_login_at, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
)
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    email_normalized = EXCLUDED.email_normalized,
    display_name = EXCLUDED.display_name,
    updated_at = EXCLUDED.updated_at;

-- name: AdoptSeedAccount :exec
UPDATE users SET id=$1, email=$2, display_name=$3, updated_at=now() WHERE email_normalized=$4;

-- name: CreateCredential :exec
INSERT INTO user_credentials (user_id,password_hash,password_changed_at,created_at,updated_at) VALUES ($1,$2,now(),now(),now());

-- name: LockPassword :one
SELECT password_hash FROM user_credentials WHERE user_id=$1 FOR UPDATE;

-- name: ChangePassword :exec
UPDATE user_credentials SET password_hash=$2,password_changed_at=now(),failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1;

-- name: UserByAccount :one
SELECT sqlc.embed(u), c.password_hash FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.account=$1 AND u.disabled_at IS NULL;

-- name: UserExistsByAccount :one
SELECT EXISTS(SELECT 1 FROM users WHERE account=$1 AND disabled_at IS NULL);

-- name: UserByID :one
SELECT * FROM users WHERE id=$1 AND disabled_at IS NULL;

-- name: MarkLogin :exec
UPDATE users SET last_login_at=now(), updated_at=now() WHERE id=$1;

-- name: RecordAudit :exec
INSERT INTO iam_audit_events (
    id, action, actor_user_id, target_user_id, workspace_id, before_json, after_json, result, reason, trace_id, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
);
