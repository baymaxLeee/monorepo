-- Re-deploy safe: widen messages.content from TEXT (64KB) to MEDIUMTEXT (16MB).
-- Serialized UIMessage parts (reasoning + tool inputs/outputs, e.g. a web_search
-- turn) can exceed 64KB; the oversized INSERT failed and dropped the whole
-- assistant turn, so refreshed conversations were missing replies.

SET @content_type := (
  SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'content'
);
SET @ddl := IF(
  @content_type = 'text',
  'ALTER TABLE `messages` MODIFY COLUMN `content` mediumtext NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v2.1.0', `update_time` = NOW() WHERE `id` = 1;
