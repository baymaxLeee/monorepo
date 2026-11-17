package application

import (
	"context"
	"strings"
	"time"

	"github.com/example/monorepo/admin/internal/domain"
	"github.com/google/uuid"
)

type BenefitPackageService struct {
	Repository BenefitPackageRepository
	Providers  ProviderRepository
	Groups     AssetGroupService
	Keys       SecretCipher
	Errors     ErrorClassifier
}

type CreateBenefitPackage struct {
	IsPreset                                        bool
	Name, ProjectName, AccessKeyID, SecretAccessKey string
	Enabled                                         bool
	ModelIDs                                        []string
	MaterialLimit                                   *int64
}

type UpdateBenefitPackage struct {
	ExpectedRevision                                int64
	Name, ProjectName, AccessKeyID, SecretAccessKey *string
	Enabled                                         *bool
	ModelIDs                                        *[]string
	MaterialLimit                                   *int64
	MaterialLimitSet                                bool
}

type InternalBenefitPackage struct {
	Package                      domain.BenefitPackage
	AccessKeyID, SecretAccessKey string
}

type ReviewedAsset struct{ ID, Status, FailureReason string }

func (s BenefitPackageService) List(ctx context.Context, actor Actor, availableOnly bool) ([]domain.BenefitPackage, error) {
	values, err := s.Repository.ListBenefitPackages(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return nil, err
	}
	usage, err := s.Repository.ReviewUsage(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.BenefitPackage, 0, len(values))
	for _, v := range values {
		u := usage[v.ID]
		v.MaterialUsed, v.MaterialReserved = u[0], u[1]
		if availableOnly || !actor.CanWriteWorkspace() {
			if !v.Enabled {
				continue
			}
		}
		out = append(out, v)
	}
	return out, nil
}

func (s BenefitPackageService) Available(ctx context.Context, workspaceID, tenantID string) ([]domain.BenefitPackage, error) {
	return s.List(ctx, Actor{WorkspaceID: workspaceID, TenantID: tenantID}, true)
}

func (s BenefitPackageService) Create(ctx context.Context, actor Actor, input CreateBenefitPackage) (domain.BenefitPackage, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.BenefitPackage{}, err
	}
	input.ModelIDs = normalizeIDs(input.ModelIDs)
	if input.IsPreset {
		input.ModelIDs = nil
	}
	if !input.IsPreset && len(input.ModelIDs) == 0 {
		return domain.BenefitPackage{}, BadRequest("custom package requires at least one model")
	}
	name := strings.TrimSpace(input.Name)
	project := strings.TrimSpace(input.ProjectName)
	if input.IsPreset {
		name = "预置权益包"
		project = "default"
	}
	if !input.IsPreset && name == "预置权益包" {
		return domain.BenefitPackage{}, BadRequest("custom package cannot use the preset package name")
	}
	if name == "" || project == "" || strings.TrimSpace(input.AccessKeyID) == "" || strings.TrimSpace(input.SecretAccessKey) == "" {
		return domain.BenefitPackage{}, BadRequest("benefit package name, project and credentials are required")
	}
	packages, err := s.Repository.ListBenefitPackages(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	if err = s.validateModels(ctx, actor, input.ModelIDs, packages, ""); err != nil {
		return domain.BenefitPackage{}, err
	}
	if input.IsPreset {
		for _, v := range packages {
			if v.IsPreset {
				return domain.BenefitPackage{}, Conflict("preset benefit package already exists")
			}
		}
	}
	credentials := AssetGroupCredentials{ProjectName: project, AccessKeyID: input.AccessKeyID, SecretAccessKey: input.SecretAccessKey}
	groupID, err := s.Groups.Create(ctx, credentials, name, "Canvas 高级创作权益包")
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	accessEnc, err := s.Keys.Encrypt(input.AccessKeyID)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	secretEnc, err := s.Keys.Encrypt(input.SecretAccessKey)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	now := time.Now().UTC()
	value := domain.BenefitPackage{ID: strings.ReplaceAll(uuid.NewString(), "-", ""), TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, IsPreset: input.IsPreset, Name: name, ProjectName: project, AssetGroupID: groupID, AccessKeyIDEncrypted: accessEnc, SecretKeyEncrypted: secretEnc, Enabled: input.Enabled, ModelIDs: input.ModelIDs, MaterialLimit: input.MaterialLimit, Revision: 1, CreatedBy: actor.UserID, UpdatedBy: actor.UserID, CreatedAt: now, UpdatedAt: now}
	if input.IsPreset {
		value.Enabled = true
		value.ModelIDs = []string{}
	}
	err = s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		if err := repo.CreateBenefitPackage(ctx, value); err != nil {
			return err
		}
		return repo.ReplaceBenefitPackageModels(ctx, value, value.ModelIDs)
	})
	if err != nil {
		_ = s.enqueueCleanup(ctx, actor, value, credentials)
		return domain.BenefitPackage{}, err
	}
	return value, nil
}

