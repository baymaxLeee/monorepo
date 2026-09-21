CREATE TABLE tenants (
 id varchar(26) PRIMARY KEY,
 name varchar(120) NOT NULL,
 slug varchar(64) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants (id,name,slug) VALUES ('system-tenant','平台','platform');
ALTER TABLE organizations RENAME TO workspaces;
ALTER TABLE organization_members RENAME TO workspace_members;
ALTER TABLE workspace_members RENAME COLUMN org_id TO workspace_id;
ALTER TABLE refresh_tokens RENAME COLUMN active_org_id TO active_workspace_id;
ALTER TABLE iam_audit_events RENAME COLUMN org_id TO workspace_id;
ALTER TABLE workspaces ADD COLUMN tenant_id varchar(26) NOT NULL DEFAULT 'system-tenant' REFERENCES tenants(id);
ALTER TABLE workspaces ALTER COLUMN tenant_id DROP DEFAULT;
CREATE INDEX idx_workspaces_tenant ON workspaces(tenant_id);
ALTER TABLE workspace_members DROP CONSTRAINT chk_org_members_role;
UPDATE workspace_members SET role = 'workspace_admin' WHERE role = 'org_admin';
ALTER TABLE workspace_members ADD CONSTRAINT chk_workspace_members_role CHECK (role IN ('workspace_admin','member'));
ALTER TABLE workspaces DROP CONSTRAINT chk_organizations_system_shape;
UPDATE workspaces SET system_key = 'guest-workspace', slug = 'guest-workspace', name = '游客工作空间' WHERE system_managed;
ALTER TABLE workspaces ADD CONSTRAINT chk_workspaces_system_shape CHECK (
 (NOT system_managed AND system_key IS NULL AND join_policy = 'approval') OR
 (system_managed AND system_key = 'guest-workspace' AND join_policy = 'open')
);
DO $$
DECLARE col record;
BEGIN
 FOR col IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='character' AND character_maximum_length=26
 LOOP
  EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE varchar(26) USING rtrim(%I)',col.table_name,col.column_name,col.column_name);
 END LOOP;
END $$;
UPDATE migration SET version = 'v1.4.0', update_time = now() WHERE id = 1;
