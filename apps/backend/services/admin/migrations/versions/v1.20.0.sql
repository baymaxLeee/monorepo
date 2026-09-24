ALTER TABLE model_providers
  ADD COLUMN responses_dialect varchar(32);

UPDATE model_providers
SET responses_dialect = CASE
  WHEN provider_kind <> 'chat' THEN NULL
  WHEN lower(base_url) LIKE '%api.deepseek.com%' THEN 'deepseek_responses'
  WHEN lower(base_url) LIKE '%volces.com%' THEN 'ark_responses'
  ELSE 'openai_responses'
END;

ALTER TABLE model_providers
  ADD CONSTRAINT ck_model_providers_responses_dialect
    CHECK (responses_dialect IS NULL OR responses_dialect IN ('openai_responses', 'ark_responses', 'deepseek_responses')),
  ADD CONSTRAINT ck_model_providers_responses_dialect_kind
    CHECK (
      (provider_kind = 'chat' AND responses_dialect IS NOT NULL)
      OR (provider_kind <> 'chat' AND responses_dialect IS NULL)
    );

UPDATE migration SET version = 'v1.20.0', update_time = now() WHERE id = 1;
