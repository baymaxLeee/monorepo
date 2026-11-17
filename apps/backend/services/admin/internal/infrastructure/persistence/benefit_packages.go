package persistence

import (
	"context"
	"encoding/json"

	"github.com/example/monorepo/admin/internal/application"
	"github.com/example/monorepo/admin/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type BenefitPackageRepository struct {
	Pool *pgxpool.Pool
	DB   skillDB
}

func (r BenefitPackageRepository) db() skillDB {
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

const benefitColumns = `id,tenant_id,workspace_id,is_preset,name,project_name,asset_group_id,access_key_id_enc,secret_access_key_enc,enabled,model_ids_json,material_used,material_limit,revision,created_by,updated_by,created_at,updated_at,deleted_at`

func scanBenefit(row pgx.Row) (domain.BenefitPackage, error) {
	var value domain.BenefitPackage
	var models string
	err := row.Scan(&value.ID, &value.TenantID, &value.WorkspaceID, &value.IsPreset, &value.Name, &value.ProjectName, &value.AssetGroupID, &value.AccessKeyIDEncrypted, &value.SecretKeyEncrypted, &value.Enabled, &models, &value.MaterialUsed, &value.MaterialLimit, &value.Revision, &value.CreatedBy, &value.UpdatedBy, &value.CreatedAt, &value.UpdatedAt, &value.DeletedAt)
	if err == nil {
		_ = json.Unmarshal([]byte(models), &value.ModelIDs)
	}
	return value, err
}

func (r BenefitPackageRepository) ListBenefitPackages(ctx context.Context, tenantID, workspaceID string) ([]domain.BenefitPackage, error) {
	rows, err := r.db().Query(ctx, `SELECT `+benefitColumns+` FROM benefit_packages WHERE tenant_id=$1 AND workspace_id=$2 AND deleted_at IS NULL ORDER BY is_preset DESC,updated_at DESC`, tenantID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []domain.BenefitPackage{}
	for rows.Next() {
		v, e := scanBenefit(rows)
		if e != nil {
			return nil, e
		}
		values = append(values, v)
	}
	return values, rows.Err()
}

func (r BenefitPackageRepository) GetBenefitPackage(ctx context.Context, id, tenantID, workspaceID string, lock bool) (domain.BenefitPackage, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanBenefit(r.db().QueryRow(ctx, `SELECT `+benefitColumns+` FROM benefit_packages WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND deleted_at IS NULL`+suffix, id, tenantID, workspaceID))
}

func (r BenefitPackageRepository) CreateBenefitPackage(ctx context.Context, v domain.BenefitPackage) error {
	models, _ := json.Marshal(v.ModelIDs)
	_, err := r.db().Exec(ctx, `INSERT INTO benefit_packages(id,tenant_id,workspace_id,is_preset,name,project_name,asset_group_id,access_key_id_enc,secret_access_key_enc,enabled,model_ids_json,material_used,material_limit,revision,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, v.ID, v.TenantID, v.WorkspaceID, v.IsPreset, v.Name, v.ProjectName, v.AssetGroupID, v.AccessKeyIDEncrypted, v.SecretKeyEncrypted, v.Enabled, string(models), v.MaterialUsed, v.MaterialLimit, v.Revision, v.CreatedBy, v.UpdatedBy, v.CreatedAt, v.UpdatedAt)
	return err
}
func (r BenefitPackageRepository) SaveBenefitPackage(ctx context.Context, v domain.BenefitPackage) error {
	models, _ := json.Marshal(v.ModelIDs)
	_, err := r.db().Exec(ctx, `UPDATE benefit_packages SET name=$2,project_name=$3,asset_group_id=$4,access_key_id_enc=$5,secret_access_key_enc=$6,enabled=$7,model_ids_json=$8,material_used=$9,material_limit=$10,revision=$11,updated_by=$12,updated_at=$13,deleted_at=$14 WHERE id=$1`, v.ID, v.Name, v.ProjectName, v.AssetGroupID, v.AccessKeyIDEncrypted, v.SecretKeyEncrypted, v.Enabled, string(models), v.MaterialUsed, v.MaterialLimit, v.Revision, v.UpdatedBy, v.UpdatedAt, v.DeletedAt)
	return err
}
func (r BenefitPackageRepository) ReplaceBenefitPackageModels(ctx context.Context, v domain.BenefitPackage, ids []string) error {
	if _, err := r.db().Exec(ctx, `DELETE FROM benefit_package_models WHERE package_id=$1`, v.ID); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := r.db().Exec(ctx, `INSERT INTO benefit_package_models(package_id,tenant_id,workspace_id,model_id) VALUES($1,$2,$3,$4)`, v.ID, v.TenantID, v.WorkspaceID, id); err != nil {
			return err
		}
	}
	return nil
}
func (r BenefitPackageRepository) ReviewUsage(ctx context.Context, tenantID, workspaceID string) (map[string][2]int64, error) {
	rows, err := r.db().Query(ctx, `SELECT benefit_package_id,COUNT(*) FILTER(WHERE status IN('committed','releasing','reacquiring')),COUNT(*) FILTER(WHERE status='reserved') FROM benefit_package_review_reservations WHERE tenant_id=$1 AND workspace_id=$2 GROUP BY benefit_package_id`, tenantID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][2]int64{}
	for rows.Next() {
		var id string
		var committed, reserved int64
		if err := rows.Scan(&id, &committed, &reserved); err != nil {
			return nil, err
		}
		out[id] = [2]int64{committed, reserved}
	}
	return out, rows.Err()
}

const reservationColumns = `id,tenant_id,workspace_id,benefit_package_id,project_id,asset_id,operation_id,status,created_at,updated_at`

func scanReservation(row pgx.Row) (domain.ReviewReservation, error) {
	var v domain.ReviewReservation
	err := row.Scan(&v.ID, &v.TenantID, &v.WorkspaceID, &v.BenefitPackageID, &v.ProjectID, &v.AssetID, &v.OperationID, &v.Status, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}
func (r BenefitPackageRepository) GetReviewReservation(ctx context.Context, id string, lock bool) (domain.ReviewReservation, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanReservation(r.db().QueryRow(ctx, `SELECT `+reservationColumns+` FROM benefit_package_review_reservations WHERE id=$1`+suffix, id))
}
func (r BenefitPackageRepository) GetReviewReservationByOperation(ctx context.Context, id string, lock bool) (domain.ReviewReservation, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanReservation(r.db().QueryRow(ctx, `SELECT `+reservationColumns+` FROM benefit_package_review_reservations WHERE operation_id=$1`+suffix, id))
}
func (r BenefitPackageRepository) GetActiveReviewReservation(ctx context.Context, packageID, projectID, assetID string, lock bool) (domain.ReviewReservation, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanReservation(r.db().QueryRow(ctx, `SELECT `+reservationColumns+` FROM benefit_package_review_reservations WHERE benefit_package_id=$1 AND project_id=$2 AND asset_id=$3 AND status IN('reserved','committed','releasing','reacquiring')`+suffix, packageID, projectID, assetID))
}
func (r BenefitPackageRepository) CreateReviewReservation(ctx context.Context, v domain.ReviewReservation) error {
	_, err := r.db().Exec(ctx, `INSERT INTO benefit_package_review_reservations(id,tenant_id,workspace_id,benefit_package_id,project_id,asset_id,operation_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, v.ID, v.TenantID, v.WorkspaceID, v.BenefitPackageID, v.ProjectID, v.AssetID, v.OperationID, v.Status, v.CreatedAt, v.UpdatedAt)
	return err
}
func (r BenefitPackageRepository) SaveReviewReservation(ctx context.Context, v domain.ReviewReservation) error {
	_, err := r.db().Exec(ctx, `UPDATE benefit_package_review_reservations SET operation_id=$2,status=$3,updated_at=$4 WHERE id=$1`, v.ID, v.OperationID, v.Status, v.UpdatedAt)
	return err
}

func scanReviewCleanup(row pgx.Row) (domain.ReviewCleanup, error) {
	var v domain.ReviewCleanup
	err := row.Scan(&v.CleanupID, &v.ReservationID, &v.Status, &v.CreatedAt, &v.CompletedAt)
	return v, err
}
func (r BenefitPackageRepository) GetReviewCleanup(ctx context.Context, id string, lock bool) (domain.ReviewCleanup, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanReviewCleanup(r.db().QueryRow(ctx, `SELECT cleanup_id,reservation_id,status,created_at,completed_at FROM benefit_package_review_cleanup_claims WHERE cleanup_id=$1`+suffix, id))
}
func (r BenefitPackageRepository) CreateReviewCleanup(ctx context.Context, v domain.ReviewCleanup) error {
	_, err := r.db().Exec(ctx, `INSERT INTO benefit_package_review_cleanup_claims(cleanup_id,reservation_id,status,created_at,completed_at) VALUES($1,$2,$3,$4,$5)`, v.CleanupID, v.ReservationID, v.Status, v.CreatedAt, v.CompletedAt)
	return err
}
func (r BenefitPackageRepository) SaveReviewCleanup(ctx context.Context, v domain.ReviewCleanup) error {
	_, err := r.db().Exec(ctx, `UPDATE benefit_package_review_cleanup_claims SET status=$2,completed_at=$3 WHERE cleanup_id=$1`, v.CleanupID, v.Status, v.CompletedAt)
	return err
}
func (r BenefitPackageRepository) CountPendingReviewCleanups(ctx context.Context, reservationID string) (int64, error) {
	var count int64
	err := r.db().QueryRow(ctx, `SELECT COUNT(*) FROM benefit_package_review_cleanup_claims WHERE reservation_id=$1 AND status='pending'`, reservationID).Scan(&count)
	return count, err
}

const groupCleanupColumns = `id,tenant_id,workspace_id,benefit_package_id,asset_group_id,project_name,access_key_id_enc,secret_access_key_enc,status,lease_token,lease_until,attempts,last_error,created_at,updated_at,completed_at`

func scanGroupCleanup(row pgx.Row) (domain.AssetGroupCleanup, error) {
	var v domain.AssetGroupCleanup
	err := row.Scan(&v.ID, &v.TenantID, &v.WorkspaceID, &v.BenefitPackageID, &v.AssetGroupID, &v.ProjectName, &v.AccessKeyIDEncrypted, &v.SecretKeyEncrypted, &v.Status, &v.LeaseToken, &v.LeaseUntil, &v.Attempts, &v.LastError, &v.CreatedAt, &v.UpdatedAt, &v.CompletedAt)
	return v, err
}
func (r BenefitPackageRepository) ListAssetGroupCleanups(ctx context.Context, tenantID, workspaceID string) ([]domain.AssetGroupCleanup, error) {
	rows, err := r.db().Query(ctx, `SELECT `+groupCleanupColumns+` FROM benefit_package_asset_group_cleanups WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC`, tenantID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.AssetGroupCleanup{}
	for rows.Next() {
		v, e := scanGroupCleanup(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r BenefitPackageRepository) GetAssetGroupCleanup(ctx context.Context, id, tenantID, workspaceID string, lock bool) (domain.AssetGroupCleanup, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	return scanGroupCleanup(r.db().QueryRow(ctx, `SELECT `+groupCleanupColumns+` FROM benefit_package_asset_group_cleanups WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`+suffix, id, tenantID, workspaceID))
}
func (r BenefitPackageRepository) CreateAssetGroupCleanup(ctx context.Context, v domain.AssetGroupCleanup) error {
	_, err := r.db().Exec(ctx, `INSERT INTO benefit_package_asset_group_cleanups(id,tenant_id,workspace_id,benefit_package_id,asset_group_id,project_name,access_key_id_enc,secret_access_key_enc,status,lease_token,lease_until,attempts,last_error,created_at,updated_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(asset_group_id) DO NOTHING`, v.ID, v.TenantID, v.WorkspaceID, v.BenefitPackageID, v.AssetGroupID, v.ProjectName, v.AccessKeyIDEncrypted, v.SecretKeyEncrypted, v.Status, v.LeaseToken, v.LeaseUntil, v.Attempts, v.LastError, v.CreatedAt, v.UpdatedAt, v.CompletedAt)
	return err
}
func (r BenefitPackageRepository) SaveAssetGroupCleanup(ctx context.Context, v domain.AssetGroupCleanup) error {
	_, err := r.db().Exec(ctx, `UPDATE benefit_package_asset_group_cleanups SET status=$2,lease_token=$3,lease_until=$4,attempts=$5,last_error=$6,updated_at=$7,completed_at=$8 WHERE id=$1`, v.ID, v.Status, v.LeaseToken, v.LeaseUntil, v.Attempts, v.LastError, v.UpdatedAt, v.CompletedAt)
	return err
}