func (s BenefitPackageService) Update(ctx context.Context, actor Actor, id string, input UpdateBenefitPackage) (domain.BenefitPackage, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.BenefitPackage{}, err
	}
	current, err := s.get(ctx, id, actor.WorkspaceID, actor.TenantID, false)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	if current.Revision != input.ExpectedRevision {
		return domain.BenefitPackage{}, Conflict("benefit package changed; reload before saving")
	}
	if current.IsPreset && (input.Name != nil || input.ProjectName != nil || input.ModelIDs != nil) {
		return domain.BenefitPackage{}, BadRequest("preset package scope cannot be changed")
	}
	access, err := s.Keys.Decrypt(current.AccessKeyIDEncrypted)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	secret, err := s.Keys.Decrypt(current.SecretKeyEncrypted)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	name, project := current.Name, current.ProjectName
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	if input.ProjectName != nil {
		project = strings.TrimSpace(*input.ProjectName)
	}
	if input.AccessKeyID != nil {
		access = strings.TrimSpace(*input.AccessKeyID)
	}
	if input.SecretAccessKey != nil {
		secret = strings.TrimSpace(*input.SecretAccessKey)
	}
	if !current.IsPreset && name == "预置权益包" {
		return domain.BenefitPackage{}, BadRequest("custom package cannot use the preset package name")
	}
	if name == "" || project == "" || access == "" || secret == "" {
		return domain.BenefitPackage{}, BadRequest("benefit package name, project and credentials are required")
	}
	models := current.ModelIDs
	if input.ModelIDs != nil {
		models = normalizeIDs(*input.ModelIDs)
	}
	if !current.IsPreset && len(models) == 0 {
		return domain.BenefitPackage{}, BadRequest("custom package requires at least one model")
	}
	groupChanged := name != current.Name || project != current.ProjectName || input.AccessKeyID != nil || input.SecretAccessKey != nil
	usage, err := s.Repository.ReviewUsage(ctx, actor.TenantID, actor.WorkspaceID)
	if err != nil {
		return domain.BenefitPackage{}, err
	}
	u := usage[id]
	if u[0]+u[1] > 0 && (groupChanged || input.ModelIDs != nil) {
		return domain.BenefitPackage{}, Conflict("benefit package credentials, project and models cannot change while reviews exist")
	}
	var newGroup string
	if groupChanged {
		newGroup, err = s.Groups.Create(ctx, AssetGroupCredentials{ProjectName: project, AccessKeyID: access, SecretAccessKey: secret}, name, "Canvas 高级创作权益包")
		if err != nil {
			return domain.BenefitPackage{}, err
		}
	}
	old := current
	err = s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		value, e := repo.GetBenefitPackage(ctx, id, actor.TenantID, actor.WorkspaceID, true)
		if s.Errors.IsNotFound(e) {
			return NotFound("benefit package %s not found", id)
		}
		if e != nil {
			return e
		}
		if value.Revision != input.ExpectedRevision {
			return Conflict("benefit package changed; reload before saving")
		}
		packages, e := repo.ListBenefitPackages(ctx, actor.TenantID, actor.WorkspaceID)
		if e != nil {
			return e
		}
		if e = s.validateModels(ctx, actor, models, packages, id); e != nil {
			return e
		}
		value.Name, value.ProjectName, value.ModelIDs = name, project, models
		if newGroup != "" {
			value.AssetGroupID = newGroup
		}
		if input.AccessKeyID != nil {
			value.AccessKeyIDEncrypted, e = s.Keys.Encrypt(access)
			if e != nil {
				return e
			}
		}
		if input.SecretAccessKey != nil {
			value.SecretKeyEncrypted, e = s.Keys.Encrypt(secret)
			if e != nil {
				return e
			}
		}
		if input.Enabled != nil {
			value.Enabled = *input.Enabled
		}
		if input.MaterialLimitSet {
			if input.MaterialLimit != nil && *input.MaterialLimit < u[0]+u[1] {
				return Conflict("material limit cannot be lower than committed and reserved reviews")
			}
			value.MaterialLimit = input.MaterialLimit
		}
		value.Revision++
		value.UpdatedBy = actor.UserID
		value.UpdatedAt = time.Now().UTC()
		if e = repo.SaveBenefitPackage(ctx, value); e != nil {
			return e
		}
		if e = repo.ReplaceBenefitPackageModels(ctx, value, models); e != nil {
			return e
		}
		current = value
		return nil
	})
	if err != nil {
		if newGroup != "" {
			temp := current
			temp.AssetGroupID = newGroup
			_ = s.enqueueCleanup(ctx, actor, temp, AssetGroupCredentials{ProjectName: project, AccessKeyID: access, SecretAccessKey: secret})
		}
		return domain.BenefitPackage{}, err
	}
	if groupChanged {
		oldAccess, _ := s.Keys.Decrypt(old.AccessKeyIDEncrypted)
		oldSecret, _ := s.Keys.Decrypt(old.SecretKeyEncrypted)
		_ = s.enqueueCleanup(ctx, actor, old, AssetGroupCredentials{ProjectName: old.ProjectName, AccessKeyID: oldAccess, SecretAccessKey: oldSecret})
	}
	return current, nil
}

