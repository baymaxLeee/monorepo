package crud

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/monorepo/iam/internal/model"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrNotFound = errors.New("not found")
	// ErrConflict signals a lost race on a conditional state transition
	// (RowsAffected == 0). Callers must NOT retry with last-write-wins.
	ErrConflict = errors.New("conflict")
	// ErrNotActiveMember: the target org is not an active membership of the user.
	ErrNotActiveMember = errors.New("not an active member")
	// ErrInvariant: the operation would break a hard invariant (last org_admin,
	// owner demotion, last super_admin, ...).
	ErrInvariant = errors.New("operation violates an invariant")
)

type Store struct {
	db *gorm.DB
}

func (s *Store) Transaction(ctx context.Context, fn func(*Store) error) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(&Store{db: tx})
	})
}

func Connect(_ context.Context, databaseURL string) (*Store, error) {
	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(4)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	store := &Store{db: db}
	if err := store.Ping(context.Background()); err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Ping(ctx context.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return sqlDB.PingContext(ctx)
}

func (s *Store) Close() {
	sqlDB, err := s.db.DB()
	if err == nil {
		_ = sqlDB.Close()
	}
}

func (s *Store) AutoMigrate(ctx context.Context) error {
	return s.db.WithContext(ctx).AutoMigrate(
		&model.User{},
		&model.UserCredential{},
		&model.RefreshToken{},
		&model.Role{},
		&model.UserRole{},
		&model.Organization{},
		&model.OrganizationMember{},
		&model.IamAuditEvent{},
	)
}

func (s *Store) CreateUserWithPassword(ctx context.Context, user model.User, passwordHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		credential := model.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		return tx.Create(&credential).Error
	})
}

// CreateUserWithMembership atomically creates the user, credential, and a single
// membership. Register uses (member, pending); org-admin creation uses
// (org_admin, active). A bad orgID fails the FK and rolls the whole thing back.
func (s *Store) CreateUserWithMembership(ctx context.Context, user model.User, passwordHash, guestOrgID, orgID, role, status string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.OrganizationMember{
			OrgID:     guestOrgID,
			UserID:    user.ID,
			Role:      "member",
			Status:    "active",
			CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		if orgID == guestOrgID {
			return tx.Model(&model.OrganizationMember{}).
				Where("org_id = ? AND user_id = ?", orgID, user.ID).
				Updates(map[string]any{"role": role, "status": status}).Error
		}
		return tx.Create(&model.OrganizationMember{
			OrgID:     orgID,
			UserID:    user.ID,
			Role:      role,
			Status:    status,
			CreatedAt: now,
		}).Error
	})
}

func (s *Store) CreateRegisteredUser(ctx context.Context, user model.User, passwordHash, guestOrgID, targetOrgID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.UserCredential{
			UserID: user.ID, PasswordHash: passwordHash, PasswordChangedAt: now,
			CreatedAt: now, UpdatedAt: now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.OrganizationMember{
			OrgID: guestOrgID, UserID: user.ID, Role: "member", Status: "active", CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		if targetOrgID == "" || targetOrgID == guestOrgID {
			return nil
		}
		return tx.Create(&model.OrganizationMember{
			OrgID: targetOrgID, UserID: user.ID, Role: "member", Status: "pending", CreatedAt: now,
		}).Error
	})
}

func (s *Store) EnsureUserWithPassword(ctx context.Context, user model.User, passwordHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"email", "email_normalized", "display_name", "updated_at"}),
		}).Create(&user).Error
		if err != nil && isUniqueViolation(err, "uq_users_email_normalized") {
			err = tx.Model(&model.User{}).
				Where("email_normalized = ?", user.EmailNormalized).
				Updates(map[string]any{
					"id":           user.ID,
					"email":        user.Email,
					"display_name": user.DisplayName,
					"updated_at":   now,
				}).Error
		}
		if err != nil {
			return err
		}
		credential := model.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&credential).Error
	})
}

