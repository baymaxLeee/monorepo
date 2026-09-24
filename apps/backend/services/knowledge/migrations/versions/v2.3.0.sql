-- Source bytes are owned by the Asset control plane. Knowledge keeps document
-- semantics plus a durable intent that converges the cross-service Claim.

ALTER TABLE documents
  ADD COLUMN asset_id uuid NULL,
  ADD COLUMN source_revision_id uuid NULL,
  ADD COLUMN source_sha256 varchar(64) NULL;

CREATE INDEX ix_documents_asset_revision
  ON documents (asset_id, source_revision_id)
  WHERE asset_id IS NOT NULL;

CREATE TABLE asset_claim_intents (
  owner_type varchar(64) NOT NULL,
  owner_id varchar(128) NOT NULL,
  slot varchar(128) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  workspace_id varchar(64) NOT NULL,
  asset_id uuid NOT NULL,
  revision_id uuid NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('strong', 'snapshot', 'lease', 'weak')),
  generation bigint NOT NULL CHECK (generation > 0),
  desired_state varchar(20) NOT NULL CHECK (desired_state IN ('active', 'released')),
  delivered_at timestamptz NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  lease_until timestamptz NULL,
  state_version bigint NOT NULL DEFAULT 1,
  last_error text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, owner_type, owner_id, slot)
);
CREATE INDEX ix_asset_claim_intents_delivery
  ON asset_claim_intents (next_attempt_at, lease_until, updated_at, owner_id)
  WHERE delivered_at IS NULL;

UPDATE migration SET version = 'v2.3.0', update_time = now() WHERE id = 1;