func (s BenefitPackageService) Delete(ctx context.Context, actor Actor, id string, expected int64) error {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return err
	}
	var old domain.BenefitPackage
	err := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		v, e := repo.GetBenefitPackage(ctx, id, actor.TenantID, actor.WorkspaceID, true)
		if s.Errors.IsNotFound(e) {
			return NotFound("benefit package %s not found", id)
		}
		if e != nil {
			return e
		}
		if v.IsPreset {
			return BadRequest("preset benefit package cannot be deleted")
		}
		if v.Revision != expected {
			return Conflict("benefit package changed; reload before deleting")
		}
		usage, e := repo.ReviewUsage(ctx, actor.TenantID, actor.WorkspaceID)
		if e != nil {
			return e
		}
		u := usage[id]
		if u[0]+u[1] > 0 {
			return Conflict("benefit package cannot be deleted while reviews exist")
		}
		now := time.Now().UTC()
		v.DeletedAt = &now
		v.Enabled = false
		v.Revision++
		v.UpdatedBy = actor.UserID
		v.UpdatedAt = now
		if e = repo.SaveBenefitPackage(ctx, v); e != nil {
			return e
		}
		if e = repo.ReplaceBenefitPackageModels(ctx, v, nil); e != nil {
			return e
		}
		old = v
		return nil
	})
	if err != nil {
		return err
	}
	access, _ := s.Keys.Decrypt(old.AccessKeyIDEncrypted)
	secret, _ := s.Keys.Decrypt(old.SecretKeyEncrypted)
	return s.enqueueCleanup(ctx, actor, old, AssetGroupCredentials{ProjectName: old.ProjectName, AccessKeyID: access, SecretAccessKey: secret})
}

