CREATE TABLE IF NOT EXISTS users (
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
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id CHAR(26) PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  password_changed_at DATETIME(6) NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_user_credentials_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
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
);
