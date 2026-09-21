CREATE TABLE benefit_packages (
    id varchar(32) PRIMARY KEY,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    is_preset boolean NOT NULL,
    name varchar(80) NOT NULL,
    project_name varchar(128) NOT NULL,
    asset_group_id varchar(128) NOT NULL,
    access_key_id_enc text NOT NULL,
    secret_access_key_enc text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    model_ids_json text NOT NULL DEFAULT '[]',
    material_used bigint NOT NULL DEFAULT 0 CHECK (material_used >= 0),
    material_limit bigint CHECK (material_limit IS NULL OR material_limit > 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by varchar(26) NOT NULL,
    updated_by varchar(26) NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);
CREATE UNIQUE INDEX benefit_packages_preset ON benefit_packages (tenant_id, workspace_id) WHERE is_preset AND deleted_at IS NULL;
CREATE UNIQUE INDEX benefit_packages_name ON benefit_packages (tenant_id, workspace_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX benefit_packages_asset_group ON benefit_packages (asset_group_id) WHERE deleted_at IS NULL;
CREATE TABLE benefit_package_models (
    package_id varchar(32) NOT NULL REFERENCES benefit_packages(id),
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    model_id varchar(128) NOT NULL,
    PRIMARY KEY (package_id, model_id),
    CONSTRAINT benefit_package_models_scope_model UNIQUE (tenant_id, workspace_id, model_id)
);
CREATE INDEX benefit_package_models_scope ON benefit_package_models (tenant_id, workspace_id, package_id);
CREATE TABLE benefit_package_asset_group_cleanups (
    id varchar(32) PRIMARY KEY,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    benefit_package_id varchar(32) NOT NULL,
    asset_group_id varchar(128) NOT NULL UNIQUE,
    project_name varchar(128) NOT NULL,
    access_key_id_enc text NOT NULL,
    secret_access_key_enc text NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed')),
    lease_token varchar(32) NOT NULL DEFAULT '',
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error varchar(512) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    completed_at timestamptz
);
CREATE INDEX benefit_package_asset_group_cleanups_scope
    ON benefit_package_asset_group_cleanups (tenant_id, workspace_id, status, updated_at DESC);
CREATE TABLE benefit_package_review_reservations (
    id varchar(36) PRIMARY KEY,
    tenant_id varchar(26) NOT NULL,
    workspace_id varchar(26) NOT NULL,
    benefit_package_id varchar(32) NOT NULL REFERENCES benefit_packages(id),
    project_id varchar(36) NOT NULL,
    asset_id varchar(36) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released')),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX benefit_package_review_reservations_active
    ON benefit_package_review_reservations (benefit_package_id, project_id, asset_id)
    WHERE status IN ('reserved', 'committed');
CREATE INDEX benefit_package_review_reservations_scope
    ON benefit_package_review_reservations (tenant_id, workspace_id, benefit_package_id, status);
UPDATE migration SET version = 'v1.18.0', update_time = now() WHERE id = 1;
