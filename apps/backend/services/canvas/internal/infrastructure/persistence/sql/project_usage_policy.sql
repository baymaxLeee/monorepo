-- name: CreateProjectUsagePolicy :exec
INSERT INTO project_usage_policies(project_id, tenant_id, workspace_id, usage_limit_micros, currency)
VALUES ($1, $2, $3, $4, 'CNY') ON CONFLICT DO NOTHING;

-- name: FindProjectUsagePolicy :one
SELECT project_id, usage_limit_micros, used_amount_micros
FROM project_usage_policies WHERE project_id=$1 AND tenant_id=$2 AND workspace_id=$3;

-- name: UpdateProjectUsageLimit :execrows
UPDATE project_usage_policies SET usage_limit_micros=$4
WHERE project_id=$1 AND tenant_id=$2 AND workspace_id=$3;

-- name: DeleteProjectUsagePolicy :exec
DELETE FROM project_usage_policies WHERE project_id=$1 AND tenant_id=$2 AND workspace_id=$3;
