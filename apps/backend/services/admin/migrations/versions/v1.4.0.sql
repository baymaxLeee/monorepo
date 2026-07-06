-- v1.4.0: model_providers.provider_kind (chat | image | video | ...).

ALTER TABLE model_providers
  ADD COLUMN IF NOT EXISTS provider_kind varchar(16) NOT NULL DEFAULT 'chat';

UPDATE migration SET version = 'v1.4.0', update_time = NOW() WHERE id = 1;
