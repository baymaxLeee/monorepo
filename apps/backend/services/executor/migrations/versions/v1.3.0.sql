DO $$
DECLARE col record;
BEGIN
 FOR col IN SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id'
 LOOP
  EXECUTE format('ALTER TABLE %I RENAME COLUMN org_id TO workspace_id', col.table_name);
 END LOOP;
END $$;
ALTER TABLE video_productions ADD COLUMN tenant_id varchar(26) NOT NULL DEFAULT 'system-tenant';
UPDATE migration SET version = 'v1.3.0', update_time = now() WHERE id = 1;