func (s BenefitPackageService) Internal(ctx context.Context, id, workspaceID, tenantID string, requireEnabled bool) (InternalBenefitPackage, error) {
	v, err := s.get(ctx, id, workspaceID, tenantID, false)
	if err != nil {
		return InternalBenefitPackage{}, err
	}
	if requireEnabled && !v.Enabled {
		return InternalBenefitPackage{}, NotFound("benefit package %s not found", id)
	}
	access, err := s.Keys.Decrypt(v.AccessKeyIDEncrypted)
	if err != nil {
		return InternalBenefitPackage{}, err
	}
	secret, err := s.Keys.Decrypt(v.SecretKeyEncrypted)
	if err != nil {
		return InternalBenefitPackage{}, err
	}
	return InternalBenefitPackage{Package: v, AccessKeyID: access, SecretAccessKey: secret}, nil
}

func (s BenefitPackageService) Reserve(ctx context.Context, workspaceID, tenantID, packageID, reservationID, projectID, assetID string) (domain.ReviewReservation, error) {
	var out domain.ReviewReservation
	err := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		pkg, e := repo.GetBenefitPackage(ctx, packageID, tenantID, workspaceID, true)
		if s.Errors.IsNotFound(e) {
			return NotFound("benefit package %s not found", packageID)
		}
		if e != nil {
			return e
		}
		if !pkg.Enabled {
			return Conflict("benefit package is disabled")
		}
		existing, e := repo.GetReviewReservationByOperation(ctx, reservationID, true)
		if e == nil {
			if existing.TenantID != tenantID || existing.WorkspaceID != workspaceID || existing.BenefitPackageID != packageID || existing.ProjectID != projectID || existing.AssetID != assetID {
				return Conflict("review reservation id already belongs to another request")
			}
			if existing.Status != "released" {
				out = existing
				return nil
			}
			if e = ensureQuota(ctx, repo, pkg); e != nil {
				return e
			}
			existing.Status = "reserved"
			existing.UpdatedAt = time.Now().UTC()
			out = existing
			return repo.SaveReviewReservation(ctx, existing)
		} else if !s.Errors.IsNotFound(e) {
			return e
		}
		active, e := repo.GetActiveReviewReservation(ctx, packageID, projectID, assetID, true)
		if e == nil {
			if active.Status != "releasing" {
				return Conflict("asset already has an active review in this benefit package")
			}
			active.Status = "reacquiring"
			active.OperationID = reservationID
			active.UpdatedAt = time.Now().UTC()
			out = active
			return repo.SaveReviewReservation(ctx, active)
		} else if !s.Errors.IsNotFound(e) {
			return e
		}
		if e = ensureQuota(ctx, repo, pkg); e != nil {
			return e
		}
		now := time.Now().UTC()
		out = domain.ReviewReservation{ID: reservationID, TenantID: tenantID, WorkspaceID: workspaceID, BenefitPackageID: packageID, ProjectID: projectID, AssetID: assetID, OperationID: reservationID, Status: "reserved", CreatedAt: now, UpdatedAt: now}
		return repo.CreateReviewReservation(ctx, out)
	})
	return out, err
}

