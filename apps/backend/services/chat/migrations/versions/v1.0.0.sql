CREATE TABLE IF NOT EXISTS `migration` (
  `id` TINYINT NOT NULL COMMENT '主键, 只允许为 1',
  `version` VARCHAR(32) NOT NULL COMMENT '当前数据库表结构版本',
  `update_time` DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `migration` (`id`, `version`, `update_time`)
VALUES (1, 'v0.0.0', NOW());

CREATE TABLE IF NOT EXISTS `conversations` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(26) NOT NULL,
  `title` varchar(200) NOT NULL DEFAULT '新对话',
  `model` varchar(120) NOT NULL DEFAULT '',
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_conversations_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `messages` (
  `id` varchar(32) NOT NULL,
  `conversation_id` varchar(32) NOT NULL,
  `role` varchar(20) NOT NULL,
  `content` text NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'ok',
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_messages_conversation_id` (`conversation_id`),
  CONSTRAINT `fk_messages_conversation_id`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