func (s *Store) UserByAccount(ctx context.Context, account string) (model.User, string, error) {
	var credential model.UserCredential
	err := s.db.WithContext(ctx).
		Joins("User").
		// "User" must stay quoted: USER is a reserved word in PostgreSQL.
		Where(`"User".account = ? AND "User".disabled_at IS NULL`, account).
		First(&credential).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, "", ErrNotFound
	}
	return credential.User, credential.PasswordHash, err
}

func (s *Store) UserExistsByAccount(ctx context.Context, account string) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).
		Model(&model.User{}).
		Where("account = ? AND disabled_at IS NULL", account).
		Count(&count).Error
	return count > 0, err
}

func (s *Store) UserByID(ctx context.Context, id string) (model.User, error) {
	var user model.User
	err := s.db.WithContext(ctx).
		Where("id = ? AND disabled_at IS NULL", id).
		First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	return user, err
}

func (s *Store) CreateRefreshToken(ctx context.Context, token model.RefreshToken) error {
	return s.db.WithContext(ctx).Create(&token).Error
}

// RotateRefreshToken rotates the session, carrying the old token's active_org_id
// forward — but only if that membership is STILL active. A revoked/downgraded
// membership drops the org scope so the next access token is unscoped. Returns
// the user and the effective active org (nil when unscoped).
func (s *Store) RotateRefreshToken(ctx context.Context, oldHash string, next model.RefreshToken) (model.User, *string, error) {
	var user model.User
	var activeOrgID *string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		old, err := lockValidToken(tx, oldHash, now)
		if err != nil {
			return err
		}
		carried := old.ActiveOrgID
		if carried != nil {
			status, err := memberStatus(tx, *carried, old.UserID)
			if err != nil {
				return err
			}
			if status != "active" {
				carried = nil
			}
		}
		next.ActiveOrgID = carried
		user, err = rotateSession(tx, &old, &next, now)
		if err != nil {
			return err
		}
		activeOrgID = carried
		return nil
	})
	return user, activeOrgID, err
}

// RotateRefreshTokenToOrg rotates the session and binds it to targetOrgID after
// verifying (inside the transaction) that it is an active membership.
func (s *Store) RotateRefreshTokenToOrg(ctx context.Context, oldHash string, next model.RefreshToken, targetOrgID, expectedUserID string) (model.User, error) {
	var user model.User
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		old, err := lockValidToken(tx, oldHash, now)
		if err != nil {
			return err
		}
		if old.UserID != expectedUserID {
			return ErrNotFound
		}
		status, err := memberStatus(tx, targetOrgID, old.UserID)
		if err != nil {
			return err
		}
		if status != "active" {
			return ErrNotActiveMember
		}
		org := targetOrgID
		next.ActiveOrgID = &org
		user, err = rotateSession(tx, &old, &next, now)
		return err
	})
	return user, err
}

func lockValidToken(tx *gorm.DB, hash string, now time.Time) (model.RefreshToken, error) {
	var old model.RefreshToken
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("token_hash = ?", hash).
		First(&old).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.RefreshToken{}, ErrNotFound
	}
	if err != nil {
		return model.RefreshToken{}, err
	}
	if old.RevokedAt != nil || !old.ExpiresAt.After(now) {
		return model.RefreshToken{}, ErrNotFound
	}
	return old, nil
}

func rotateSession(tx *gorm.DB, old *model.RefreshToken, next *model.RefreshToken, now time.Time) (model.User, error) {
	next.UserID = old.UserID
	if err := tx.Create(next).Error; err != nil {
		return model.User{}, err
	}
	old.RevokedAt = &now
	old.LastUsedAt = &now
	old.ReplacedByTokenID = &next.ID
	if err := tx.Save(old).Error; err != nil {
		return model.User{}, err
	}
	var user model.User
	err := tx.Where("id = ? AND disabled_at IS NULL", old.UserID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	return user, err
}

// memberStatus returns the membership status for (org, user), or "" if none.
func memberStatus(tx *gorm.DB, orgID, userID string) (string, error) {
	var status string
	err := tx.Model(&model.OrganizationMember{}).
		Select("status").
		Where("org_id = ? AND user_id = ?", orgID, userID).
		Scan(&status).Error
	return status, err
}

func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&model.RefreshToken{}).
		Where("token_hash = ? AND revoked_at IS NULL", tokenHash).
		Update("revoked_at", now).Error
}

