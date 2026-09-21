package repositories

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/example/monorepo/iam/internal/infrastructure/persistence/models"
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
	// ErrNotActiveMember: the target workspace is not an active membership of the user.
	ErrNotActiveMember = errors.New("not an active member")
	// ErrInvariant: the operation would break a hard invariant (last workspace_admin,
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

// CreateUserWithMembership atomically creates the user, credential, and a single
// membership. Register uses (member, pending); workspace-admin creation uses
// (workspace_admin, active). A bad workspaceID fails the FK and rolls the whole thing back.
func (s *Store) CreateUserWithMembership(ctx context.Context, user models.User, passwordHash, guestWorkspaceID, workspaceID, role, status string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.WorkspaceMember{
			WorkspaceID: guestWorkspaceID,
			UserID:      user.ID,
			Role:        "member",
			Status:      "active",
			CreatedAt:   now,
		}).Error; err != nil {
			return err
		}
		if workspaceID == guestWorkspaceID {
			return tx.Model(&models.WorkspaceMember{}).
				Where("workspace_id = ? AND user_id = ?", workspaceID, user.ID).
				Updates(map[string]any{"role": role, "status": status}).Error
		}
		return tx.Create(&models.WorkspaceMember{
			WorkspaceID: workspaceID,
			UserID:      user.ID,
			Role:        role,
			Status:      status,
			CreatedAt:   now,
		}).Error
	})
}

func (s *Store) CreateRegisteredUser(ctx context.Context, user models.User, passwordHash, guestWorkspaceID, targetWorkspaceID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.UserCredential{
			UserID: user.ID, PasswordHash: passwordHash, PasswordChangedAt: now,
			CreatedAt: now, UpdatedAt: now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.WorkspaceMember{
			WorkspaceID: guestWorkspaceID, UserID: user.ID, Role: "member", Status: "active", CreatedAt: now,
		}).Error; err != nil {
			return err
		}
		if targetWorkspaceID == "" || targetWorkspaceID == guestWorkspaceID {
			return nil
		}
		return tx.Create(&models.WorkspaceMember{
			WorkspaceID: targetWorkspaceID, UserID: user.ID, Role: "member", Status: "pending", CreatedAt: now,
		}).Error
	})
}

func (s *Store) EnsureUserWithPassword(ctx context.Context, user models.User, passwordHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"email", "email_normalized", "display_name", "updated_at"}),
		}).Create(&user).Error
		if err != nil && isUniqueViolation(err, "uq_users_email_normalized") {
			err = tx.Model(&models.User{}).
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
		credential := models.UserCredential{
			UserID:            user.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&credential).Error
	})
}

func (s *Store) UserByAccount(ctx context.Context, account string) (models.User, string, error) {
	var credential models.UserCredential
	err := s.db.WithContext(ctx).
		Joins("User").
		// "User" must stay quoted: USER is a reserved word in PostgreSQL.
		Where(`"User".account = ? AND "User".disabled_at IS NULL`, account).
		First(&credential).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, "", ErrNotFound
	}
	return credential.User, credential.PasswordHash, err
}

func (s *Store) UserExistsByAccount(ctx context.Context, account string) (bool, error) {
	var count int64
	err := s.db.WithContext(ctx).
		Model(&models.User{}).
		Where("account = ? AND disabled_at IS NULL", account).
		Count(&count).Error
	return count > 0, err
}

func (s *Store) UserByID(ctx context.Context, id string) (models.User, error) {
	var user models.User
	err := s.db.WithContext(ctx).
		Where("id = ? AND disabled_at IS NULL", id).
		First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, ErrNotFound
	}
	return user, err
}

func (s *Store) CreateRefreshToken(ctx context.Context, token models.RefreshToken) error {
	return s.db.WithContext(ctx).Create(&token).Error
}

