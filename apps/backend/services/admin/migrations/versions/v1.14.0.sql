ALTER TABLE model_providers
  ADD COLUMN IF NOT EXISTS api varchar(32) NULL;

UPDATE model_providers
SET api = CASE
  WHEN provider_kind <> 'chat' THEN NULL
  WHEN lower(base_url) LIKE '%api.deepseek.com%' THEN 'deepseek_responses'
  WHEN lower(base_url) LIKE '%volces.com%' THEN 'ark_responses'
  ELSE 'openai_responses'
END
WHERE api IS NULL;

ALTER TABLE model_providers
  ADD CONSTRAINT ck_model_providers_api
    CHECK (api IS NULL OR api IN ('openai_responses', 'ark_responses', 'deepseek_responses')),
  ADD CONSTRAINT ck_model_providers_api_kind
    CHECK ((provider_kind = 'chat' AND api IS NOT NULL) OR (provider_kind <> 'chat' AND api IS NULL));

UPDATE migration SET version = 'v1.14.0', update_time = NOW() WHERE id = 1;
