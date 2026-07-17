-- Prod app-registry seed (single-VPS profile).
--
-- The admin demo seed in `db.py` only runs in non-production, and it uses dev
-- URLs (http://localhost:3001). In prod the remotes are served SAME-ORIGIN by
-- nginx (see infra/single-vps/nginx.conf): /mfe-admin/ and /mfe-chat/. This
-- file provisions the catalog with those prod manifest URLs.
--
-- Idempotent: ON CONFLICT DO UPDATE refreshes only the wiring fields
-- (title/path/remote/entry) and intentionally does NOT touch requires_admin /
-- is_enabled, so an operator's visibility changes in the admin UI survive
-- re-runs of db-init.

INSERT INTO apps
  (id, title, base_path, remote_name, expose_key, entry,
   requires_admin, is_enabled, sort_order, created_at, updated_at)
-- Remotes are served SAME-ORIGIN under /mfe-<id>/ by nginx/ingress, so the
-- manifest entry is a fixed relative path (identical for dev and prod).
VALUES
  ('admin', '后台管理', '/platform/admin', 'mfe_admin', './routes',
   '/mfe-admin/mf-manifest.json', true, true, 10, NOW(), NOW()),
  ('chat', '对话', '/platform/chat', 'mfe_chat', './routes',
   '/mfe-chat/mf-manifest.json', false, true, 20, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  base_path = EXCLUDED.base_path,
  remote_name = EXCLUDED.remote_name,
  expose_key = EXCLUDED.expose_key,
  entry = EXCLUDED.entry,
  updated_at = NOW();