// RotateRefreshToken rotates the session, carrying the old token's active_workspace_id
// forward — but only if that membership is STILL active. A revoked/downgraded
// membership drops the workspace scope so the next access token is unscoped. Returns
// the user and the effective active workspace (nil when unscoped).
func (s *Store) RotateRefreshToken(ctx context.Context, oldHash string, next models.RefreshToken) (models.User, *string, error) {
	var user models.User
	var activeWorkspaceID *string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		old, err := lockValidToken(tx, oldHash, now)
		if err != nil {
			return err
		}
		carried := old.ActiveWorkspaceID
		if carried != nil {
			status, err := memberStatus(tx, *carried, old.UserID)
			if err != nil {
				return err
			}
			if status != "active" {
				carried = nil
			}
		}
		next.ActiveWorkspaceID = carried
		user, err = rotateSession(tx, &old, &next, now)
		if err != nil {
			return err
		}
		activeWorkspaceID = carried
		return nil
	})
	return user, activeWorkspaceID, err
}

// RotateRefreshTokenToWorkspace rotates the session and binds it to targetWorkspaceID after
// verifying (inside the transaction) that it is an active membership.
func (s *Store) RotateRefreshTokenToWorkspace(ctx context.Context, oldHash string, next models.RefreshToken, targetWorkspaceID, expectedUserID string) (models.User, error) {
	var user models.User
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		old, err := lockValidToken(tx, oldHash, now)
		if err != nil {
			return err
		}
		if old.UserID != expectedUserID {
			return ErrNotFound
		}
		status, err := memberStatus(tx, targetWorkspaceID, old.UserID)
		if err != nil {
			return err
		}
		if status != "active" {
			return ErrNotActiveMember
		}
		workspace := targetWorkspaceID
		next.ActiveWorkspaceID = &workspace
		user, err = rotateSession(tx, &old, &next, now)
		return err
	})
	return user, err
}

func lockValidToken(tx *gorm.DB, hash string, now time.Time) (models.RefreshToken, error) {
	var old models.RefreshToken
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("token_hash = ?", hash).
		First(&old).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.RefreshToken{}, ErrNotFound
	}
	if err != nil {
		return models.RefreshToken{}, err
	}
	if old.RevokedAt != nil || !old.ExpiresAt.After(now) {
		return models.RefreshToken{}, ErrNotFound
	}
	return old, nil
}

func rotateSession(tx *gorm.DB, old *models.RefreshToken, next *models.RefreshToken, now time.Time) (models.User, error) {
	next.UserID = old.UserID
	if err := tx.Create(next).Error; err != nil {
		return models.User{}, err
	}
	old.RevokedAt = &now
	old.LastUsedAt = &now
	old.ReplacedByTokenID = &next.ID
	if err := tx.Save(old).Error; err != nil {
		return models.User{}, err
	}
	var user models.User
	err := tx.Where("id = ? AND disabled_at IS NULL", old.UserID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, ErrNotFound
	}
	return user, err
}

// memberStatus returns the membership status for (workspace, user), or "" if none.
func memberStatus(tx *gorm.DB, workspaceID, userID string) (string, error) {
	var status string
	err := tx.Model(&models.WorkspaceMember{}).
		Select("status").
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
		Scan(&status).Error
	return status, err
}

func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&models.RefreshToken{}).
		Where("token_hash = ? AND revoked_at IS NULL", tokenHash).
		Update("revoked_at", now).Error
}

func (s *Store) MarkLogin(ctx context.Context, userID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", userID).
		Updates(map[string]any{"last_login_at": now, "updated_at": now}).Error
}

func (s *Store) EnsureRole(ctx context.Context, role models.Role) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{"description", "updated_at"}),
	}).Create(&role).Error
}

func (s *Store) RoleByName(ctx context.Context, name string) (models.Role, error) {
	var role models.Role
	err := s.db.WithContext(ctx).Where("name = ?", name).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Role{}, ErrNotFound
	}
	return role, err
}

func (s *Store) ListRoles(ctx context.Context) ([]models.Role, error) {
	var roles []models.Role
	err := s.db.WithContext(ctx).Order("name").Find(&roles).Error
	return roles, err
}

