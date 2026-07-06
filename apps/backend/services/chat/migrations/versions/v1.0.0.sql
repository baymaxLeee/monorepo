CREATE TABLE IF NOT EXISTS migration (
  id smallint NOT NULL,
  version varchar(32) NOT NULL,
  update_time timestamptz NOT NULL,
  PRIMARY KEY (id)
);

INSERT INTO migration (id, version, update_time)
VALUES (1, 'v0.0.0', NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS conversations (
  id varchar(32) NOT NULL,
  user_id varchar(26) NOT NULL,
  title varchar(200) NOT NULL DEFAULT '新对话',
  model varchar(120) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS ix_conversations_user_id ON conversations (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id varchar(32) NOT NULL,
  conversation_id varchar(32) NOT NULL,
  role varchar(20) NOT NULL,
  content text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_messages_conversation_id
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_messages_conversation_id ON messages (conversation_id);
