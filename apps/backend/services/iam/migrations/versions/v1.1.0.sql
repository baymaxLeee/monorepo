-- v1.1.0: organizations (team tenants) + membership join table.
-- The org is the team that owns shared resources (knowledge base, oncall bot).
-- It is intentionally separate from any future desktop-client "workspace".

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` char(26) NOT NULL,
  `name` varchar(120) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `owner_user_id` char(26) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_organizations_slug` (`slug`),
  KEY `idx_organizations_owner` (`owner_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `organization_members` (
  `org_id` char(26) NOT NULL,
  `user_id` char(26) NOT NULL,
  `role` varchar(32) NOT NULL DEFAULT 'member',
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`org_id`, `user_id`),
  KEY `idx_org_members_user` (`user_id`),
  CONSTRAINT `fk_org_members_org` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_org_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `migration` SET `version` = 'v1.1.0', `update_time` = NOW() WHERE `id` = 1;