func (s BenefitPackageService) Transition(ctx context.Context, workspaceID, tenantID, packageID, reservationID, status string) (domain.ReviewReservation, error) {
	if status != "committed" && status != "released" {
		return domain.ReviewReservation{}, BadRequest("unsupported review reservation status")
	}
	var out domain.ReviewReservation
	err := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		v, e := repo.GetReviewReservation(ctx, reservationID, true)
		if s.Errors.IsNotFound(e) || e == nil && (v.TenantID != tenantID || v.WorkspaceID != workspaceID || v.BenefitPackageID != packageID) {
			return NotFound("review reservation %s not found", reservationID)
		}
		if e != nil {
			return e
		}
		if v.Status == status || v.Status == "released" {
			out = v
			return nil
		}
		if status == "committed" {
			if v.Status != "reserved" && v.Status != "reacquiring" {
				return Conflictf("review reservation cannot be committed from %s", v.Status)
			}
			v.Status = "committed"
		} else if v.Status == "reserved" {
			v.Status = "released"
		} else if v.Status == "reacquiring" {
			pending, e := repo.CountPendingReviewCleanups(ctx, v.ID)
			if e != nil {
				return e
			}
			if pending > 0 {
				v.Status = "releasing"
			} else {
				v.Status = "released"
			}
		}
		v.UpdatedAt = time.Now().UTC()
		out = v
		return repo.SaveReviewReservation(ctx, v)
	})
	return out, err
}

func (s BenefitPackageService) BeginCleanup(ctx context.Context, workspaceID, tenantID, packageID, reservationID, cleanupID string) (domain.ReviewCleanup, error) {
	var out domain.ReviewCleanup
	err := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		v, e := repo.GetReviewReservation(ctx, reservationID, true)
		if s.Errors.IsNotFound(e) || e == nil && (v.TenantID != tenantID || v.WorkspaceID != workspaceID || v.BenefitPackageID != packageID) {
			return NotFound("review reservation %s not found", reservationID)
		}
		if e != nil {
			return e
		}
		claim, e := repo.GetReviewCleanup(ctx, cleanupID, true)
		if e == nil {
			if claim.ReservationID != reservationID {
				return Conflict("review cleanup id already belongs to another reservation")
			}
			out = claim
			return nil
		} else if !s.Errors.IsNotFound(e) {
			return e
		}
		if v.Status == "reserved" || v.Status == "committed" {
			v.Status = "releasing"
			v.UpdatedAt = time.Now().UTC()
			if e = repo.SaveReviewReservation(ctx, v); e != nil {
				return e
			}
		} else if v.Status != "releasing" && v.Status != "reacquiring" && v.Status != "released" {
			return Conflictf("review reservation cannot begin cleanup from %s", v.Status)
		}
		out = domain.ReviewCleanup{CleanupID: cleanupID, ReservationID: reservationID, Status: "pending", CreatedAt: time.Now().UTC()}
		return repo.CreateReviewCleanup(ctx, out)
	})
	return out, err
}

func (s BenefitPackageService) CompleteCleanup(ctx context.Context, workspaceID, tenantID, packageID, reservationID, cleanupID string) (domain.ReviewCleanup, error) {
	var out domain.ReviewCleanup
	err := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		v, e := repo.GetReviewReservation(ctx, reservationID, true)
		if s.Errors.IsNotFound(e) {
			return NotFound("review cleanup %s not found", cleanupID)
		}
		if e != nil {
			return e
		}
		claim, e := repo.GetReviewCleanup(ctx, cleanupID, true)
		if s.Errors.IsNotFound(e) || e == nil && (claim.ReservationID != reservationID || v.TenantID != tenantID || v.WorkspaceID != workspaceID || v.BenefitPackageID != packageID) {
			return NotFound("review cleanup %s not found", cleanupID)
		}
		if e != nil {
			return e
		}
		if claim.Status == "completed" {
			out = claim
			return nil
		}
		now := time.Now().UTC()
		claim.Status = "completed"
		claim.CompletedAt = &now
		if e = repo.SaveReviewCleanup(ctx, claim); e != nil {
			return e
		}
		pending, e := repo.CountPendingReviewCleanups(ctx, reservationID)
		if e != nil {
			return e
		}
		if pending == 0 && v.Status == "releasing" {
			v.Status = "released"
			v.UpdatedAt = now
			if e = repo.SaveReviewReservation(ctx, v); e != nil {
				return e
			}
		}
		out = claim
		return nil
	})
	return out, err
}

