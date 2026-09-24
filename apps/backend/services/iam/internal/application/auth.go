package application

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/application/contracts"
	"github.com/example/monorepo/iam/internal/bootstrap/config"
	"github.com/example/monorepo/iam/internal/domain"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/models"
	"github.com/example/monorepo/iam/internal/infrastructure/persistence/repositories"
	"github.com/example/monorepo/iam/internal/infrastructure/security"
)

type AuthService struct {
	store *repositories.Store
	cfg   config.ServerConfig
}

func NewAuthService(store *repositories.Store, cfg config.ServerConfig) *AuthService {
	return &AuthService{store: store, cfg: cfg}
}

func (s *AuthService) AccountAvailability(ctx context.Context, value string) (string, bool, error) {
	account := domain.NormalizeAccount(value)
	if !domain.ValidAccount(account) {
		return "", false, ErrInvalidAccount
	}
	exists, err := s.store.UserExistsByAccount(ctx, account)
	return account, !exists, err
}

func (s *AuthService) Register(ctx context.Context, req contracts.AuthRequest, meta RequestMeta) (contracts.AuthResponse, string, time.Time, error) {
	req.Account = domain.NormalizeAccount(req.Account)
	req.Email = domain.NormalizeEmail(req.Email)
	workspaceID := strings.TrimSpace(req.WorkspaceID)
	if !domain.ValidAccount(req.Account) || !domain.ValidEmail(req.Email) || len(req.Password) < 6 {
		return contracts.AuthResponse{}, "", time.Time{}, ErrInvalidRegistration
	}
	if workspaceID != "" && workspaceID != s.cfg.GuestWorkspaceID {
		workspace, err := s.store.WorkspaceByID(ctx, workspaceID)
		if err == nil && (workspace.SystemManaged || workspace.JoinPolicy != "approval") {
			return contracts.AuthResponse{}, "", time.Time{}, ErrInvalidWorkspace
		}
		if errors.Is(err, repositories.ErrNotFound) {
			return contracts.AuthResponse{}, "", time.Time{}, ErrWorkspaceNotFound
		}
		if err != nil {
			return contracts.AuthResponse{}, "", time.Time{}, err
		}
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = req.Account
	}
	passwordHash, err := security.HashPassword(req.Password)
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	now := time.Now().UTC()
	user := models.User{
		ID:              NewID(),
		Account:         req.Account,
		Email:           req.Email,
		EmailNormalized: req.Email,
		DisplayName:     displayName,
		AvatarURL:       strings.TrimSpace(req.AvatarURL),
		Phone:           strings.TrimSpace(req.PhoneNumber),
		Locale:          domain.Fallback(req.Locale, "zh-CN"),
		Timezone:        domain.Fallback(req.Timezone, "Asia/Shanghai"),
		Theme:           "system",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.store.CreateRegisteredUser(ctx, user, passwordHash, s.cfg.GuestWorkspaceID, workspaceID); err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, ErrConflict
	}
	return s.IssueSession(ctx, user, meta)
}

func (s *AuthService) Login(ctx context.Context, req contracts.AuthRequest, meta RequestMeta) (contracts.AuthResponse, string, time.Time, error) {
	user, passwordHash, err := s.store.UserByAccount(ctx, domain.NormalizeAccount(req.Account))
	if err != nil || !security.VerifyPassword(passwordHash, req.Password) {
		return contracts.AuthResponse{}, "", time.Time{}, ErrInvalidCredentials
	}
	_ = s.store.MarkLogin(ctx, user.ID)
	return s.IssueSession(ctx, user, meta)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string, meta RequestMeta) (contracts.AuthResponse, string, time.Time, error) {
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	expiresAt := time.Now().UTC().Add(s.cfg.RefreshTokenTTL)
	next := models.RefreshToken{
		ID:        NewID(),
		TokenHash: digest,
		UserAgent: meta.UserAgent,
		IPAddress: meta.IPAddress,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now().UTC(),
	}
	user, activeWorkspaceID, err := s.store.RotateRefreshToken(ctx, security.DigestToken(refreshToken), next)
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, ErrInvalidRefreshToken
	}
	response, err := s.AuthResponse(ctx, user, activeWorkspaceID)
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	return response, plain, expiresAt, nil
}

