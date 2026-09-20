ALTER TABLE conversations ADD COLUMN canvas_id varchar(36);
CREATE INDEX ix_conversations_canvas ON conversations(org_id,user_id,canvas_id);
