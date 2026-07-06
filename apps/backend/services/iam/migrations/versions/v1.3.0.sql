-- v1.3.0: one system-managed open guest organization.
ALTER TABLE organizations
  ADD COLUMN system_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN system_key varchar(32),
  ADD COLUMN join_policy varchar(16) NOT NULL DEFAULT 'approval',
  ADD CONSTRAINT uq_organizations_system_key UNIQUE (system_key);

UPDATE organizations
SET name = '游客组织', slug = 'guest-org', system_managed = true,
    system_key = 'guest-org', join_policy = 'open', updated_at = NOW()
WHERE id = 'guest-org';

ALTER TABLE organizations
  ADD CONSTRAINT chk_organizations_join_policy
    CHECK (join_policy IN ('open', 'approval')),
  ADD CONSTRAINT chk_organizations_system_shape
    CHECK (
      (system_managed = false AND system_key IS NULL AND join_policy = 'approval')
      OR
      (system_managed = true AND system_key = 'guest-org' AND join_policy = 'open')
    );

UPDATE migration SET version = 'v1.3.0', update_time = NOW() WHERE id = 1;