func (s BenefitPackageService) SubmitAsset(ctx context.Context, workspaceID, tenantID, packageID, url, assetType, name string) (ReviewedAsset, error) {
	pkg, err := s.Internal(ctx, packageID, workspaceID, tenantID, true)
	if err != nil {
		return ReviewedAsset{}, err
	}
	id, err := s.Groups.CreateAsset(ctx, AssetGroupCredentials{ProjectName: pkg.Package.ProjectName, AccessKeyID: pkg.AccessKeyID, SecretAccessKey: pkg.SecretAccessKey}, pkg.Package.AssetGroupID, url, assetType, name)
	if err != nil {
		return ReviewedAsset{}, err
	}
	return ReviewedAsset{ID: id, Status: "Processing"}, nil
}
func (s BenefitPackageService) GetAsset(ctx context.Context, workspaceID, tenantID, packageID, assetID string) (ReviewedAsset, error) {
	pkg, err := s.Internal(ctx, packageID, workspaceID, tenantID, false)
	if err != nil {
		return ReviewedAsset{}, err
	}
	status, reason, err := s.Groups.GetAsset(ctx, AssetGroupCredentials{ProjectName: pkg.Package.ProjectName, AccessKeyID: pkg.AccessKeyID, SecretAccessKey: pkg.SecretAccessKey}, assetID)
	return ReviewedAsset{ID: assetID, Status: status, FailureReason: reason}, err
}
func (s BenefitPackageService) DeleteAsset(ctx context.Context, workspaceID, tenantID, packageID, assetID string) error {
	pkg, err := s.Internal(ctx, packageID, workspaceID, tenantID, false)
	if err != nil {
		return err
	}
	return s.Groups.DeleteAsset(ctx, AssetGroupCredentials{ProjectName: pkg.Package.ProjectName, AccessKeyID: pkg.AccessKeyID, SecretAccessKey: pkg.SecretAccessKey}, assetID)
}

func (s BenefitPackageService) ListCleanups(ctx context.Context, actor Actor) ([]domain.AssetGroupCleanup, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return nil, err
	}
	return s.Repository.ListAssetGroupCleanups(ctx, actor.TenantID, actor.WorkspaceID)
}
func (s BenefitPackageService) RetryCleanup(ctx context.Context, actor Actor, id string) (domain.AssetGroupCleanup, error) {
	if err := RequireWorkspaceAdmin(actor); err != nil {
		return domain.AssetGroupCleanup{}, err
	}
	token := strings.ReplaceAll(uuid.NewString(), "-", "")
	now := time.Now().UTC()
	var value domain.AssetGroupCleanup
	err := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		v, e := repo.GetAssetGroupCleanup(ctx, id, actor.TenantID, actor.WorkspaceID, true)
		if s.Errors.IsNotFound(e) {
			return NotFound("asset group cleanup %s not found", id)
		}
		if e != nil {
			return e
		}
		if v.Status == "completed" {
			value = v
			return nil
		}
		if v.Status == "running" && v.LeaseUntil != nil && v.LeaseUntil.After(now) {
			return Conflict("asset group cleanup is already running")
		}
		until := now.Add(2 * time.Minute)
		v.Status, v.LeaseToken, v.LeaseUntil, v.LastError = "running", token, &until, ""
		v.Attempts++
		v.UpdatedAt = now
		value = v
		return repo.SaveAssetGroupCleanup(ctx, v)
	})
	if err != nil || value.Status == "completed" {
		return value, err
	}
	access, err := s.Keys.Decrypt(value.AccessKeyIDEncrypted)
	if err != nil {
		return value, err
	}
	secret, err := s.Keys.Decrypt(value.SecretKeyEncrypted)
	if err != nil {
		return value, err
	}
	deleteErr := s.Groups.Delete(ctx, AssetGroupCredentials{ProjectName: value.ProjectName, AccessKeyID: access, SecretAccessKey: secret}, value.AssetGroupID)
	markErr := s.Repository.Transaction(ctx, func(repo BenefitPackageRepository) error {
		v, e := repo.GetAssetGroupCleanup(ctx, id, actor.TenantID, actor.WorkspaceID, true)
		if e != nil {
			return e
		}
		if v.Status != "running" || v.LeaseToken != token {
			return Conflict("asset group cleanup lease changed")
		}
		now := time.Now().UTC()
		v.LeaseToken = ""
		v.LeaseUntil = nil
		v.UpdatedAt = now
		if deleteErr == nil {
			v.Status = "completed"
			v.CompletedAt = &now
			v.LastError = ""
		} else {
			v.Status = "pending"
			message := deleteErr.Error()
			if len(message) > 512 {
				message = message[:512]
			}
			v.LastError = message
		}
		value = v
		return repo.SaveAssetGroupCleanup(ctx, v)
	})
	if deleteErr != nil {
		return value, deleteErr
	}
	return value, markErr
}

