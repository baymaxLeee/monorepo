CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL,
  PRIMARY KEY (id)
);

INSERT INTO migration (id, version, update_time)
VALUES (1, 'v0.0.0', NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bots (
  id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  name varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_bots_user_id ON bots (user_id);

CREATE TABLE IF NOT EXISTS scenes (
  id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  username varchar(120) NOT NULL,
  name varchar(100) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'draft',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_scenes_user_id ON scenes (user_id);

CREATE TABLE IF NOT EXISTS intentions (
  id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  username varchar(120) NOT NULL,
  name varchar(100) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  scene_name varchar(100) NOT NULL DEFAULT '',
  examples bigint NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'draft',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_intentions_user_id ON intentions (user_id);
