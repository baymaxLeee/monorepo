CREATE TABLE IF NOT EXISTS `migration` (
  `id` TINYINT NOT NULL COMMENT '主键, 只允许为 1',
  `version` VARCHAR(32) NOT NULL COMMENT '当前数据库表结构版本',
  `update_time` DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `migration` (`id`, `version`, `update_time`)
VALUES (1, 'v0.0.0', NOW());

CREATE TABLE IF NOT EXISTS `documents` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `conversation_id` varchar(32) NULL COMMENT 'optional tag from chat, not FK',
  `kind` varchar(20) NOT NULL COMMENT 'source | artifact',
  `title` varchar(255) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `mime_type` varchar(120) NOT NULL DEFAULT 'text/markdown',
  `content_md` mediumtext NOT NULL,
  `source_size` int NOT NULL DEFAULT 0,
  `source_mime_type` varchar(120) NULL,
  `object_bucket` varchar(64) NULL,
  `object_key` varchar(512) NULL,
  `object_sha256` char(64) NULL,
  `source_filename` varchar(255) NULL,
  `ingest_status` varchar(20) NOT NULL DEFAULT 'ready',
  `ingest_progress` int NOT NULL DEFAULT 100,
  `ingest_error` text NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_documents_user_id` (`user_id`),
  KEY `ix_documents_conversation_id` (`conversation_id`),
  KEY `ix_documents_kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.0.0', `update_time` = NOW() WHERE `id` = 1;
