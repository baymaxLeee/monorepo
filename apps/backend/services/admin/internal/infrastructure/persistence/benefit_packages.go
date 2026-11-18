package persistence

import (
	"context"
	"encoding/json"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/example/monorepo/admin/internal/infrastructure/persistence/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BenefitPackageRepository struct {
	Pool *pgxpool.Pool
	DB   sqlc.DBTX
}

func (r BenefitPackageRepository) db() sqlc.DBTX {
	if r.DB != nil {
		return r.DB
	}
	return r.Pool
}

func (r BenefitPackageRepository) Transaction(ctx context.Context, fn func(application.BenefitPackageRepository) error) error {
	if tx, ok := r.DB.(pgx.Tx); ok {
		return fn(BenefitPackageRepository{Pool: r.Pool, DB: tx})
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(BenefitPackageRepository{Pool: r.Pool, DB: tx}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r BenefitPackageRepository) ListBenefitPackages(ctx context.Context, tenantID, workspaceID string) ([]domain.BenefitPackage, error) {
	rows, err := sqlc.New(r.db()).ListBenefitPackages(ctx, sqlc.ListBenefitPackagesParams{TenantID: tenantID, WorkspaceID: workspaceID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.BenefitPackage, len(rows))
	for i, row := range rows {
		out[i] = toBenefitPackage(row)
	}
	return out, nil
}

func (r BenefitPackageRepository) GetBenefitPackage(ctx context.Context, id, tenantID, workspaceID string, lock bool) (domain.BenefitPackage, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetBenefitPackageForUpdate(ctx, sqlc.GetBenefitPackageForUpdateParams{ID: id, TenantID: tenantID, WorkspaceID: workspaceID})
		return toBenefitPackage(row), err
	}
	row, err := sqlc.New(r.db()).GetBenefitPackage(ctx, sqlc.GetBenefitPackageParams{ID: id, TenantID: tenantID, WorkspaceID: workspaceID})
	return toBenefitPackage(row), err
}

func (r BenefitPackageRepository) CreateBenefitPackage(ctx context.Context, v domain.BenefitPackage) error {
	models, _ := json.Marshal(v.ModelIDs)
	return sqlc.New(r.db()).CreateBenefitPackage(ctx, sqlc.CreateBenefitPackageParams{
		ID:                 v.ID,
		TenantID:           v.TenantID,
		WorkspaceID:        v.WorkspaceID,
		IsPreset:           v.IsPreset,
		Name:               v.Name,
		ProjectName:        v.ProjectName,
		AssetGroupID:       v.AssetGroupID,
		AccessKeyIDEnc:     v.AccessKeyIDEncrypted,
		SecretAccessKeyEnc: v.SecretKeyEncrypted,
		Enabled:            v.Enabled,
		ModelIdsJson:       string(models),
		MaterialUsed:       v.MaterialUsed,
		MaterialLimit:      v.MaterialLimit,
		Revision:           v.Revision,
		CreatedBy:          v.CreatedBy,
		UpdatedBy:          v.UpdatedBy,
		CreatedAt:          v.CreatedAt,
		UpdatedAt:          v.UpdatedAt,
	})
}
func (r BenefitPackageRepository) SaveBenefitPackage(ctx context.Context, v domain.BenefitPackage) error {
	models, _ := json.Marshal(v.ModelIDs)
	return sqlc.New(r.db()).SaveBenefitPackage(ctx, sqlc.SaveBenefitPackageParams{
		ID:                 v.ID,
		Name:               v.Name,
		ProjectName:        v.ProjectName,
		AssetGroupID:       v.AssetGroupID,
		AccessKeyIDEnc:     v.AccessKeyIDEncrypted,
		SecretAccessKeyEnc: v.SecretKeyEncrypted,
		Enabled:            v.Enabled,
		ModelIdsJson:       string(models),
		MaterialUsed:       v.MaterialUsed,
		MaterialLimit:      v.MaterialLimit,
		Revision:           v.Revision,
		UpdatedBy:          v.UpdatedBy,
		UpdatedAt:          v.UpdatedAt,
		DeletedAt:          v.DeletedAt,
	})
}
func (r BenefitPackageRepository) ReplaceBenefitPackageModels(ctx context.Context, v domain.BenefitPackage, ids []string) error {
	if err := sqlc.New(r.db()).ClearBenefitPackageModels(ctx, v.ID); err != nil {
		return err
	}
	for _, id := range ids {
		if err := sqlc.New(r.db()).AddBenefitPackageModel(ctx, sqlc.AddBenefitPackageModelParams{PackageID: v.ID, TenantID: v.TenantID, WorkspaceID: v.WorkspaceID, ModelID: id}); err != nil {
			return err
		}
	}
	return nil
}
func (r BenefitPackageRepository) ReviewUsage(ctx context.Context, tenantID, workspaceID string) (map[string][2]int64, error) {
	rows, err := sqlc.New(r.db()).ReviewUsage(ctx, sqlc.ReviewUsageParams{TenantID: tenantID, WorkspaceID: workspaceID})
	if err != nil {
		return nil, err
	}
	out := make(map[string][2]int64, len(rows))
	for _, row := range rows {
		out[row.BenefitPackageID] = [2]int64{row.Committed, row.Reserved}
	}
	return out, nil
}

func (r BenefitPackageRepository) GetReviewReservation(ctx context.Context, id string, lock bool) (domain.ReviewReservation, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetReviewReservationForUpdate(ctx, id)
		return toReviewReservation(sqlc.GetReviewReservationRow(row)), err
	}
	row, err := sqlc.New(r.db()).GetReviewReservation(ctx, id)
	return toReviewReservation(row), err
}
func (r BenefitPackageRepository) GetReviewReservationByOperation(ctx context.Context, id string, lock bool) (domain.ReviewReservation, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetReviewReservationByOperationForUpdate(ctx, id)
		return toReviewReservation(sqlc.GetReviewReservationRow(row)), err
	}
	row, err := sqlc.New(r.db()).GetReviewReservationByOperation(ctx, id)
	return toReviewReservation(sqlc.GetReviewReservationRow(row)), err
}
func (r BenefitPackageRepository) GetActiveReviewReservation(ctx context.Context, packageID, projectID, assetID string, lock bool) (domain.ReviewReservation, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetActiveReviewReservationForUpdate(ctx, sqlc.GetActiveReviewReservationForUpdateParams{BenefitPackageID: packageID, ProjectID: projectID, AssetID: assetID})
		return toReviewReservation(sqlc.GetReviewReservationRow(row)), err
	}
	row, err := sqlc.New(r.db()).GetActiveReviewReservation(ctx, sqlc.GetActiveReviewReservationParams{BenefitPackageID: packageID, ProjectID: projectID, AssetID: assetID})
	return toReviewReservation(sqlc.GetReviewReservationRow(row)), err
}
func (r BenefitPackageRepository) CreateReviewReservation(ctx context.Context, v domain.ReviewReservation) error {
	return sqlc.New(r.db()).CreateReviewReservation(ctx, sqlc.CreateReviewReservationParams{
		ID:               v.ID,
		TenantID:         v.TenantID,
		WorkspaceID:      v.WorkspaceID,
		BenefitPackageID: v.BenefitPackageID,
		ProjectID:        v.ProjectID,
		AssetID:          v.AssetID,
		OperationID:      v.OperationID,
		Status:           v.Status,
		CreatedAt:        v.CreatedAt,
		UpdatedAt:        v.UpdatedAt,
	})
}
func (r BenefitPackageRepository) SaveReviewReservation(ctx context.Context, v domain.ReviewReservation) error {
	return sqlc.New(r.db()).SaveReviewReservation(ctx, sqlc.SaveReviewReservationParams{ID: v.ID, OperationID: v.OperationID, Status: v.Status, UpdatedAt: v.UpdatedAt})
}

