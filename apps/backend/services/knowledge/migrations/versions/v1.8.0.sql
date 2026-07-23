CREATE TABLE IF NOT EXISTS conversation_artifact_tombstones (
  conversation_id varchar(32) PRIMARY KEY,
  user_id varchar(26) NOT NULL,
  org_id varchar(26) NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_conversation_artifact_tombstones_user_id
  ON conversation_artifact_tombstones (user_id);

UPDATE migration SET version = 'v1.8.0', update_time = NOW() WHERE id = 1;

