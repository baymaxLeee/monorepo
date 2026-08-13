ALTER TABLE model_providers
  DROP CONSTRAINT IF EXISTS ck_model_providers_api,
  DROP CONSTRAINT IF EXISTS ck_model_providers_api_kind,
  DROP COLUMN IF EXISTS api;

UPDATE migration SET version = 'v1.15.0', update_time = NOW() WHERE id = 1;
