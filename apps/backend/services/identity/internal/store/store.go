package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db *sql.DB
}

type User struct {
	ID              string
	Email           string
	DisplayName     string
	AvatarURL       string
	Locale          string
	Timezone        string
	Theme           string
	MarketingOptIn  bool
	EmailVerifiedAt sql.NullTime
	CreatedAt       time.Time
}

type Session struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
}

func Connect(ctx context.Context, databaseURL string) (*Store, error) {
	db, err := sql.Open("mysql", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open mysql: %w", err)
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(5 * time.Minute)
	store := &Store{db: db}
	if err := store.Ping(ctx); err != nil {
		store.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.db.PingContext(ctx)
}

func (s *Store) Close() {
	if s.db != nil {
		_ = s.db.Close()
	}
}

func (s *Store) InitSchema(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id CHAR(26) PRIMARY KEY,
			email VARCHAR(320) NOT NULL,
			email_normalized VARCHAR(320) NOT NULL,
			display_name VARCHAR(120) NOT NULL,
			avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
			phone VARCHAR(32) NOT NULL DEFAULT '',
			locale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
			timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
			theme VARCHAR(20) NOT NULL DEFAULT 'system',
			marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
			email_verified_at DATETIME(6) NULL,
			disabled_at DATETIME(6) NULL,
			last_login_at DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL,
			updated_at DATETIME(6) NOT NULL,
			UNIQUE KEY uq_users_email_normalized (email_normalized),
			KEY idx_users_created_at (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS user_credentials (
			user_id CHAR(26) PRIMARY KEY,
			password_hash VARCHAR(255) NOT NULL,
			password_changed_at DATETIME(6) NOT NULL,
			failed_attempts INT NOT NULL DEFAULT 0,
			locked_until DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL,
			updated_at DATETIME(6) NOT NULL,
			CONSTRAINT fk_user_credentials_user
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS refresh_tokens (
			id CHAR(26) PRIMARY KEY,
			user_id CHAR(26) NOT NULL,
			token_hash CHAR(44) NOT NULL,
			user_agent VARCHAR(512) NOT NULL DEFAULT '',
			ip_address VARCHAR(64) NOT NULL DEFAULT '',
			expires_at DATETIME(6) NOT NULL,
			revoked_at DATETIME(6) NULL,
			created_at DATETIME(6) NOT NULL,
			last_used_at DATETIME(6) NULL,
			replaced_by_token_id CHAR(26) NULL,
			UNIQUE KEY uq_refresh_tokens_hash (token_hash),
			KEY idx_refresh_tokens_user_id (user_id),
			KEY idx_refresh_tokens_expires_at (expires_at),
			CONSTRAINT fk_refresh_tokens_user
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	}
	for _, stmt := range statements {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CreateUserWithPassword(ctx context.Context, user User, passwordHash string) error {
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO users (
		id, email, email_normalized, display_name, locale, timezone, theme,
		marketing_opt_in, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.Email, user.Email, user.DisplayName, user.Locale, user.Timezone,
		user.Theme, user.MarketingOptIn, now, now,
	)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO user_credentials (
		user_id, password_hash, password_changed_at, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?)`, user.ID, passwordHash, now, now, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, string, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
		u.id, u.email, u.display_name, u.avatar_url, u.locale, u.timezone, u.theme,
		u.marketing_opt_in, u.email_verified_at, u.created_at, c.password_hash
	FROM users u
	JOIN user_credentials c ON c.user_id = u.id
	WHERE u.email_normalized = ? AND u.disabled_at IS NULL`, email)
	var user User
	var passwordHash string
	err := row.Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL, &user.Locale,
		&user.Timezone, &user.Theme, &user.MarketingOptIn, &user.EmailVerifiedAt,
		&user.CreatedAt, &passwordHash,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	return user, passwordHash, err
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
		id, email, display_name, avatar_url, locale, timezone, theme,
		marketing_opt_in, email_verified_at, created_at
	FROM users WHERE id = ? AND disabled_at IS NULL`, id)
	var user User
	err := row.Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL, &user.Locale,
		&user.Timezone, &user.Theme, &user.MarketingOptIn, &user.EmailVerifiedAt,
		&user.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (s *Store) CreateRefreshToken(ctx context.Context, tokenID, userID, tokenHash, userAgent, ip string, expiresAt time.Time) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `INSERT INTO refresh_tokens (
		id, user_id, token_hash, user_agent, ip_address, expires_at, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?)`, tokenID, userID, tokenHash, userAgent, ip, expiresAt, now)
	return err
}

func (s *Store) RotateRefreshToken(ctx context.Context, oldHash, newID, newHash, userAgent, ip string, expiresAt time.Time) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	now := time.Now().UTC()
	var oldID string
	var userID string
	var oldExpiresAt time.Time
	var revokedAt sql.NullTime
	row := tx.QueryRowContext(ctx, `SELECT id, user_id, expires_at, revoked_at
		FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`, oldHash)
	if err := row.Scan(&oldID, &userID, &oldExpiresAt, &revokedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	if revokedAt.Valid || !oldExpiresAt.After(now) {
		return User{}, ErrNotFound
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO refresh_tokens (
		id, user_id, token_hash, user_agent, ip_address, expires_at, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?)`, newID, userID, newHash, userAgent, ip, expiresAt, now)
	if err != nil {
		return User{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE refresh_tokens
		SET revoked_at = ?, last_used_at = ?, replaced_by_token_id = ?
		WHERE id = ?`, now, now, newID, oldID)
	if err != nil {
		return User{}, err
	}
	var user User
	row = tx.QueryRowContext(ctx, `SELECT
		id, email, display_name, avatar_url, locale, timezone, theme,
		marketing_opt_in, email_verified_at, created_at
	FROM users WHERE id = ? AND disabled_at IS NULL`, userID)
	if err := row.Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.AvatarURL, &user.Locale,
		&user.Timezone, &user.Theme, &user.MarketingOptIn, &user.EmailVerifiedAt,
		&user.CreatedAt,
	); err != nil {
		return User{}, err
	}
	return user, tx.Commit()
}

func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE refresh_tokens
		SET revoked_at = COALESCE(revoked_at, ?)
		WHERE token_hash = ?`, time.Now().UTC(), tokenHash)
	return err
}

func (s *Store) MarkLogin(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`,
		time.Now().UTC(), time.Now().UTC(), userID)
	return err
}