func (s *Store) MarkLogin(ctx context.Context, userID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", userID).
		Updates(map[string]any{"last_login_at": now, "updated_at": now}).Error
}

func (s *Store) CreateRole(ctx context.Context, role model.Role) error {
	return s.db.WithContext(ctx).Create(&role).Error
}

func (s *Store) EnsureRole(ctx context.Context, role model.Role) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{"description", "updated_at"}),
	}).Create(&role).Error
}

func (s *Store) RoleByName(ctx context.Context, name string) (model.Role, error) {
	var role model.Role
	err := s.db.WithContext(ctx).Where("name = ?", name).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Role{}, ErrNotFound
	}
	return role, err
}

func (s *Store) ListRoles(ctx context.Context) ([]model.Role, error) {
	var roles []model.Role
	err := s.db.WithContext(ctx).Order("name").Find(&roles).Error
	return roles, err
}

func (s *Store) AssignRole(ctx context.Context, userID, roleID string) error {
	userRole := model.UserRole{
		UserID:    userID,
		RoleID:    roleID,
		CreatedAt: time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&userRole).Error
}

func (s *Store) RemoveRole(ctx context.Context, userID, roleID string) error {
	result := s.db.WithContext(ctx).
		Where("user_id = ? AND role_id = ?", userID, roleID).
		Delete(&model.UserRole{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UserRoles(ctx context.Context, userID string) ([]model.Role, error) {
	var roles []model.Role
	err := s.db.WithContext(ctx).
		Table("roles").
		Select("roles.*").
		Joins("JOIN user_roles ON user_roles.role_id = roles.id").
		Where("user_roles.user_id = ?", userID).
		Order("roles.name").
		Find(&roles).Error
	return roles, err
}

func (s *Store) EnsureOrganization(ctx context.Context, org model.Organization) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "slug", "owner_user_id", "system_managed", "system_key", "join_policy", "updated_at"}),
	}).Create(&org).Error
}

func (s *Store) EnsureAllUsersInGuestOrg(ctx context.Context, orgID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Exec(`
		INSERT INTO organization_members (org_id, user_id, role, status, created_at)
		SELECT ?, u.id, 'member', 'active', ? FROM users u
		LEFT JOIN organization_members m ON m.org_id = ? AND m.user_id = u.id
		WHERE m.user_id IS NULL`, orgID, now, orgID).Error
}

// EnsureOrgMember upserts a membership at a fixed role/status. Used by seed to
// keep the system super_admin an active org_admin idempotently.
func (s *Store) EnsureOrgMember(ctx context.Context, orgID, userID, role, status string) error {
	member := model.OrganizationMember{
		OrgID:     orgID,
		UserID:    userID,
		Role:      role,
		Status:    status,
		CreatedAt: time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "org_id"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"role", "status"}),
	}).Create(&member).Error
}

// --- Platform roles ------------------------------------------------------

func (s *Store) RoleByID(ctx context.Context, id string) (model.Role, error) {
	var role model.Role
	err := s.db.WithContext(ctx).Where("id = ?", id).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Role{}, ErrNotFound
	}
	return role, err
}

// CountUsersWithRole counts distinct users holding a platform role by name.
// Used to protect the "at least one super_admin" invariant.
func (s *Store) CountUsersWithRole(ctx context.Context, roleName string) (int64, error) {
	var count int64
	err := s.db.WithContext(ctx).
		Table("user_roles AS ur").
		Joins("JOIN roles r ON r.id = ur.role_id").
		Where("r.name = ?", roleName).
		Count(&count).Error
	return count, err
}

