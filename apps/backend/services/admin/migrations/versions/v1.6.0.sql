-- v1.6.0: add model_providers.supports_image_input (chat model vision flag).

ALTER TABLE model_providers
  ADD COLUMN IF NOT EXISTS supports_image_input boolean NOT NULL DEFAULT false;

UPDATE migration SET version = 'v1.6.0', update_time = NOW() WHERE id = 1;
