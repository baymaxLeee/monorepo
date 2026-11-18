-- name: CreateMember :exec
INSERT INTO workspace_members (workspace_id,user_id,role,status,created_at) VALUES ($1,$2,$3,$4,now());

-- name: EnsureWorkspaceMember :exec
INSERT INTO workspace_members (workspace_id,user_id,role,status,created_at) VALUES ($1,$2,$3,$4,now())
ON CONFLICT (workspace_id,user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = EXCLUDED.status;

-- name: AddGuestIfMissing :exec
INSERT INTO workspace_members (workspace_id,user_id,role,status,created_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING;

-- name: EnsureAllUsersInGuestWorkspace :exec
INSERT INTO workspace_members (workspace_id,user_id,role,status,created_at)
SELECT sqlc.arg(workspace_id)::varchar,u.id,'member','active',now() FROM users u
ON CONFLICT (workspace_id,user_id) DO NOTHING;

-- name: ListUserMemberships :many
SELECT w.tenant_id,m.workspace_id,w.name AS workspace_name,m.role,m.status
FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
WHERE m.user_id=$1 ORDER BY m.created_at;

-- name: ActiveMembership :one
SELECT w.tenant_id,m.workspace_id,w.name AS workspace_name,m.role,m.status
FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
WHERE m.user_id=$1 AND m.workspace_id=$2 AND m.status='active';

-- name: ListWorkspaceMembers :many
SELECT m.user_id,u.account,u.display_name,u.email,m.role,m.status,m.reviewed_by,m.rejection_reason,m.reviewed_at,m.created_at
FROM workspace_members m JOIN users u ON u.id=m.user_id
WHERE m.workspace_id=$1 AND (sqlc.arg(status_filter)::text='' OR m.status=sqlc.arg(status_filter)) ORDER BY m.created_at DESC;

-- name: MemberRoleStatus :one
SELECT role,status FROM workspace_members WHERE workspace_id=$1 AND user_id=$2;

-- name: LockMember :one
SELECT role,status FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE;

-- name: ApplyMembership :execrows
INSERT INTO workspace_members (workspace_id,user_id,role,status,created_at)
VALUES ($1,$2,'member','pending',now())
ON CONFLICT (workspace_id,user_id) DO UPDATE SET status='pending',reviewed_at=NULL,reviewed_by=NULL,rejection_reason=NULL
WHERE workspace_members.status='rejected';

-- name: ApproveMembership :execrows
UPDATE workspace_members SET status='active',reviewed_by=$3,reviewed_at=now(),rejection_reason=NULL WHERE workspace_id=$1 AND user_id=$2 AND status='pending';

-- name: RejectMembership :execrows
UPDATE workspace_members SET status='rejected',reviewed_by=$3,reviewed_at=now(),rejection_reason=COALESCE(NULLIF(sqlc.arg(reason)::text,''),rejection_reason) WHERE workspace_id=$1 AND user_id=$2 AND status='pending';

-- name: CountActiveAdmins :one
SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND role='workspace_admin' AND status='active';

-- name: SetActiveRole :exec
UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2 AND status='active';
