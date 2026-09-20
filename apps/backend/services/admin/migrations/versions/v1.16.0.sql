CREATE TABLE canvas_settings (
    org_id varchar(26) PRIMARY KEY,
    revision bigint NOT NULL CHECK (revision > 0),
    defaults_json text NOT NULL,
    updated_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL
);
UPDATE migration SET version = 'v1.16.0', update_time = NOW() WHERE id = 1;
