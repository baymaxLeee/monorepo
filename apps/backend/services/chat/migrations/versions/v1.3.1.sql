-- v1.3.1: repair deployments that already recorded v1.3.0 before
-- knowledge-backed document object metadata columns were added.

SET @has_source_object_bucket := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'source_object_bucket'
);
SET @ddl := IF(
  @has_source_object_bucket = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `source_object_bucket` varchar(64) NULL AFTER `source_mime_type`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_object_key := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'source_object_key'
);
SET @ddl := IF(
  @has_source_object_key = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `source_object_key` varchar(512) NULL AFTER `source_object_bucket`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_sha256 := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'source_sha256'
);
SET @ddl := IF(
  @has_source_sha256 = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `source_sha256` char(64) NULL AFTER `source_object_key`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_filename := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversation_documents'
    AND COLUMN_NAME = 'source_filename'
);
SET @ddl := IF(
  @has_source_filename = 0,
  'ALTER TABLE `conversation_documents` ADD COLUMN `source_filename` varchar(255) NULL AFTER `source_sha256`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v1.3.1', `update_time` = NOW() WHERE `id` = 1;
