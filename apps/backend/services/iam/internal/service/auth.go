package service

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"net/http"
	"strings"
	"time"

	"github.com/example/monorepo/iam/internal/config"
	"github.com/example/monorepo/iam/internal/crud"
	"github.com/example/monorepo/iam/internal/model"
	"github.com/example/monorepo/iam/internal/schema"
	"github.com/example/monorepo/iam/internal/security"
)

type AuthService struct {
	store *crud.Store
	cfg   config.Config
}

func NewAuthService(store *crud.Store, cfg config.Config) *AuthService {
	return &AuthService{store: store, cfg: cfg}
}

func (s *AuthService) Register(ctx context.Context, req schema.AuthRequest, meta RequestMeta) (schema.AuthResponse, string, time.Time, error) {
	req.Account = NormalizeAccount(req.Account)
	req.Email = NormalizeEmail(req.Email)
	if !ValidAccount(req.Account) || len(req.Password) < 6 {
		return schema.AuthResponse{}, "", time.Time{}, ErrInvalidRegistration
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = req.Account
	}
	passwordHash, err := security.HashPassword(req.Password)
	if err != nil {
		return schema.AuthResponse{}, "", time.Time{}, err
	}
	now := time.Now().UTC()
	user := model.User{
		ID:              NewID(),
		Account:         req.Account,
		Email:           req.Email,
		EmailNormalized: req.Email,
		DisplayName:     displayName,
		Locale:          Fallback(req.Locale, "zh-CN"),
		Timezone:        Fallback(req.Timezone, "Asia/Shanghai"),
		Theme:           "system",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.store.CreateUserWithPassword(ctx, user, passwordHash); err != nil {
		return schema.AuthResponse{}, "", time.Time{}, ErrConflict
	}
	return s.IssueSession(ctx, user, meta)
}

func (s *AuthService) Login(ctx context.Context, req schema.AuthRequest, meta RequestMeta) (schema.AuthResponse, string, time.Time, error) {
	user, passwordHash, err := s.store.UserByAccount(ctx, NormalizeAccount(req.Account))
	if err != nil || !security.VerifyPassword(passwordHash, req.Password) {
		return schema.AuthResponse{}, "", time.Time{}, ErrInvalidCredentials
	}
	_ = s.store.MarkLogin(ctx, user.ID)
	return s.IssueSession(ctx, user, meta)
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string, meta RequestMeta) (schema.AuthResponse, string, time.Time, error) {
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		return schema.AuthResponse{}, "", time.Time{}, err
	}
	expiresAt := time.Now().UTC().Add(s.cfg.RefreshTokenTTL)
	next := model.RefreshToken{
		ID:        NewID(),
		TokenHash: digest,
		UserAgent: meta.UserAgent,
		IPAddress: meta.IPAddress,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now().UTC(),
	}
	user, err := s.store.RotateRefreshToken(ctx, security.DigestToken(refreshToken), next)
	if err != nil {
		return schema.AuthResponse{}, "", time.Time{}, ErrInvalidRefreshToken
	}
	response, err := s.AuthResponse(user)
	if err != nil {
		return schema.AuthResponse{}, "", time.Time{}, err
	}
	return response, plain, expiresAt, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) {
	if refreshToken != "" {
		_ = s.store.RevokeRefreshToken(ctx, security.DigestToken(refreshToken))
	}
}

func (s *AuthService) Me(ctx context.Context, userID string) (schema.UserResponse, error) {
	user, err := s.store.UserByID(ctx, userID)
	if err != nil {
		return schema.UserResponse{}, ErrInvalidSubject
	}
	return UserResponse(user), nil
}

func (s *AuthService) IssueSession(ctx context.Context, user model.User, meta RequestMeta) (schema.AuthResponse, string, time.Time, error) {
	plain, digest, err := security.NewOpaqueToken()
	if err != nil {
		return schema.AuthResponse{}, "", time.Time{}, err
	}
	refreshExpiresAt := time.Now().UTC().Add(s.cfg.RefreshTokenTTL)
	token := model.RefreshToken{
		ID:        NewID(),
		UserID:    user.ID,
		TokenHash: digest,
		UserAgent: meta.UserAgent,
		IPAddress: meta.IPAddress,
		ExpiresAt: refreshExpiresAt,
		CreatedAt: time.Now().UTC(),
	}
	if err := s.store.CreateRefreshToken(ctx, token); err != nil {
		return schema.AuthResponse{}, "", time.Time{}, err
	}
	response, err := s.AuthResponse(user)
	if err != nil {
		return schema.AuthResponse{}, "", time.Time{}, err
	}
	return response, plain, refreshExpiresAt, nil
}

func (s *AuthService) AuthResponse(user model.User) (schema.AuthResponse, error) {
	expiresAt := time.Now().UTC().Add(s.cfg.AccessTokenTTL)
	token, err := security.SignAccessToken(s.cfg.AccessTokenSecret, security.Claims{
		Subject: user.ID,
		Email:   user.Email,
		Name:    user.DisplayName,
		Issued:  time.Now().UTC().Unix(),
		Expiry:  expiresAt.Unix(),
	})
	if err != nil {
		return schema.AuthResponse{}, err
	}
	return schema.AuthResponse{AccessToken: token, ExpiresAt: expiresAt, User: UserResponse(user)}, nil
}

func UserResponse(user model.User) schema.UserResponse {
	return schema.UserResponse{
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
	}
}

type RequestMeta struct {
	UserAgent string
	IPAddress string
}

func RequestMetaFromHTTP(r *http.Request) RequestMeta {
	return RequestMeta{UserAgent: UserAgent(r), IPAddress: ClientIP(r)}
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func NormalizeAccount(account string) string {
	return strings.ToLower(strings.TrimSpace(account))
}

func ValidAccount(account string) bool {
	if account == "" || len(account) > 64 {
		return false
	}
	return !strings.ContainsAny(account, " \t\r\n@")
}

func Fallback(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}
