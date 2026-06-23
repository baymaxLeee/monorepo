-- v1.4.0: document ingest status for parallel SSE import pipeline.

SET @has_ingest_status := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'ingest_status'
);
SET @ddl := IF(
  @has_ingest_status = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `ingest_status` varchar(20) NOT NULL DEFAULT ''ready'' AFTER `source_filename`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ingest_progress := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'ingest_progress'
);
SET @ddl := IF(
  @has_ingest_progress = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `ingest_progress` int NOT NULL DEFAULT 100 AFTER `ingest_status`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ingest_error := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'ingest_error'
);
SET @ddl := IF(
  @has_ingest_error = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `ingest_error` text NULL AFTER `ingest_progress`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.4.0', `update_time` = NOW() WHERE `id` = 1;
