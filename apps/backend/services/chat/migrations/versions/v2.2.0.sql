-- Re-deploy safe: convert messages.content to a native JSON column.
-- Matches the Vercel AI SDK persistence shape (message parts stored as
-- structured JSON, validated on write) instead of a serialized string in TEXT.
-- Any legacy non-JSON (plain text) row is first wrapped into the
-- {version, parts:[{type:text,text:...}]} envelope so the type conversion below
-- never rejects existing data.

UPDATE `messages`
SET `content` = JSON_OBJECT(
  'version', 1,
  'parts', JSON_ARRAY(JSON_OBJECT('type', 'text', 'text', `content`))
)
WHERE NOT JSON_VALID(`content`);

SET @content_type := (
  SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'content'
);
SET @ddl := IF(
  @content_type <> 'json',
  'ALTER TABLE `messages` MODIFY COLUMN `content` json NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `migration` SET `version` = 'v2.2.0', `update_time` = NOW() WHERE `id` = 1;
