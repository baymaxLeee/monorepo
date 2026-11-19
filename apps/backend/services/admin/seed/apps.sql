-- Canonical app-registry seed shared by local development and deployment.
--
-- Remotes are served from the same origin in every profile. Local frontend
-- development proxies /mfe-* to each MFE dev server, while deployment routes
-- those paths through nginx/ingress.
--
-- Idempotent: refresh wiring fields without changing operator-controlled
-- visibility. Re-running bootstrap must preserve requires_admin/is_enabled.

INSERT INTO apps
  (id, title, base_path, remote_name, expose_key, entry,
   requires_admin, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('admin', '后台管理', '/platform/admin', 'mfe_admin', './routes',
   '/mfe-admin/mf-manifest.json', true, true, 10, NOW(), NOW()),
  ('chat', '对话', '/platform/chat', 'mfe_chat', './routes',
   '/mfe-chat/mf-manifest.json', false, true, 20, NOW(), NOW()),
  ('canvas', '画布', '/platform/canvas', 'mfe_canvas', './routes',
   '/mfe-canvas/mf-manifest.json', false, true, 30, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  base_path = EXCLUDED.base_path,
  remote_name = EXCLUDED.remote_name,
  expose_key = EXCLUDED.expose_key,
  entry = EXCLUDED.entry,
  updated_at = NOW();
