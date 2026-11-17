package persistence

import (
	"context"
	"time"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type skillDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type SkillRepository struct {
	Pool *pgxpool.Pool
	DB   skillDB
}

func (r SkillRepository) db() skillDB {
	if r.DB != nil {
		return r.DB
	}
	return r.Pool
}

func (r SkillRepository) Transaction(ctx context.Context, fn func(application.SkillRepository) error) error {
	if tx, ok := r.DB.(pgx.Tx); ok {
		return fn(SkillRepository{Pool: r.Pool, DB: tx})
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(SkillRepository{Pool: r.Pool, DB: tx}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

const skillColumns = `id,user_id,workspace_id,tenant_id,username,name,description,status,is_enabled,workspace_seq,workspace_sha256,published_sha256,published_at,published_name,published_description,source_archive_asset_id::text,source_archive_revision_id::text,created_at,updated_at`

func scanSkill(row pgx.Row) (domain.Skill, error) {
	var value domain.Skill
	err := row.Scan(&value.ID, &value.UserID, &value.WorkspaceID, &value.TenantID, &value.Username, &value.Name, &value.Description, &value.Status, &value.IsEnabled, &value.WorkspaceSeq, &value.WorkspaceSHA256, &value.PublishedSHA256, &value.PublishedAt, &value.PublishedName, &value.PublishedDescription, &value.SourceArchiveAssetID, &value.SourceArchiveRevisionID, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

func scanSkills(rows pgx.Rows) ([]domain.Skill, error) {
	defer rows.Close()
	values := []domain.Skill{}
	for rows.Next() {
		value, err := scanSkill(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (r SkillRepository) ListSkills(ctx context.Context, workspaceID, tenantID string) ([]domain.Skill, error) {
	rows, err := r.db().Query(ctx, `SELECT `+skillColumns+` FROM skills WHERE workspace_id=$1 AND tenant_id=$2 ORDER BY updated_at DESC`, workspaceID, tenantID)
	if err != nil {
		return nil, err
	}
	return scanSkills(rows)
}

func (r SkillRepository) ListSkillsByIDs(ctx context.Context, ids []string, workspaceID, tenantID string) ([]domain.Skill, error) {
	rows, err := r.db().Query(ctx, `SELECT `+skillColumns+` FROM skills WHERE id=ANY($1) AND workspace_id=$2 AND tenant_id=$3 FOR UPDATE`, ids, workspaceID, tenantID)
	if err != nil {
		return nil, err
	}
	return scanSkills(rows)
}

func (r SkillRepository) GetSkill(ctx context.Context, id, workspaceID, tenantID string, lock bool) (domain.Skill, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanSkill(r.db().QueryRow(ctx, `SELECT `+skillColumns+` FROM skills WHERE id=$1 AND workspace_id=$2 AND tenant_id=$3`+suffix, id, workspaceID, tenantID))
}

func (r SkillRepository) GetSkillByName(ctx context.Context, name, workspaceID, tenantID string) (domain.Skill, error) {
	return scanSkill(r.db().QueryRow(ctx, `SELECT `+skillColumns+` FROM skills WHERE name=$1 AND workspace_id=$2 AND tenant_id=$3`, name, workspaceID, tenantID))
}

func (r SkillRepository) CreateSkill(ctx context.Context, value domain.Skill) (domain.Skill, error) {
	_, err := r.db().Exec(ctx, `INSERT INTO skills(id,user_id,workspace_id,tenant_id,username,name,description,status,is_enabled,workspace_seq,workspace_sha256,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, value.ID, value.UserID, value.WorkspaceID, value.TenantID, value.Username, value.Name, value.Description, value.Status, value.IsEnabled, value.WorkspaceSeq, value.WorkspaceSHA256, value.CreatedAt, value.UpdatedAt)
	return value, err
}

func (r SkillRepository) SaveSkill(ctx context.Context, value domain.Skill) (domain.Skill, error) {
	_, err := r.db().Exec(ctx, `UPDATE skills SET name=$2,description=$3,status=$4,is_enabled=$5,workspace_seq=$6,workspace_sha256=$7,published_sha256=$8,published_at=$9,published_name=$10,published_description=$11,source_archive_asset_id=$12,source_archive_revision_id=$13,updated_at=$14 WHERE id=$1`, value.ID, value.Name, value.Description, value.Status, value.IsEnabled, value.WorkspaceSeq, value.WorkspaceSHA256, value.PublishedSHA256, value.PublishedAt, value.PublishedName, value.PublishedDescription, value.SourceArchiveAssetID, value.SourceArchiveRevisionID, value.UpdatedAt)
	return value, err
}

func (r SkillRepository) DeleteSkill(ctx context.Context, id string) error {
	_, err := r.db().Exec(ctx, `DELETE FROM skills WHERE id=$1`, id)
	return err
}

func (r SkillRepository) BulkDeleteSkills(ctx context.Context, ids []string, workspaceID, tenantID string) (int64, error) {
	result, err := r.db().Exec(ctx, `DELETE FROM skills WHERE id=ANY($1) AND workspace_id=$2 AND tenant_id=$3`, ids, workspaceID, tenantID)
	return result.RowsAffected(), err
}

const skillNodeColumns = `id,skill_id,parent_id,name,node_type,mime_type,content,storage_kind,asset_id::text,revision_id::text,size_bytes,sha256,sort_order,created_at,updated_at`

func scanSkillNode(row pgx.Row) (domain.SkillNode, error) {
	var value domain.SkillNode
	err := row.Scan(&value.ID, &value.SkillID, &value.ParentID, &value.Name, &value.NodeType, &value.MimeType, &value.Content, &value.StorageKind, &value.AssetID, &value.RevisionID, &value.SizeBytes, &value.SHA256, &value.SortOrder, &value.CreatedAt, &value.UpdatedAt)
	return value, err
}

func (r SkillRepository) ListSkillNodes(ctx context.Context, skillID string) ([]domain.SkillNode, error) {
	rows, err := r.db().Query(ctx, `SELECT `+skillNodeColumns+` FROM skill_nodes WHERE skill_id=$1 ORDER BY sort_order,name,id`, skillID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []domain.SkillNode{}
	for rows.Next() {
		value, err := scanSkillNode(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (r SkillRepository) GetSkillNode(ctx context.Context, skillID, nodeID string) (domain.SkillNode, error) {
	return scanSkillNode(r.db().QueryRow(ctx, `SELECT `+skillNodeColumns+` FROM skill_nodes WHERE skill_id=$1 AND id=$2`, skillID, nodeID))
}

func (r SkillRepository) CreateSkillNode(ctx context.Context, value domain.SkillNode) error {
	_, err := r.db().Exec(ctx, `INSERT INTO skill_nodes(id,skill_id,parent_id,name,node_type,mime_type,content,storage_kind,asset_id,revision_id,size_bytes,sha256,sort_order,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, value.ID, value.SkillID, value.ParentID, value.Name, value.NodeType, value.MimeType, value.Content, value.StorageKind, value.AssetID, value.RevisionID, value.SizeBytes, value.SHA256, value.SortOrder, value.CreatedAt, value.UpdatedAt)
	return err
}

func (r SkillRepository) SaveSkillNode(ctx context.Context, value domain.SkillNode) error {
	_, err := r.db().Exec(ctx, `UPDATE skill_nodes SET parent_id=$3,name=$4,node_type=$5,mime_type=$6,content=$7,storage_kind=$8,asset_id=$9,revision_id=$10,size_bytes=$11,sha256=$12,sort_order=$13,updated_at=$14 WHERE skill_id=$1 AND id=$2`, value.SkillID, value.ID, value.ParentID, value.Name, value.NodeType, value.MimeType, value.Content, value.StorageKind, value.AssetID, value.RevisionID, value.SizeBytes, value.SHA256, value.SortOrder, value.UpdatedAt)
	return err
}

func (r SkillRepository) DeleteSkillNode(ctx context.Context, skillID, nodeID string) error {
	_, err := r.db().Exec(ctx, `DELETE FROM skill_nodes WHERE skill_id=$1 AND id=$2`, skillID, nodeID)
	return err
}

func (r SkillRepository) DeleteAllSkillNodes(ctx context.Context, skillID string) error {
	_, err := r.db().Exec(ctx, `DELETE FROM skill_nodes WHERE skill_id=$1`, skillID)
	return err
}

func (r SkillRepository) SiblingNameExists(ctx context.Context, skillID string, parentID *string, name, excludingID string) (bool, error) {
	var exists bool
	err := r.db().QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM skill_nodes WHERE skill_id=$1 AND parent_id IS NOT DISTINCT FROM $2 AND name=$3 AND ($4='' OR id<>$4))`, skillID, parentID, name, excludingID).Scan(&exists)
	return exists, err
}

func (r SkillRepository) ListPublishedSkillNodes(ctx context.Context, skillID string) ([]domain.PublishedSkillNode, error) {
	rows, err := r.db().Query(ctx, `SELECT skill_id,node_id,parent_node_id,name,node_type,mime_type,content,storage_kind,asset_id::text,revision_id::text,size_bytes,sha256,sort_order FROM skill_published_nodes WHERE skill_id=$1 ORDER BY sort_order,name,node_id`, skillID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []domain.PublishedSkillNode{}
	for rows.Next() {
		var value domain.PublishedSkillNode
		if err := rows.Scan(&value.SkillID, &value.NodeID, &value.ParentNodeID, &value.Name, &value.NodeType, &value.MimeType, &value.Content, &value.StorageKind, &value.AssetID, &value.RevisionID, &value.SizeBytes, &value.SHA256, &value.SortOrder); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (r SkillRepository) ReplacePublishedSkillNodes(ctx context.Context, skillID string) error {
	if _, err := r.db().Exec(ctx, `DELETE FROM skill_published_nodes WHERE skill_id=$1`, skillID); err != nil {
		return err
	}
	_, err := r.db().Exec(ctx, `INSERT INTO skill_published_nodes(skill_id,node_id,parent_node_id,name,node_type,mime_type,content,storage_kind,asset_id,revision_id,size_bytes,sha256,sort_order) SELECT skill_id,id,parent_id,name,node_type,mime_type,content,storage_kind,asset_id,revision_id,size_bytes,sha256,sort_order FROM skill_nodes WHERE skill_id=$1`, skillID)
	return err
}

func (r SkillRepository) UpsertAssetClaim(ctx context.Context, claim application.AssetClaim) error {
	now := time.Now().UTC()
	_, err := r.db().Exec(ctx, `INSERT INTO asset_claim_intents(tenant_id,workspace_id,owner_type,owner_id,slot,asset_id,revision_id,kind,generation,desired_state,next_attempt_at,state_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,1,$10,$10) ON CONFLICT(tenant_id,workspace_id,owner_type,owner_id,slot) DO UPDATE SET asset_id=EXCLUDED.asset_id,revision_id=EXCLUDED.revision_id,kind=EXCLUDED.kind,generation=asset_claim_intents.generation+1,desired_state=EXCLUDED.desired_state,delivered_at=NULL,attempt_count=0,next_attempt_at=EXCLUDED.next_attempt_at,lease_until=NULL,state_version=asset_claim_intents.state_version+1,last_error=NULL,updated_at=EXCLUDED.updated_at`, claim.TenantID, claim.WorkspaceID, claim.OwnerType, claim.OwnerID, claim.Slot, claim.AssetID, claim.RevisionID, claim.Kind, claim.DesiredState, now)
	return err
}
