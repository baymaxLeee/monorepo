DO $$
DECLARE col record;
BEGIN
 FOR col IN SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id'
 LOOP
  EXECUTE format('ALTER TABLE %I RENAME COLUMN org_id TO workspace_id', col.table_name);
  EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id varchar(26) NOT NULL DEFAULT ''system-tenant''', col.table_name);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id DROP DEFAULT', col.table_name);
 END LOOP;
END $$;
UPDATE migration SET version = 'v2.1.0', update_time = now() WHERE id = 1;
