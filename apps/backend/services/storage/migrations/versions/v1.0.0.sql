CREATE TABLE IF NOT EXISTS `migration` (
  `id` TINYINT NOT NULL COMMENT '主键, 只允许为 1',
  `version` VARCHAR(32) NOT NULL COMMENT '当前数据库表结构版本',
  `update_time` DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `migration` (`id`, `version`, `update_time`)
VALUES (1, 'v0.0.0', NOW());

CREATE TABLE IF NOT EXISTS `storage_objects` (
  `id` char(36) NOT NULL,
  `bucket` varchar(64) NOT NULL,
  `object_key` varchar(512) NOT NULL,
  `backend` varchar(32) NOT NULL DEFAULT 'local',
  `storage_path` varchar(1024) NOT NULL,
  `etag` varchar(128) NOT NULL,
  `sha256` char(64) NOT NULL,
  `size_bytes` bigint NOT NULL,
  `content_type` varchar(255) NOT NULL DEFAULT 'application/octet-stream',
  `content_disposition` varchar(512) NOT NULL DEFAULT '',
  `metadata_json` json NOT NULL,
  `owner_user_id` varchar(64) NOT NULL DEFAULT '',
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_objects_bucket_key` (`bucket`, `object_key`),
  KEY `idx_storage_objects_owner_user_id` (`owner_user_id`),
  KEY `idx_storage_objects_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.0.0', `update_time` = NOW() WHERE `id` = 1;