func (r BenefitPackageRepository) GetReviewCleanup(ctx context.Context, id string, lock bool) (domain.ReviewCleanup, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetReviewCleanupForUpdate(ctx, id)
		return toReviewCleanup(row), err
	}
	row, err := sqlc.New(r.db()).GetReviewCleanup(ctx, id)
	return toReviewCleanup(row), err
}
func (r BenefitPackageRepository) CreateReviewCleanup(ctx context.Context, v domain.ReviewCleanup) error {
	return sqlc.New(r.db()).CreateReviewCleanup(ctx, sqlc.CreateReviewCleanupParams{CleanupID: v.CleanupID, ReservationID: v.ReservationID, Status: v.Status, CreatedAt: v.CreatedAt, CompletedAt: v.CompletedAt})
}
func (r BenefitPackageRepository) SaveReviewCleanup(ctx context.Context, v domain.ReviewCleanup) error {
	return sqlc.New(r.db()).SaveReviewCleanup(ctx, sqlc.SaveReviewCleanupParams{CleanupID: v.CleanupID, Status: v.Status, CompletedAt: v.CompletedAt})
}
func (r BenefitPackageRepository) CountPendingReviewCleanups(ctx context.Context, reservationID string) (int64, error) {
	return sqlc.New(r.db()).CountPendingReviewCleanups(ctx, reservationID)
}