func (s *Store) AssignRole(ctx context.Context, userID, roleID string) error {
	userRole := models.UserRole{
		UserID:    userID,
		RoleID:    roleID,
		CreatedAt: time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&userRole).Error
}

func (s *Store) UserRoles(ctx context.Context, userID string) ([]models.Role, error) {
	var roles []models.Role
	err := s.db.WithContext(ctx).
		Table("roles").
		Select("roles.*").
		Joins("JOIN user_roles ON user_roles.role_id = roles.id").
		Where("user_roles.user_id = ?", userID).
		Order("roles.name").
		Find(&roles).Error
	return roles, err
}

func (s *Store) EnsureWorkspace(ctx context.Context, workspace models.Workspace) error {
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "slug", "owner_user_id", "system_managed", "system_key", "join_policy", "updated_at"}),
	}).Create(&workspace).Error
}

func (s *Store) EnsureAllUsersInGuestWorkspace(ctx context.Context, workspaceID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at)
		SELECT ?, u.id, 'member', 'active', ? FROM users u
		LEFT JOIN workspace_members m ON m.workspace_id = ? AND m.user_id = u.id
		WHERE m.user_id IS NULL`, workspaceID, now, workspaceID).Error
}

// EnsureWorkspaceMember upserts a membership at a fixed role/status. Used by seed to
// keep the system super_admin an active workspace_admin idempotently.
func (s *Store) EnsureWorkspaceMember(ctx context.Context, workspaceID, userID, role, status string) error {
	member := models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        role,
		Status:      status,
		CreatedAt:   time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "workspace_id"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"role", "status"}),
	}).Create(&member).Error
}

// --- Platform roles ------------------------------------------------------

func (s *Store) RoleByID(ctx context.Context, id string) (models.Role, error) {
	var role models.Role
	err := s.db.WithContext(ctx).Where("id = ?", id).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Role{}, ErrNotFound
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

// --- Workspaces -------------------------------------------------------

func (s *Store) WorkspaceByID(ctx context.Context, id string) (models.Workspace, error) {
	var workspace models.Workspace
	err := s.db.WithContext(ctx).Where("id = ?", id).First(&workspace).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Workspace{}, ErrNotFound
	}
	return workspace, err
}

// ListWorkspaces returns every workspace ordered by name. The public endpoint maps
// this down to {id,name}; management uses ListWorkspacesForAdmin.
func (s *Store) ListWorkspaces(ctx context.Context) ([]models.Workspace, error) {
	var workspaces []models.Workspace
	err := s.db.WithContext(ctx).
		Where("system_managed = ? AND join_policy = ?", false, "approval").
		Order("name").Find(&workspaces).Error
	return workspaces, err
}

type WorkspaceAdminRow struct {
	TenantID      string
	ID            string
	Name          string
	Slug          string
	OwnerUserID   string
	SystemManaged bool
	JoinPolicy    string
	MemberCount   int64
	CreatedAt     time.Time
}

func (s *Store) ListWorkspacesForAdmin(ctx context.Context) ([]WorkspaceAdminRow, error) {
	var rows []WorkspaceAdminRow
	err := s.db.WithContext(ctx).
		Table("workspaces AS o").
		Select("o.tenant_id, o.id, o.name, o.slug, o.owner_user_id, o.system_managed, o.join_policy, o.created_at, " +
			"(SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = o.id AND m.status = 'active') AS member_count").
		Order("o.created_at DESC").
		Scan(&rows).Error
	return rows, err
}

// CreateWorkspaceWithOwner creates an workspace whose first member is an existing
// user, made an active workspace_admin/owner in one transaction.
func (s *Store) CreateWorkspaceWithOwner(ctx context.Context, workspace models.Workspace, ownerUserID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&workspace).Error; err != nil {
			return err
		}
		return upsertActiveWorkspaceAdmin(tx, workspace.ID, ownerUserID, now)
	})
}

// CreateWorkspaceWithNewOwner atomically creates the owner account, the workspace,
// and the owner's active workspace_admin membership.
func (s *Store) CreateWorkspaceWithNewOwner(ctx context.Context, workspace models.Workspace, owner models.User, passwordHash, guestWorkspaceID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&owner).Error; err != nil {
			return err
		}
		if err := tx.Create(&models.UserCredential{
			UserID:            owner.ID,
			PasswordHash:      passwordHash,
			PasswordChangedAt: now,
			CreatedAt:         now,
			UpdatedAt:         now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Create(&workspace).Error; err != nil {
			return err
		}
		if err := upsertActiveWorkspaceAdmin(tx, workspace.ID, owner.ID, now); err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.WorkspaceMember{
			WorkspaceID: guestWorkspaceID, UserID: owner.ID, Role: "member", Status: "active", CreatedAt: now,
		}).Error
	})
}

// TransferOwner moves ownership to newOwnerUserID inside one transaction: lock
// the workspace, promote the target to active workspace_admin, then repoint owner. The old
// owner keeps workspace_admin (may be demoted afterwards via the role API).
func (s *Store) TransferOwner(ctx context.Context, workspaceID, newOwnerUserID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var workspace models.Workspace
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", workspaceID).First(&workspace).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		if workspace.SystemManaged {
			return ErrInvariant
		}
		var member models.WorkspaceMember
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("workspace_id = ? AND user_id = ?", workspaceID, newOwnerUserID).
			First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvariant // new owner must already be a member of this workspace
		}
		if err != nil {
			return err
		}
		if err := upsertActiveWorkspaceAdmin(tx, workspaceID, newOwnerUserID, now); err != nil {
			return err
		}
		return tx.Model(&models.Workspace{}).
			Where("id = ?", workspaceID).
			Updates(map[string]any{"owner_user_id": newOwnerUserID, "updated_at": now}).Error
	})
}

func upsertActiveWorkspaceAdmin(tx *gorm.DB, workspaceID, userID string, now time.Time) error {
	member := models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        "workspace_admin",
		Status:      "active",
		CreatedAt:   now,
	}
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "workspace_id"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"role", "status"}),
	}).Create(&member).Error
}

// --- Memberships ---------------------------------------------------------

type MembershipRow struct {
	TenantID      string
	WorkspaceID   string
	WorkspaceName string
	Role          string
	Status        string
}

func (s *Store) ListUserMemberships(ctx context.Context, userID string) ([]MembershipRow, error) {
	var rows []MembershipRow
	err := s.db.WithContext(ctx).
		Table("workspace_members AS m").
		Select("o.tenant_id, m.workspace_id, o.name AS workspace_name, m.role, m.status").
		Joins("JOIN workspaces o ON o.id = m.workspace_id").
		Where("m.user_id = ?", userID).
		Order("m.created_at").
		Scan(&rows).Error
	return rows, err
}

// ActiveMembership returns the user's single active membership for workspaceID, or
// ErrNotFound. Used to resolve the JWT workspace_role for a bound session.
func (s *Store) ActiveMembership(ctx context.Context, userID, workspaceID string) (MembershipRow, error) {
	var row MembershipRow
	err := s.db.WithContext(ctx).
		Table("workspace_members AS m").
		Select("o.tenant_id, m.workspace_id, o.name AS workspace_name, m.role, m.status").
		Joins("JOIN workspaces o ON o.id = m.workspace_id").
		Where("m.user_id = ? AND m.workspace_id = ? AND m.status = 'active'", userID, workspaceID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MembershipRow{}, ErrNotFound
	}
	return row, err
}

type WorkspaceMemberRow struct {
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

// ListWorkspaceMembers lists members of an workspace. An empty statusFilter returns all.
func (s *Store) ListWorkspaceMembers(ctx context.Context, workspaceID, statusFilter string) ([]WorkspaceMemberRow, error) {
	q := s.db.WithContext(ctx).
		Table("workspace_members AS m").
		Select("m.user_id, u.account, u.display_name, u.email, m.role, m.status, m.reviewed_by, m.reviewed_at, m.rejection_reason, m.created_at").
		Joins("JOIN users u ON u.id = m.user_id").
		Where("m.workspace_id = ?", workspaceID)
	if statusFilter != "" {
		q = q.Where("m.status = ?", statusFilter)
	}
	var rows []WorkspaceMemberRow
	err := q.Order("m.created_at DESC").Scan(&rows).Error
	return rows, err
}

// MemberRoleStatus returns (role, status) for a membership, used to authorize an
// actor against the DB (never trust request body or a stale JWT role).
func (s *Store) MemberRoleStatus(ctx context.Context, workspaceID, userID string) (string, string, error) {
	var row struct {
		Role   string
		Status string
	}
	err := s.db.WithContext(ctx).
		Model(&models.WorkspaceMember{}).
		Select("role, status").
		Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
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
func (s *Store) ApplyMembership(ctx context.Context, workspaceID, userID string) error {
	now := time.Now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var member models.WorkspaceMember
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
			First(&member).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return tx.Create(&models.WorkspaceMember{
				WorkspaceID: workspaceID,
				UserID:      userID,
				Role:        "member",
				Status:      "pending",
				CreatedAt:   now,
			}).Error
		}
		if err != nil {
			return err
		}
		if member.Status != "rejected" {
			return ErrConflict // already pending or active
		}
		return tx.Model(&models.WorkspaceMember{}).
			Where("workspace_id = ? AND user_id = ? AND status = 'rejected'", workspaceID, userID).
			Updates(map[string]any{
				"status":           "pending",
				"reviewed_by":      nil,
				"reviewed_at":      nil,
				"rejection_reason": nil,
			}).Error
	})
}

// ApproveMembership: pending -> active (conditional; concurrent loser -> conflict).
func (s *Store) ApproveMembership(ctx context.Context, workspaceID, userID, reviewerID string) error {
	now := time.Now().UTC()
	res := s.db.WithContext(ctx).
		Model(&models.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = 'pending'", workspaceID, userID).
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
func (s *Store) RejectMembership(ctx context.Context, workspaceID, userID, reviewerID, reason string) error {
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
		Model(&models.WorkspaceMember{}).
		Where("workspace_id = ? AND user_id = ? AND status = 'pending'", workspaceID, userID).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

// SetMemberRole changes an active member's workspace role, enforcing invariants in
// the transaction: the owner cannot be demoted, and an workspace must always keep at
// least one active workspace_admin.
func (s *Store) SetMemberRole(ctx context.Context, workspaceID, userID, role string) error {
	if role != "workspace_admin" && role != "member" {
		return ErrInvariant
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var workspace models.Workspace
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", workspaceID).First(&workspace).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			return err
		}
		var member models.WorkspaceMember
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("workspace_id = ? AND user_id = ?", workspaceID, userID).
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
			if workspace.OwnerUserID == userID {
				return ErrInvariant // owner must remain workspace_admin; transfer first
			}
			var admins int64
			if err := tx.Model(&models.WorkspaceMember{}).
				Where("workspace_id = ? AND role = 'workspace_admin' AND status = 'active'", workspaceID).
				Count(&admins).Error; err != nil {
				return err
			}
			if admins <= 1 {
				return ErrInvariant // would remove the last active workspace_admin
			}
		}
		return tx.Model(&models.WorkspaceMember{}).
			Where("workspace_id = ? AND user_id = ? AND status = 'active'", workspaceID, userID).
			Update("role", role).Error
	})
}

func (s *Store) RemoveRolePreservingSuperAdmin(ctx context.Context, userID, roleID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var role models.Role
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
		res := tx.Where("user_id = ? AND role_id = ?", userID, roleID).Delete(&models.UserRole{})
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
	return tx.Model(&models.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
}

// RecordAudit appends one immutable audit row. Callers pre-fill the record
// (including ID); this never updates or deletes existing rows.
func (s *Store) RecordAudit(ctx context.Context, event models.IamAuditEvent) error {
	return s.db.WithContext(ctx).Create(&event).Error
}

// Match SQLSTATE + constraint name because driver error text is locale-dependent.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