// --- Organizations -------------------------------------------------------

func (s *Store) OrganizationByID(ctx context.Context, id string) (model.Organization, error) {
	var org model.Organization
	err := s.db.WithContext(ctx).Where("id = ?", id).First(&org).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Organization{}, ErrNotFound
	}
	return org, err
}

// ListOrganizations returns every org ordered by name. The public endpoint maps
// this down to {id,name}; management uses ListOrganizationsForAdmin.
func (s *Store) ListOrganizations(ctx context.Context) ([]model.Organization, error) {
	var orgs []model.Organization
	err := s.db.WithContext(ctx).
		Where("system_managed = ? AND join_policy = ?", false, "approval").
		Order("name").Find(&orgs).Error
	return orgs, err
}

type OrgAdminRow struct {
	ID            string
	Name          string
	Slug          string
	OwnerUserID   string
	SystemManaged bool
	JoinPolicy    string
	MemberCount   int64
	CreatedAt     time.Time
}

func (s *Store) ListOrganizationsForAdmin(ctx context.Context) ([]OrgAdminRow, error) {
	var rows []OrgAdminRow
	err := s.db.WithContext(ctx).
		Table("organizations AS o").
		Select("o.id, o.name, o.slug, o.owner_user_id, o.system_managed, o.join_policy, o.created_at, " +
			"(SELECT COUNT(*) FROM organization_members m WHERE m.org_id = o.id AND m.status = 'active') AS member_count").
		Order("o.created_at DESC").
		Scan(&rows).Error
	return rows, err
}

// CreateOrganizationWithOwner creates an org whose first member is an existing
// user, made an active org_admin/owner in one transaction.
func (s *Store) CreateOrganizationWithOwner(ctx context.Context, org model.Organization, ownerUserID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&org).Error; err != nil {
			return err
		}
		return upsertActiveOrgAdmin(tx, org.ID, ownerUserID, now)
	})
}

// CreateOrganizationWithNewOwner atomically creates the owner account, the org,
// and the owner's active org_admin membership.
func (s *Store) CreateOrganizationWithNewOwner(ctx context.Context, org model.Organization, owner model.User, passwordHash, guestOrgID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&owner).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.UserCredential{
			UserID:            owner.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&org).Error; err != nil {
			return err
		}
		if err := upsertActiveOrgAdmin(tx, org.ID, owner.ID, now); err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.OrganizationMember{
			OrgID: guestOrgID, UserID: owner.ID, Role: "member", Status: "active", CreatedAt: now,
		}).Error
	})
}

// TransferOwner moves ownership to newOwnerUserID inside one transaction: lock
// the org, promote the target to active org_admin, then repoint owner. The old
// owner keeps org_admin (may be demoted afterwards via the role API).
func (s *Store) TransferOwner(ctx context.Context, orgID, newOwnerUserID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var org model.Organization
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", orgID).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if org.SystemManaged {
			return ErrInvariant
		}
		var member model.OrganizationMember
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("org_id = ? AND user_id = ?", orgID, newOwnerUserID).
			First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvariant // new owner must already be a member of this org
		}
		if err != nil {
			return err
		}
		if err := upsertActiveOrgAdmin(tx, orgID, newOwnerUserID, now); err != nil {
			return err
		}
		return tx.Model(&model.Organization{}).
			Where("id = ?", orgID).
			Updates(map[string]any{"owner_user_id": newOwnerUserID, "updated_at": now}).Error
	})
}

func upsertActiveOrgAdmin(tx *gorm.DB, orgID, userID string, now time.Time) error {
	member := model.OrganizationMember{
		OrgID:     orgID,
		UserID:    userID,
		Role:      "org_admin",
		Status:    "active",
		CreatedAt: now,
	}
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "org_id"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"role", "status"}),
	}).Create(&member).Error
}