func (s BenefitPackageService) get(ctx context.Context, id, workspaceID, tenantID string, lock bool) (domain.BenefitPackage, error) {
	v, err := s.Repository.GetBenefitPackage(ctx, id, tenantID, workspaceID, lock)
	if s.Errors.IsNotFound(err) {
		return domain.BenefitPackage{}, NotFound("benefit package %s not found", id)
	}
	return v, err
}
func (s BenefitPackageService) validateModels(ctx context.Context, actor Actor, ids []string, packages []domain.BenefitPackage, exclude string) error {
	if len(ids) == 0 {
		return nil
	}
	for _, id := range ids {
		p, err := s.Providers.Get(ctx, id, actor.WorkspaceID, actor.TenantID)
		if err != nil || !p.IsEnabled || p.Kind != "video" {
			return BadRequest("benefit packages only accept enabled video models in the current workspace")
		}
	}
	claimed := map[string]bool{}
	for _, pkg := range packages {
		if pkg.ID == exclude || pkg.IsPreset {
			continue
		}
		for _, id := range pkg.ModelIDs {
			claimed[id] = true
		}
	}
	for _, id := range ids {
		if claimed[id] {
			return Conflict("a model can belong to only one custom benefit package")
		}
	}
	return nil
}
func (s BenefitPackageService) enqueueCleanup(ctx context.Context, actor Actor, pkg domain.BenefitPackage, credentials AssetGroupCredentials) error {
	access, err := s.Keys.Encrypt(credentials.AccessKeyID)
	if err != nil {
		return err
	}
	secret, err := s.Keys.Encrypt(credentials.SecretAccessKey)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	value := domain.AssetGroupCleanup{ID: strings.ReplaceAll(uuid.NewString(), "-", ""), TenantID: actor.TenantID, WorkspaceID: actor.WorkspaceID, BenefitPackageID: pkg.ID, AssetGroupID: pkg.AssetGroupID, ProjectName: credentials.ProjectName, AccessKeyIDEncrypted: access, SecretKeyEncrypted: secret, Status: "pending", CreatedAt: now, UpdatedAt: now}
	if err := s.Repository.CreateAssetGroupCleanup(ctx, value); err != nil {
		return err
	}
	// Match the legacy behavior: make one best-effort deletion attempt after the
	// durable intent exists. A failed external call leaves the cleanup pending
	// for an explicit retry and must not mask the package operation itself.
	_, _ = s.RetryCleanup(ctx, actor, value.ID)
	return nil
}
func ensureQuota(ctx context.Context, repo BenefitPackageRepository, pkg domain.BenefitPackage) error {
	usage, err := repo.ReviewUsage(ctx, pkg.TenantID, pkg.WorkspaceID)
	if err != nil {
		return err
	}
	u := usage[pkg.ID]
	if pkg.MaterialLimit != nil && u[0]+u[1] >= *pkg.MaterialLimit {
		return Conflict("benefit package material quota exceeded")
	}
	return nil
}
func normalizeIDs(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
