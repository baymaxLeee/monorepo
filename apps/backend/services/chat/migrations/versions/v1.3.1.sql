-- v1.3.1: 修复在这些列加入前就记录了 v1.3.0 的部署（ADD COLUMN IF NOT EXISTS 天然幂等）。

ALTER TABLE conversation_documents
  ADD COLUMN IF NOT EXISTS source_object_bucket varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS source_object_key varchar(512) NULL,
  ADD COLUMN IF NOT EXISTS source_sha256 char(64) NULL,
  ADD COLUMN IF NOT EXISTS source_filename varchar(255) NULL;

UPDATE migration SET version = 'v1.3.1', update_time = NOW() WHERE id = 1;