// --- Memberships ---------------------------------------------------------

type MembershipRow struct {
	OrgID   string
	OrgName string
	Role    string
	Status  string
}

func (s *Store) ListUserMemberships(ctx context.Context, userID string) ([]MembershipRow, error) {
	var rows []MembershipRow
	err := s.db.WithContext(ctx).
		Table("organization_members AS m").
		Select("m.org_id, o.name AS org_name, m.role, m.status").
		Joins("JOIN organizations o ON o.id = m.org_id").
		Where("m.user_id = ?", userID).
		Order("m.created_at").
		Scan(&rows).Error
	return rows, err
}

// ActiveMembership returns the user's single active membership for orgID, or
// ErrNotFound. Used to resolve the JWT org_role for a bound session.
func (s *Store) ActiveMembership(ctx context.Context, userID, orgID string) (MembershipRow, error) {
	var row MembershipRow
	err := s.db.WithContext(ctx).
		Table("organization_members AS m").
		Select("m.org_id, o.name AS org_name, m.role, m.status").
		Joins("JOIN organizations o ON o.id = m.org_id").
		Where("m.user_id = ? AND m.org_id = ? AND m.status = 'active'", userID, orgID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MembershipRow{}, ErrNotFound
	}
	return row, err
}

type OrgMemberRow struct {
	UserID          string
	Account         string
	DisplayName     string
	Email           string
	Role            string
	Status          string
	ReviewedBy      *string
	ReviewedAt      *time.Time
	RejectionReason *string
	CreatedAt       time.Time
}

// ListOrgMembers lists members of an org. An empty statusFilter returns all.
func (s *Store) ListOrgMembers(ctx context.Context, orgID, statusFilter string) ([]OrgMemberRow, error) {
	q := s.db.WithContext(ctx).
		Table("organization_members AS m").
		Select("m.user_id, u.account, u.display_name, u.email, m.role, m.status, m.reviewed_by, m.reviewed_at, m.rejection_reason, m.created_at").
		Joins("JOIN users u ON u.id = m.user_id").
		Where("m.org_id = ?", orgID)
	if statusFilter != "" {
		q = q.Where("m.status = ?", statusFilter)
	}
	var rows []OrgMemberRow
	err := q.Order("m.created_at DESC").Scan(&rows).Error
	return rows, err
}

// MemberRoleStatus returns (role, status) for a membership, used to authorize an
// actor against the DB (never trust request body or a stale JWT role).
func (s *Store) MemberRoleStatus(ctx context.Context, orgID, userID string) (string, string, error) {
	var row struct {
		Role   string
		Status string
	}
	err := s.db.WithContext(ctx).
		Model(&model.OrganizationMember{}).
		Select("role, status").
		Where("org_id = ? AND user_id = ?", orgID, userID).
		Scan(&row).Error
	if err != nil {
		return "", "", err
	}
	if row.Status == "" {
		return "", "", ErrNotFound
	}
	return row.Role, row.Status, nil
}

// ApplyMembership starts (none) or restarts (rejected) an application, landing
// the user in `pending`. A pending/active membership is a conflict.
func (s *Store) ApplyMembership(ctx context.Context, orgID, userID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var member model.OrganizationMember
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("org_id = ? AND user_id = ?", orgID, userID).
			First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&model.OrganizationMember{
				OrgID:     orgID,
				UserID:    userID,
				Role:      "member",
				Status:    "pending",
				CreatedAt: now,
			}).Error
		}
		if err != nil {
			return err
		}
		if member.Status != "rejected" {
			return ErrConflict // already pending or active
		}
		return tx.Model(&model.OrganizationMember{}).
			Where("org_id = ? AND user_id = ? AND status = 'rejected'", orgID, userID).
			Updates(map[string]any{
				"status":           "pending",
				"reviewed_by":      nil,
				"reviewed_at":      nil,
				"rejection_reason": nil,
			}).Error
	})
}

