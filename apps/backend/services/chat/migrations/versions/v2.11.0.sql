ALTER TABLE conversations ADD COLUMN project_id varchar(36);
CREATE UNIQUE INDEX ux_conversations_canvas_owner ON conversations(tenant_id, workspace_id, user_id, project_id, canvas_id);
UPDATE migration SET version = 'v2.11.0', update_time = now() WHERE id = 1;
