-- v1.4.0: 并行 SSE 导入管线的文档摄取状态。

ALTER TABLE conversation_documents
  ADD COLUMN IF NOT EXISTS ingest_status varchar(20) NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS ingest_progress integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS ingest_error text NULL;

UPDATE migration SET version = 'v1.4.0', update_time = NOW() WHERE id = 1;
