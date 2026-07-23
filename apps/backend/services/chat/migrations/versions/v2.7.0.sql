CREATE TABLE IF NOT EXISTS conversation_artifact_cleanup_outbox (
  conversation_id varchar(32) PRIMARY KEY,
  user_id varchar(26) NOT NULL,
  org_id varchar(26) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_conversation_artifact_cleanup_outbox_available
  ON conversation_artifact_cleanup_outbox (available_at, created_at);

UPDATE migration SET version = 'v2.7.0', update_time = NOW() WHERE id = 1;