// SwitchActiveWorkspace rotates the session onto a different active workspace after
// verifying the caller has an active membership there.
func (s *AuthService) SwitchActiveWorkspace(ctx context.Context, refreshToken, workspaceID, expectedUserID string, meta RequestMeta, auditMeta AuditMeta) (contracts.AuthResponse, string, time.Time, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return contracts.AuthResponse{}, "", time.Time{}, ErrInvalidWorkspace
	}
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	expiresAt := time.Now().UTC().Add(s.cfg.RefreshTokenTTL)
	next := models.RefreshToken{
		ID:        NewID(),
		TokenHash: digest,
		UserAgent: meta.UserAgent,
		IPAddress: meta.IPAddress,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now().UTC(),
	}
	var user models.User
	err = mutateWithAudit(ctx, s.store, auditEntry{
		Action: "session.active_workspace.switch", Actor: expectedUserID, Target: expectedUserID,
		Workspace: workspaceID, After: map[string]any{"activeWorkspaceId": workspaceID}, Trace: auditMeta.TraceID,
	}, func(txStore *repositories.Store) error {
		var rotateErr error
		user, rotateErr = txStore.RotateRefreshTokenToWorkspace(ctx, security.DigestToken(refreshToken), next, workspaceID, expectedUserID)
		return rotateErr
	})
	if errors.Is(err, repositories.ErrNotActiveMember) {
		return contracts.AuthResponse{}, "", time.Time{}, ErrNotActiveMember
	}
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, ErrInvalidRefreshToken
	}
	response, err := s.AuthResponse(ctx, user, &workspaceID)
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	return response, plain, expiresAt, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken != "" {
		return s.store.RevokeRefreshToken(ctx, security.DigestToken(refreshToken))
	}
	return nil
}

// Me reflects the current session's active workspace (from the access-token claim)
// plus the latest memberships — the waiting page polls it to observe approval.
func (s *AuthService) Me(ctx context.Context, userID, activeWorkspaceID string) (contracts.UserResponse, error) {
	user, err := s.store.UserByID(ctx, userID)
	if err != nil {
		return contracts.UserResponse{}, ErrInvalidSubject
	}
	var active *string
	if activeWorkspaceID != "" {
		active = &activeWorkspaceID
	}
	return s.buildUserResponse(ctx, user, active)
}

func (s *AuthService) Memberships(ctx context.Context, userID string) ([]contracts.Membership, error) {
	rows, err := s.store.ListUserMemberships(ctx, userID)
	if err != nil {
		return nil, err
	}
	return membershipsFromRows(rows), nil
}

func (s *AuthService) IssueSession(ctx context.Context, user models.User, meta RequestMeta) (contracts.AuthResponse, string, time.Time, error) {
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	activeWorkspaceID, err := s.resolveInitialActiveWorkspace(ctx, user.ID)
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	refreshExpiresAt := time.Now().UTC().Add(s.cfg.RefreshTokenTTL)
	token := models.RefreshToken{
		ID:                NewID(),
		UserID:            user.ID,
		ActiveWorkspaceID: activeWorkspaceID,
		TokenHash:         digest,
		UserAgent:         meta.UserAgent,
		IPAddress:         meta.IPAddress,
		ExpiresAt:         refreshExpiresAt,
		CreatedAt:         time.Now().UTC(),
	}
	if err := s.store.CreateRefreshToken(ctx, token); err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	response, err := s.AuthResponse(ctx, user, activeWorkspaceID)
	if err != nil {
		return contracts.AuthResponse{}, "", time.Time{}, err
	}
	return response, plain, refreshExpiresAt, nil
}

