-- Prod app-registry seed (single-VPS profile).
--
-- The admin demo seed in `db.py` only runs in non-production, and it uses dev
-- URLs (http://localhost:3001). In prod the remotes are served SAME-ORIGIN by
-- nginx (see infra/single-vps/nginx.conf): /mfe-admin/ and /mfe-chat/. This
-- file provisions the catalog with those prod manifest URLs.
--
-- Idempotent: ON DUPLICATE KEY UPDATE refreshes only the wiring fields
-- (title/path/remote/entry) and intentionally does NOT touch requires_admin /
-- is_enabled, so an operator's visibility changes in the admin UI survive
-- re-runs of db-init.

INSERT INTO `apps`
  (`id`, `title`, `base_path`, `remote_name`, `expose_key`, `entry`,
   `requires_admin`, `is_enabled`, `sort_order`, `created_at`, `updated_at`)
-- Remotes are served SAME-ORIGIN under /mfe-<id>/ by nginx/ingress, so the
-- manifest entry is a fixed relative path (identical for dev and prod).
VALUES
  ('admin', '后台管理', '/platform/admin', 'mfe_admin', './App',
   '/mfe-admin/mf-manifest.json', 1, 1, 10, NOW(6), NOW(6)),
  ('chat', '对话', '/platform/chat', 'mfe_chat', './App',
   '/mfe-chat/mf-manifest.json', 0, 1, 20, NOW(6), NOW(6))
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `base_path` = VALUES(`base_path`),
  `remote_name` = VALUES(`remote_name`),
  `expose_key` = VALUES(`expose_key`),
  `entry` = VALUES(`entry`),
  `updated_at` = NOW(6);
