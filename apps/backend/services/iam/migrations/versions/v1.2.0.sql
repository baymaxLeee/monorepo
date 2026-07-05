-- v1.2.0: three-tier RBAC — org membership state machine + active-org session
-- binding + platform-role hardening + IAM audit log.
--
-- Model: the platform role (super_admin) is ORTHOGONAL to the org role
-- (org_admin/member). Membership carries an explicit review status; a refresh
-- session binds exactly one active org. The legacy flat platform `admin` role
-- is a privilege-escalation path and is removed here (no compatibility branch).

-- 1) organization_members: review state machine ---------------------------
ALTER TABLE `organization_members`
  ADD COLUMN `status` varchar(16) NOT NULL DEFAULT 'pending' AFTER `role`,
  ADD COLUMN `reviewed_by` char(26) NULL AFTER `status`,
  ADD COLUMN `reviewed_at` datetime(6) NULL AFTER `reviewed_by`,
  ADD COLUMN `rejection_reason` varchar(255) NULL AFTER `reviewed_at`;

-- Backfill existing members EXPLICITLY (never rely on the column default:
-- every pre-migration row is an already-joined, active member).
UPDATE `organization_members` SET `status` = 'active' WHERE `status` = 'pending';

-- Collapse legacy org roles into the two-value model.
UPDATE `organization_members` SET `role` = 'org_admin' WHERE `role` IN ('owner', 'admin');

ALTER TABLE `organization_members`
  ADD CONSTRAINT `chk_org_members_role` CHECK (`role` IN ('org_admin', 'member')),
  ADD CONSTRAINT `chk_org_members_status` CHECK (`status` IN ('pending', 'active', 'rejected'));

ALTER TABLE `organization_members`
  ADD KEY `idx_org_members_org_status_created` (`org_id`, `status`, `created_at`),
  ADD KEY `idx_org_members_user_status` (`user_id`, `status`);

-- 2) refresh_tokens: bind a session to exactly one active org -------------
-- Nullable: a session with no active membership (pending/rejected, or a
-- super_admin who has not selected an org) carries no org scope. ON DELETE SET
-- NULL so deleting an org clears the scope rather than breaking token rotation.
ALTER TABLE `refresh_tokens`
  ADD COLUMN `active_org_id` char(26) NULL AFTER `user_id`,
  ADD CONSTRAINT `fk_refresh_tokens_active_org` FOREIGN KEY (`active_org_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

-- 3) iam_audit_events: append-only audit log ------------------------------
-- No FKs on actor/target/org columns: audit rows MUST survive user/org
-- deletion. Never store passwords, tokens, or credentials in before/after.
CREATE TABLE IF NOT EXISTS `iam_audit_events` (
  `id` char(26) NOT NULL,
  `action` varchar(64) NOT NULL,
  `actor_user_id` char(26) NULL,
  `target_user_id` char(26) NULL,
  `org_id` char(26) NULL,
  `before_json` json NULL,
  `after_json` json NULL,
  `result` varchar(16) NOT NULL,
  `reason` varchar(255) NULL,
  `trace_id` varchar(64) NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_iam_audit_actor` (`actor_user_id`),
  KEY `idx_iam_audit_org` (`org_id`),
  KEY `idx_iam_audit_action_created` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4) Platform-role hardening: remove the flat `admin` role entirely -------
-- The three-tier model has no platform `admin` (org management is an
-- org-scoped role). Drop assignments first (FK), then the role row.
-- super_admin continuity is guaranteed by seed + the application-layer
-- "cannot revoke the last super_admin" guard; a SQL-time assert would wrongly
-- fail on a fresh install where bootstrap runs AFTER migrate.
DELETE `ur` FROM `user_roles` `ur`
  JOIN `roles` `r` ON `r`.`id` = `ur`.`role_id`
  WHERE `r`.`name` = 'admin';
DELETE FROM `roles` WHERE `name` = 'admin';

UPDATE `migration` SET `version` = 'v1.2.0', `update_time` = NOW() WHERE `id` = 1;
