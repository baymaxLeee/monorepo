-- Bind retries to the complete logical operation; existing journal rows are preserved.
ALTER TABLE agent_runs ADD COLUMN request_fingerprint varchar(64);
