-- v1.3.0: 为 knowledge 承载的上传保留原始 source-object 元数据。Markdown 转换仍是
-- 常规预览/编辑面;原始二进制载荷存于 knowledge,chat 仅保存对象元数据以保持行精简。

ALTER TABLE conversation_documents
  ADD COLUMN IF NOT EXISTS source_mime_type varchar(120) NULL,
  ADD COLUMN IF NOT EXISTS source_object_bucket varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS source_object_key varchar(512) NULL,
  ADD COLUMN IF NOT EXISTS source_sha256 char(64) NULL,
  ADD COLUMN IF NOT EXISTS source_filename varchar(255) NULL;

UPDATE migration SET version = 'v1.3.0', update_time = NOW() WHERE id = 1;
