ALTER TABLE conversations DROP COLUMN IF EXISTS active_plan_document_id;
ALTER TABLE conversations ADD COLUMN active_plan_path varchar(512) NULL;