// ApproveMembership: pending -> active (conditional; concurrent loser -> conflict).
func (s *Store) ApproveMembership(ctx context.Context, orgID, userID, reviewerID string) error {
	now := time.Now().UTC()
	res := s.db.WithContext(ctx).
		Model(&model.OrganizationMember{}).
		Where("org_id = ? AND user_id = ? AND status = 'pending'", orgID, userID).
		Updates(map[string]any{
			"status":           "active",
			"reviewed_by":      reviewerID,
			"reviewed_at":      now,
			"rejection_reason": nil,
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

// RejectMembership: pending -> rejected (keeps the row + reviewer/reason so the
// user can reapply). Conditional; concurrent loser -> conflict.
func (s *Store) RejectMembership(ctx context.Context, orgID, userID, reviewerID, reason string) error {
	now := time.Now().UTC()
	updates := map[string]any{
		"status":      "rejected",
		"reviewed_by": reviewerID,
		"reviewed_at": now,
	}
	if reason != "" {
		updates["rejection_reason"] = reason
	}
	res := s.db.WithContext(ctx).
		Model(&model.OrganizationMember{}).
		Where("org_id = ? AND user_id = ? AND status = 'pending'", orgID, userID).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

// SetMemberRole changes an active member's org role, enforcing invariants in
// the transaction: the owner cannot be demoted, and an org must always keep at
// least one active org_admin.
func (s *Store) SetMemberRole(ctx context.Context, orgID, userID, role string) error {
	if role != "org_admin" && role != "member" {
		return ErrInvariant
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var org model.Organization
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", orgID).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		var member model.OrganizationMember
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("org_id = ? AND user_id = ?", orgID, userID).
			First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if member.Status != "active" {
			return ErrInvariant // only active members carry an effective role
		}
		if member.Role == role {
			return nil
		}
		if role == "member" {
			if org.OwnerUserID == userID {
				return ErrInvariant // owner must remain org_admin; transfer first
			}
			var admins int64
			if err := tx.Model(&model.OrganizationMember{}).
				Where("org_id = ? AND role = 'org_admin' AND status = 'active'", orgID).
				Count(&admins).Error; err != nil {
				return err
			}
			if admins <= 1 {
				return ErrInvariant // would remove the last active org_admin
			}
		}
		return tx.Model(&model.OrganizationMember{}).
			Where("org_id = ? AND user_id = ? AND status = 'active'", orgID, userID).
			Update("role", role).Error
	})
}

func (s *Store) RemoveRolePreservingSuperAdmin(ctx context.Context, userID, roleID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var role model.Role
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", roleID).First(&role).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if role.Name == "super_admin" {
			var count int64
			if err := tx.Table("user_roles AS ur").
				Joins("JOIN users u ON u.id = ur.user_id").
				Where("ur.role_id = ? AND u.disabled_at IS NULL", roleID).
				Count(&count).Error; err != nil {
				return err
			}
			if count <= 1 {
				return ErrInvariant
			}
		}
		res := tx.Where("user_id = ? AND role_id = ?", userID, roleID).Delete(&model.UserRole{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrNotFound
		}
		return revokeRefreshTokens(tx, userID)
	})
}

func (s *Store) RevokeUserRefreshTokens(ctx context.Context, userID string) error {
	return revokeRefreshTokens(s.db.WithContext(ctx), userID)
}

func revokeRefreshTokens(tx *gorm.DB, userID string) error {
	now := time.Now().UTC()
	return tx.Model(&model.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
}

// RecordAudit appends one immutable audit row. Callers pre-fill the record
// (including ID); this never updates or deletes existing rows.
func (s *Store) RecordAudit(ctx context.Context, event model.IamAuditEvent) error {
	return s.db.WithContext(ctx).Create(&event).Error
}

// Match SQLSTATE + constraint name because driver error text is locale-dependent.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
