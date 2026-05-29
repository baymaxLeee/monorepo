-- v1.2.0: App registry (operator-managed catalog of micro-frontends).
-- Owned by admin service; consumed by the platform shell via GET
-- /api/admin-server/apps to decide which apps each user type may mount.
-- `requires_admin` is the per-app visibility lever: true => admin-only,
-- false => also visible to normal users.

UPDATE `migration` SET `version` = 'v1.2.0', `update_time` = NOW() WHERE `id` = 1;

CREATE TABLE IF NOT EXISTS `apps` (
  `id` varchar(64) NOT NULL,
  `title` varchar(120) NOT NULL,
  `base_path` varchar(200) NOT NULL,
  `remote_name` varchar(120) NOT NULL,
  `expose_key` varchar(120) NOT NULL DEFAULT './App',
  `entry` varchar(500) NOT NULL DEFAULT '',
  `requires_admin` tinyint(1) NOT NULL DEFAULT 1,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_apps_enabled_visibility` (`is_enabled`, `requires_admin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