func (r BenefitPackageRepository) ListAssetGroupCleanups(ctx context.Context, tenantID, workspaceID string) ([]domain.AssetGroupCleanup, error) {
	rows, err := sqlc.New(r.db()).ListAssetGroupCleanups(ctx, sqlc.ListAssetGroupCleanupsParams{TenantID: tenantID, WorkspaceID: workspaceID})
	if err != nil {
		return nil, err
	}
	out := make([]domain.AssetGroupCleanup, len(rows))
	for i, row := range rows {
		out[i] = toAssetGroupCleanup(row)
	}
	return out, nil
}
func (r BenefitPackageRepository) GetAssetGroupCleanup(ctx context.Context, id, tenantID, workspaceID string, lock bool) (domain.AssetGroupCleanup, error) {
	if lock {
		row, err := sqlc.New(r.db()).GetAssetGroupCleanupForUpdate(ctx, sqlc.GetAssetGroupCleanupForUpdateParams{ID: id, TenantID: tenantID, WorkspaceID: workspaceID})
		return toAssetGroupCleanup(row), err
	}
	row, err := sqlc.New(r.db()).GetAssetGroupCleanup(ctx, sqlc.GetAssetGroupCleanupParams{ID: id, TenantID: tenantID, WorkspaceID: workspaceID})
	return toAssetGroupCleanup(row), err
}
func (r BenefitPackageRepository) CreateAssetGroupCleanup(ctx context.Context, v domain.AssetGroupCleanup) error {
	return sqlc.New(r.db()).CreateAssetGroupCleanup(ctx, sqlc.CreateAssetGroupCleanupParams{
		ID:                 v.ID,
		TenantID:           v.TenantID,
		WorkspaceID:        v.WorkspaceID,
		BenefitPackageID:   v.BenefitPackageID,
		AssetGroupID:       v.AssetGroupID,
		ProjectName:        v.ProjectName,
		AccessKeyIDEnc:     v.AccessKeyIDEncrypted,
		SecretAccessKeyEnc: v.SecretKeyEncrypted,
		Status:             v.Status,
		LeaseToken:         v.LeaseToken,
		LeaseUntil:         v.LeaseUntil,
		Attempts:           int64(v.Attempts),
		LastError:          v.LastError,
		CreatedAt:          v.CreatedAt,
		UpdatedAt:          v.UpdatedAt,
		CompletedAt:        v.CompletedAt,
	})
}
func (r BenefitPackageRepository) SaveAssetGroupCleanup(ctx context.Context, v domain.AssetGroupCleanup) error {
	return sqlc.New(r.db()).SaveAssetGroupCleanup(ctx, sqlc.SaveAssetGroupCleanupParams{
		ID:          v.ID,
		Status:      v.Status,
		LeaseToken:  v.LeaseToken,
		LeaseUntil:  v.LeaseUntil,
		Attempts:    int64(v.Attempts),
		LastError:   v.LastError,
		UpdatedAt:   v.UpdatedAt,
		CompletedAt: v.CompletedAt,
	})
}

func toAssetGroupCleanup(row sqlc.BenefitPackageAssetGroupCleanup) domain.AssetGroupCleanup {
	value := domain.AssetGroupCleanup{
		ID:                   row.ID,
		TenantID:             row.TenantID,
		WorkspaceID:          row.WorkspaceID,
		BenefitPackageID:     row.BenefitPackageID,
		AssetGroupID:         row.AssetGroupID,
		ProjectName:          row.ProjectName,
		AccessKeyIDEncrypted: row.AccessKeyIDEnc,
		SecretKeyEncrypted:   row.SecretAccessKeyEnc,
		Status:               row.Status,
		LeaseToken:           row.LeaseToken,
		LeaseUntil:           row.LeaseUntil,
		Attempts:             int(row.Attempts),
		LastError:            row.LastError,
		CreatedAt:            row.CreatedAt,
		UpdatedAt:            row.UpdatedAt,
		CompletedAt:          row.CompletedAt,
	}
	return value
}

func toBenefitPackage(row sqlc.BenefitPackage) domain.BenefitPackage {
	value := domain.BenefitPackage{
		ID:                   row.ID,
		TenantID:             row.TenantID,
		WorkspaceID:          row.WorkspaceID,
		IsPreset:             row.IsPreset,
		Name:                 row.Name,
		ProjectName:          row.ProjectName,
		AssetGroupID:         row.AssetGroupID,
		AccessKeyIDEncrypted: row.AccessKeyIDEnc,
		SecretKeyEncrypted:   row.SecretAccessKeyEnc,
		Enabled:              row.Enabled,
		MaterialUsed:         row.MaterialUsed,
		MaterialLimit:        row.MaterialLimit,
		Revision:             row.Revision,
		CreatedBy:            row.CreatedBy,
		UpdatedBy:            row.UpdatedBy,
		CreatedAt:            row.CreatedAt,
		UpdatedAt:            row.UpdatedAt,
		DeletedAt:            row.DeletedAt,
	}
	_ = json.Unmarshal([]byte(row.ModelIdsJson), &value.ModelIDs)
	return value
}

func toReviewCleanup(row sqlc.BenefitPackageReviewCleanupClaim) domain.ReviewCleanup {
	value := domain.ReviewCleanup{
		CleanupID:     row.CleanupID,
		ReservationID: row.ReservationID,
		Status:        row.Status,
		CreatedAt:     row.CreatedAt,
		CompletedAt:   row.CompletedAt,
	}
	return value
}

func toReviewReservation(row sqlc.GetReviewReservationRow) domain.ReviewReservation {
	value := domain.ReviewReservation{
		ID:               row.ID,
		TenantID:         row.TenantID,
		WorkspaceID:      row.WorkspaceID,
		BenefitPackageID: row.BenefitPackageID,
		ProjectID:        row.ProjectID,
		AssetID:          row.AssetID,
		OperationID:      row.OperationID,
		Status:           row.Status,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
	return value
}
