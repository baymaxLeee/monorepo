ALTER TABLE conversations ADD COLUMN project_id varchar(36);
CREATE INDEX ix_conversations_project_canvas ON conversations(tenant_id, workspace_id, user_id, project_id, canvas_id);
