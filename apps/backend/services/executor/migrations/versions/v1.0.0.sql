CREATE TABLE IF NOT EXISTS `migration` (
  `id` TINYINT NOT NULL COMMENT '主键, 只允许为 1',
  `version` VARCHAR(32) NOT NULL COMMENT '当前数据库表结构版本',
  `update_time` DATETIME NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO `migration` (`id`, `version`, `update_time`)
VALUES (1, 'v0.0.0', NOW());

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` varchar(32) NOT NULL,
  `type` varchar(64) NOT NULL,
  `status` varchar(20) NOT NULL,
  `owner_service` varchar(40) NOT NULL,
  `owner_ref` varchar(80) NOT NULL,
  `workflow_run_id` varchar(64),
  `payload` json NOT NULL,
  `result` json,
  `error` text,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `finished_at` datetime(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_tasks_owner` (`owner_service`, `owner_ref`),
  KEY `ix_tasks_workflow_run_id` (`workflow_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
