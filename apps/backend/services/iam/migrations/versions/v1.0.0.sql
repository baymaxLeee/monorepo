CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL,
  PRIMARY KEY (id)
);

INSERT INTO migration (id, version, update_time)
VALUES (1, 'v0.0.0', NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id char(26) NOT NULL,
  account varchar(64) NOT NULL,
  email varchar(320) NOT NULL,
  email_normalized varchar(320) NOT NULL,
  display_name varchar(120) NOT NULL,
  avatar_url varchar(2048) NOT NULL DEFAULT '',
  phone varchar(32) NOT NULL DEFAULT '',
  locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  theme varchar(20) NOT NULL DEFAULT 'system',
  marketing_opt_in boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  disabled_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_users_account UNIQUE (account),
  CONSTRAINT uq_users_email_normalized UNIQUE (email_normalized)
);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id char(26) NOT NULL,
  password_hash varchar(255) NOT NULL,
  password_changed_at timestamptz NOT NULL,
  failed_attempts bigint NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_credentials_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id char(26) NOT NULL,
  user_id char(26) NOT NULL,
  token_hash char(44) NOT NULL,
  user_agent varchar(512) NOT NULL DEFAULT '',
  ip_address varchar(64) NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  replaced_by_token_id char(26),
  PRIMARY KEY (id),
  CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS roles (
  id char(26) NOT NULL,
  name varchar(64) NOT NULL,
  description varchar(255) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_roles_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id char(26) NOT NULL,
  role_id char(26) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles (role_id);
