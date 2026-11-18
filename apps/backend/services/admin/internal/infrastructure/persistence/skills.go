package persistence

import (
	"context"
	"time"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SkillRepository struct {
	Pool *pgxpool.Pool
	DB   sqlc.DBTX
}

func (r SkillRepository) db() sqlc.DBTX {
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

func (r SkillRepository) ListSkills(ctx context.Context, workspaceID, tenantID string) ([]domain.Skill, error) {
	rows, err := sqlc.New(r.db()).ListSkills(ctx, sqlc.ListSkillsParams{WorkspaceID: workspaceID, TenantID: tenantID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Skill, len(rows))
	for i, row := range rows {
		out[i] = toSkill(sqlc.GetSkillRow(row))
	}
	return out, nil
}

func (r SkillRepository) ListSkillsByIDs(ctx context.Context, ids []string, workspaceID, tenantID string) ([]domain.Skill, error) {
	rows, err := sqlc.New(r.db()).ListSkillsByIDs(ctx, sqlc.ListSkillsByIDsParams{Ids: ids, WorkspaceID: workspaceID, TenantID: tenantID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Skill, len(rows))
	for i, row := range rows {
		out[i] = toSkill(sqlc.GetSkillRow(row))
	}
	return out, nil
}

func (r SkillRepository) GetSkill(ctx context.Context, id, workspaceID, tenantID string, lock bool) (domain.Skill, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetSkillForUpdate(ctx, sqlc.GetSkillForUpdateParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
		return toSkill(sqlc.GetSkillRow(row)), err
	}
	row, err := sqlc.New(r.db()).GetSkill(ctx, sqlc.GetSkillParams{ID: id, WorkspaceID: workspaceID, TenantID: tenantID})
	return toSkill(row), err
}

func (r SkillRepository) GetSkillByName(ctx context.Context, name, workspaceID, tenantID string) (domain.Skill, error) {
	row, err := sqlc.New(r.db()).GetSkillByName(ctx, sqlc.GetSkillByNameParams{Name: name, WorkspaceID: workspaceID, TenantID: tenantID})
	return toSkill(sqlc.GetSkillRow(row)), err
}

func (r SkillRepository) CreateSkill(ctx context.Context, value domain.Skill) (domain.Skill, error) {
	err := sqlc.New(r.db()).CreateSkill(ctx, sqlc.CreateSkillParams{
		ID:              value.ID,
		UserID:          value.UserID,
		WorkspaceID:     value.WorkspaceID,
		TenantID:        value.TenantID,
		Username:        value.Username,
		Name:            value.Name,
		Description:     value.Description,
		Status:          value.Status,
		IsEnabled:       value.IsEnabled,
		WorkspaceSeq:    int64(value.WorkspaceSeq),
		WorkspaceSha256: value.WorkspaceSHA256,
		CreatedAt:       value.CreatedAt,
		UpdatedAt:       value.UpdatedAt,
	})
	return value, err
}

func (r SkillRepository) SaveSkill(ctx context.Context, value domain.Skill) (domain.Skill, error) {
	err := sqlc.New(r.db()).SaveSkill(ctx, sqlc.SaveSkillParams{
		ID:                      value.ID,
		Name:                    value.Name,
		Description:             value.Description,
		Status:                  value.Status,
		IsEnabled:               value.IsEnabled,
		WorkspaceSeq:            int64(value.WorkspaceSeq),
		WorkspaceSha256:         value.WorkspaceSHA256,
		PublishedSha256:         value.PublishedSHA256,
		PublishedAt:             value.PublishedAt,
		PublishedName:           value.PublishedName,
		PublishedDescription:    value.PublishedDescription,
		SourceArchiveAssetID:    value.SourceArchiveAssetID,
		SourceArchiveRevisionID: value.SourceArchiveRevisionID,
		UpdatedAt:               value.UpdatedAt,
	})
	return value, err
}

func (r SkillRepository) DeleteSkill(ctx context.Context, id string) error {
	return sqlc.New(r.db()).DeleteSkill(ctx, id)
}

func (r SkillRepository) BulkDeleteSkills(ctx context.Context, ids []string, workspaceID, tenantID string) (int64, error) {
	result, err := sqlc.New(r.db()).BulkDeleteSkills(ctx, sqlc.BulkDeleteSkillsParams{Ids: ids, WorkspaceID: workspaceID, TenantID: tenantID})
	return result, err
}

func (r SkillRepository) ListSkillNodes(ctx context.Context, skillID string) ([]domain.SkillNode, error) {
	rows, err := sqlc.New(r.db()).ListSkillNodes(ctx, skillID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.SkillNode, len(rows))
	for i, row := range rows {
		out[i] = toSkillNode(sqlc.GetSkillNodeRow(row))
	}
	return out, nil
}

func (r SkillRepository) GetSkillNode(ctx context.Context, skillID, nodeID string) (domain.SkillNode, error) {
	row, err := sqlc.New(r.db()).GetSkillNode(ctx, sqlc.GetSkillNodeParams{SkillID: skillID, ID: nodeID})
	return toSkillNode(row), err
}

func (r SkillRepository) CreateSkillNode(ctx context.Context, value domain.SkillNode) error {
	return sqlc.New(r.db()).CreateSkillNode(ctx, sqlc.CreateSkillNodeParams{
		ID:          value.ID,
		SkillID:     value.SkillID,
		ParentID:    value.ParentID,
		Name:        value.Name,
		NodeType:    value.NodeType,
		MimeType:    value.MimeType,
		Content:     value.Content,
		StorageKind: value.StorageKind,
		AssetID:     value.AssetID,
		RevisionID:  value.RevisionID,
		SizeBytes:   value.SizeBytes,
		Sha256:      value.SHA256,
		SortOrder:   int64(value.SortOrder),
		CreatedAt:   value.CreatedAt,
		UpdatedAt:   value.UpdatedAt,
	})
}

func (r SkillRepository) SaveSkillNode(ctx context.Context, value domain.SkillNode) error {
	return sqlc.New(r.db()).SaveSkillNode(ctx, sqlc.SaveSkillNodeParams{
		SkillID:     value.SkillID,
		ID:          value.ID,
		ParentID:    value.ParentID,
		Name:        value.Name,
		NodeType:    value.NodeType,
		MimeType:    value.MimeType,
		Content:     value.Content,
		StorageKind: value.StorageKind,
		AssetID:     value.AssetID,
		RevisionID:  value.RevisionID,
		SizeBytes:   value.SizeBytes,
		Sha256:      value.SHA256,
		SortOrder:   int64(value.SortOrder),
		UpdatedAt:   value.UpdatedAt,
	})
}

func (r SkillRepository) DeleteSkillNode(ctx context.Context, skillID, nodeID string) error {
	return sqlc.New(r.db()).DeleteSkillNode(ctx, sqlc.DeleteSkillNodeParams{SkillID: skillID, ID: nodeID})
}

func (r SkillRepository) DeleteAllSkillNodes(ctx context.Context, skillID string) error {
	return sqlc.New(r.db()).DeleteAllSkillNodes(ctx, skillID)
}

func (r SkillRepository) SiblingNameExists(ctx context.Context, skillID string, parentID *string, name, excludingID string) (bool, error) {
	return sqlc.New(r.db()).SiblingNameExists(ctx, sqlc.SiblingNameExistsParams{SkillID: skillID, ParentID: parentID, Name: name, ExcludingID: excludingID})
}

func (r SkillRepository) ListPublishedSkillNodes(ctx context.Context, skillID string) ([]domain.PublishedSkillNode, error) {
	rows, err := sqlc.New(r.db()).ListPublishedSkillNodes(ctx, skillID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.PublishedSkillNode, len(rows))
	for i, row := range rows {
		out[i] = toPublishedSkillNode(row)
	}
	return out, nil
}

func (r SkillRepository) ReplacePublishedSkillNodes(ctx context.Context, skillID string) error {
	if err := sqlc.New(r.db()).ClearPublishedSkillNodes(ctx, skillID); err != nil {
		return err
	}
	return sqlc.New(r.db()).CopyPublishedSkillNodes(ctx, skillID)
}

func (r SkillRepository) UpsertAssetClaim(ctx context.Context, claim application.AssetClaim) error {
	now := time.Now().UTC()
	return sqlc.New(r.db()).UpsertAssetClaim(ctx, sqlc.UpsertAssetClaimParams{
		TenantID:      claim.TenantID,
		WorkspaceID:   claim.WorkspaceID,
		OwnerType:     claim.OwnerType,
		OwnerID:       claim.OwnerID,
		Slot:          claim.Slot,
		AssetID:       claim.AssetID,
		RevisionID:    claim.RevisionID,
		Kind:          claim.Kind,
		DesiredState:  claim.DesiredState,
		NextAttemptAt: now,
	})
}

func toPublishedSkillNode(row sqlc.ListPublishedSkillNodesRow) domain.PublishedSkillNode {
	value := domain.PublishedSkillNode{
		SkillID:      row.SkillID,
		NodeID:       row.NodeID,
		ParentNodeID: row.ParentNodeID,
		Name:         row.Name,
		NodeType:     row.NodeType,
		MimeType:     row.MimeType,
		Content:      row.Content,
		StorageKind:  row.StorageKind,
		AssetID:      row.AssetID,
		RevisionID:   row.RevisionID,
		SizeBytes:    row.SizeBytes,
		SHA256:       row.Sha256,
		SortOrder:    int(row.SortOrder),
	}
	return value
}

func toSkill(row sqlc.GetSkillRow) domain.Skill {
	value := domain.Skill{
		ID:                      row.ID,
		UserID:                  row.UserID,
		WorkspaceID:             row.WorkspaceID,
		TenantID:                row.TenantID,
		Username:                row.Username,
		Name:                    row.Name,
		Description:             row.Description,
		Status:                  row.Status,
		IsEnabled:               row.IsEnabled,
		WorkspaceSeq:            int(row.WorkspaceSeq),
		WorkspaceSHA256:         row.WorkspaceSha256,
		PublishedSHA256:         row.PublishedSha256,
		PublishedAt:             row.PublishedAt,
		PublishedName:           row.PublishedName,
		PublishedDescription:    row.PublishedDescription,
		SourceArchiveAssetID:    row.SourceArchiveAssetID,
		SourceArchiveRevisionID: row.SourceArchiveRevisionID,
		CreatedAt:               row.CreatedAt,
		UpdatedAt:               row.UpdatedAt,
	}
	return value
}

func toSkillNode(row sqlc.GetSkillNodeRow) domain.SkillNode {
	value := domain.SkillNode{
		ID:          row.ID,
		SkillID:     row.SkillID,
		ParentID:    row.ParentID,
		Name:        row.Name,
		NodeType:    row.NodeType,
		MimeType:    row.MimeType,
		Content:     row.Content,
		StorageKind: row.StorageKind,
		AssetID:     row.AssetID,
		RevisionID:  row.RevisionID,
		SizeBytes:   row.SizeBytes,
		SHA256:      row.Sha256,
		SortOrder:   int(row.SortOrder),
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
	return value
}