// resolveInitialActiveWorkspace binds the session at login/register: 0 active
// memberships → unscoped; exactly 1 → that workspace; more than 1 → unscoped so the
// frontend forces an explicit choice. The DB never picks on the user's behalf.
func (s *AuthService) resolveInitialActiveWorkspace(ctx context.Context, userID string) (*string, error) {
	rows, err := s.store.ListUserMemberships(ctx, userID)
	if err != nil {
		return nil, err
	}
	var active []string
	for _, row := range rows {
		if row.Status == "active" {
			active = append(active, row.WorkspaceID)
		}
	}
	if len(active) == 1 {
		id := active[0]
		return &id, nil
	}
	return nil, nil
}

func (s *AuthService) AuthResponse(ctx context.Context, user models.User, activeWorkspaceID *string) (contracts.AuthResponse, error) {
	expiresAt := time.Now().UTC().Add(s.cfg.AccessTokenTTL)
	resp, err := s.buildUserResponse(ctx, user, activeWorkspaceID)
	if err != nil {
		return contracts.AuthResponse{}, err
	}
	claims := security.Claims{
		Subject: user.ID,
		Email:   user.Email,
		Name:    user.DisplayName,
		Roles:   resp.Roles,
		Issued:  time.Now().UTC().Unix(),
		Expiry:  expiresAt.Unix(),
	}
	if resp.ActiveWorkspace != nil {
		claims.TenantID = resp.ActiveWorkspace.TenantID
		claims.WorkspaceID = resp.ActiveWorkspace.WorkspaceID
		claims.WorkspaceRole = resp.ActiveWorkspace.Role
	}
	token, err := security.SignAccessToken(s.cfg.AccessTokenSecret, claims)
	if err != nil {
		return contracts.AuthResponse{}, err
	}
	return contracts.AuthResponse{AccessToken: token, ExpiresAt: expiresAt, User: resp}, nil
}

// buildUserResponse assembles the two-dimensional identity: platform roles,
// every membership, and the single activeWorkspace the session is bound to (only when
// that membership is still active).
func (s *AuthService) buildUserResponse(ctx context.Context, user models.User, activeWorkspaceID *string) (contracts.UserResponse, error) {
	roles, err := s.userRoleNames(ctx, user.ID)
	if err != nil {
		return contracts.UserResponse{}, err
	}
	resp := contracts.UserResponse{
		ID:             user.ID,
		Account:        user.Account,
		Email:          user.Email,
		DisplayName:    user.DisplayName,
		AvatarURL:      user.AvatarURL,
		Locale:         user.Locale,
		Timezone:       user.Timezone,
		Theme:          user.Theme,
		MarketingOptIn: user.MarketingOptIn,
		EmailVerified:  user.EmailVerifiedAt != nil,
		Roles:          roles,
	}
	rows, err := s.store.ListUserMemberships(ctx, user.ID)
	if err != nil {
		return contracts.UserResponse{}, err
	}
	resp.Memberships = membershipsFromRows(rows)
	if activeWorkspaceID != nil {
		for _, m := range resp.Memberships {
			if m.WorkspaceID == *activeWorkspaceID && m.Status == "active" {
				active := m
				resp.ActiveWorkspace = &active
				break
			}
		}
	}
	return resp, nil
}

// userRoleNames returns the user's platform role names for the access-token
// `roles` claim; downstream services derive authorization from it (no service
// re-queries iam).
func (s *AuthService) userRoleNames(ctx context.Context, userID string) ([]string, error) {
	roles, err := s.store.UserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(roles))
	for _, role := range roles {
		names = append(names, role.Name)
	}
	return names, nil
}

func membershipsFromRows(rows []repositories.MembershipRow) []contracts.Membership {
	out := make([]contracts.Membership, 0, len(rows))
	for _, row := range rows {
		out = append(out, contracts.Membership{
			TenantID:      row.TenantID,
			WorkspaceID:   row.WorkspaceID,
			WorkspaceName: row.WorkspaceName,
			Role:          row.Role,
			Status:        row.Status,
		})
	}
	return out
}

type RequestMeta struct {
	UserAgent string
	IPAddress string
}

func RequestMetaFromHTTP(r *http.Request) RequestMeta {
	return RequestMeta{UserAgent: UserAgent(r), IPAddress: ClientIP(r)}
}

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}
