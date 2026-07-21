CREATE TABLE IF NOT EXISTS staged_media (
  id varchar(32) PRIMARY KEY,
  user_id varchar(26) NOT NULL,
  org_id varchar(26) NOT NULL,
  conversation_id varchar(32),
  title varchar(255) NOT NULL,
  filename varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size integer NOT NULL,
  object_bucket varchar(64) NOT NULL,
  object_key varchar(512) NOT NULL,
  object_sha256 varchar(64) NOT NULL,
  idempotency_key varchar(128) UNIQUE,
  status varchar(20) NOT NULL,
  document_id varchar(32),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT staged_media_status_check CHECK (status IN ('staged', 'published', 'discarded'))
);

CREATE INDEX IF NOT EXISTS ix_staged_media_user_id ON staged_media(user_id);
CREATE INDEX IF NOT EXISTS ix_staged_media_org_id ON staged_media(org_id);
CREATE INDEX IF NOT EXISTS ix_staged_media_conversation_id ON staged_media(conversation_id);

UPDATE migration SET version = 'v1.7.0', update_time = NOW() WHERE id = 1;
